/**
 * IDE Extension Integration
 *
 * Integration with VS Code, Cursor, Windsurf and other IDEs.
 *
 * Reference: opencode/packages/opencode/src/ide/
 */

import { Effect, Layer, Context } from 'effect'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { execSync } from 'child_process'
import { existsSync } from 'fs'

// ============================================================================
// IDE Types
// ============================================================================

export const IDETypeSchema = z.enum(['vscode', 'cursor', 'windsurf', 'jetbrains', 'other'])
export type IDEType = z.infer<typeof IDETypeSchema>

export const IDEStatusSchema = z.enum(['connected', 'disconnected', 'connecting', 'error'])
export type IDEStatus = z.infer<typeof IDEStatusSchema>

// ============================================================================
// IDE Extension Info
// ============================================================================

export const IDEExtensionInfoSchema = z.object({
  id: z.string().describe('Extension ID'),
  name: z.string().describe('Extension name'),
  version: z.string().describe('Extension version'),
  ide: IDETypeSchema.describe('Target IDE'),
  description: z.string().optional().describe('Extension description'),
  installUrl: z.string().optional().describe('Marketplace URL'),
  downloadedAt: z.number().optional().describe('Download timestamp'),
})

export type IDEExtensionInfo = z.infer<typeof IDEExtensionInfoSchema>

// ============================================================================
// IDE Connection
// ============================================================================

export const IDEConnectionSchema = z.object({
  id: z.string().describe('Connection ID'),
  type: IDETypeSchema.describe('IDE type'),
  status: IDEStatusSchema.describe('Connection status'),
  endpoint: z.string().optional().describe('WebSocket/HTTP endpoint'),
  pid: z.number().optional().describe('IDE process ID'),
  version: z.string().optional().describe('IDE version'),
  extensions: z.array(z.string()).optional().describe('Installed extension IDs'),
  lastSeen: z.number().describe('Last heartbeat'),
})

export type IDEConnection = z.infer<typeof IDEConnectionSchema>

// ============================================================================
// IDE Commands
// ============================================================================

export const IDECommandSchema = z.object({
  id: z.string().describe('Command ID'),
  type: z.enum(['execute', 'query', 'subscribe', 'open', 'close']).describe('Command type'),
  method: z.string().describe('Command method'),
  params: z.unknown().optional().describe('Command parameters'),
})

export type IDECommand = z.infer<typeof IDECommandSchema>

// ============================================================================
// IDE Events
// ============================================================================

export const IDEEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('extension_installed'),
    extensionId: z.string(),
  }),
  z.object({
    type: z.literal('extension_uninstalled'),
    extensionId: z.string(),
  }),
  z.object({
    type: z.literal('connected'),
    connectionId: z.string(),
  }),
  z.object({
    type: z.literal('disconnected'),
    connectionId: z.string(),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal('status_changed'),
    status: IDEStatusSchema,
  }),
  z.object({
    type: z.literal('workspace_opened'),
    path: z.string(),
  }),
  z.object({
    type: z.literal('workspace_closed'),
    path: z.string(),
  }),
  z.object({
    type: z.literal('file_changed'),
    path: z.string(),
  }),
])

export type IDEEvent = z.infer<typeof IDEEventSchema>

// ============================================================================
// IDE Config
// ============================================================================

export const IDEConfigSchema = z.object({
  autoInstall: z.boolean().default(true).describe('Auto-install extension'),
  extensionIds: z.record(IDETypeSchema, z.string()).optional().describe('Extension IDs per IDE'),
  endpoint: z.string().optional().describe('Custom endpoint for IDE communication'),
  timeout: z.number().default(30000).describe('Connection timeout'),
})

export type IDEConfig = z.infer<typeof IDEConfigSchema>

// ============================================================================
// IDE Service
// ============================================================================

export class IDEService {
  private config: IDEConfig
  private connections: Map<string, IDEConnection> = new Map()
  private listeners: Map<string, Set<(event: IDEEvent) => void>> = new Map()

  constructor(config: Partial<IDEConfig> = {}) {
    this.config = {
      autoInstall: true,
      timeout: 30000,
      ...config,
    }
  }

  // ============================================================================
  // Detection
  // ============================================================================

  /**
   * Detect running IDE
   */
  detectIDE(): IDEType | undefined {
    // Check environment variables
    if (process.env['VSCODE_INJECTION']) return 'vscode'
    if (process.env['CURSOR_APP']) return 'cursor'
    if (process.env['WINDSURF']) return 'windsurf'
    if (process.env['JETBRAINS']) return 'jetbrains'

    // Check process names (simplified)
    try {
      if (process.platform === 'win32') {
        const output = execSync('tasklist /FI "IMAGENAME eq Code.exe" /NH', { encoding: 'utf-8' })
        if (output.includes('Code.exe')) return 'vscode'
      }
    } catch {}

    return undefined
  }

  /**
   * Get extension info by IDE type
   */
  getExtensionInfo(ide: IDEType): IDEExtensionInfo | undefined {
    const extensionIds: Record<IDEType, Record<string, string>> = {
      vscode: {
        id: 'hyagent.hyagent',
        name: 'HyAgent',
        version: '1.0.0',
        installUrl: 'https://marketplace.visualstudio.com/items?itemName=hyagent.hyagent',
      },
      cursor: {
        id: 'hyagent.hyagent',
        name: 'HyAgent',
        version: '1.0.0',
      },
      windsurf: {
        id: 'hyagent.hyagent',
        name: 'HyAgent',
        version: '1.0.0',
      },
      jetbrains: {
        id: 'com.hyagent.hyagent',
        name: 'HyAgent',
        version: '1.0.0',
      },
      other: {},
    }

    const info = extensionIds[ide]
    if (!info || !info.id) return undefined

    return {
      id: info.id,
      name: info.name,
      version: info.version,
      ide,
      description: 'AI coding agent integration',
      installUrl: info.installUrl,
    }
  }

  // ============================================================================
  // Installation
  // ============================================================================

  /**
   * Install extension for IDE
   */
  installExtension(ide: IDEType): void {
    if (!this.config.autoInstall) return

    const info = this.getExtensionInfo(ide)
    if (!info?.installUrl) return

    try {
      switch (ide) {
        case 'vscode':
          execSync(`code --install-extension ${info.id}`, { stdio: 'ignore' })
          break
        case 'cursor':
          execSync(`cursor --install-extension ${info.id}`, { stdio: 'ignore' })
          break
        case 'windsurf':
          execSync(`windsurf --install-extension ${info.id}`, { stdio: 'ignore' })
          break
      }
    } catch (e) {
      console.error(`[IDE] Failed to install extension for ${ide}:`, e)
    }
  }

  /**
   * Check if extension is installed
   */
  isExtensionInstalled(ide: IDEType): boolean {
    try {
      switch (ide) {
        case 'vscode': {
          const output = execSync('code --list-extensions', { encoding: 'utf-8' })
          const info = this.getExtensionInfo(ide)
          return info ? output.includes(info.id) : false
        }
        case 'cursor': {
          const output = execSync('cursor --list-extensions', { encoding: 'utf-8' })
          const info = this.getExtensionInfo(ide)
          return info ? output.includes(info.id) : false
        }
        default:
          return false
      }
    } catch {
      return false
    }
  }

  // ============================================================================
  // Connection Management
  // ============================================================================

  /**
   * Connect to IDE
   */
  connect(ide: IDEType, endpoint?: string): IDEConnection {
    const id = `ide-${randomUUID().substring(0, 8)}`

    const connection: IDEConnection = {
      id,
      type: ide,
      status: 'connecting',
      endpoint,
      lastSeen: Date.now(),
    }

    this.connections.set(id, connection)
    this.emit({ type: 'connected', connectionId: id })

    // In a real implementation, we would establish WebSocket/HTTP connection here
    // For now, just mark as connected
    connection.status = 'connected'

    return connection
  }

  /**
   * Disconnect from IDE
   */
  disconnect(connectionId: string, reason?: string): void {
    const connection = this.connections.get(connectionId)
    if (connection) {
      connection.status = 'disconnected'
      this.emit({ type: 'disconnected', connectionId, reason })
      this.connections.delete(connectionId)
    }
  }

  /**
   * Get connection by ID
   */
  getConnection(connectionId: string): IDEConnection | undefined {
    return this.connections.get(connectionId)
  }

  /**
   * List all connections
   */
  listConnections(): IDEConnection[] {
    return Array.from(this.connections.values())
  }

  /**
   * Update heartbeat
   */
  heartbeat(connectionId: string): void {
    const connection = this.connections.get(connectionId)
    if (connection) {
      connection.lastSeen = Date.now()
    }
  }

  // ============================================================================
  // Communication
  // ============================================================================

  /**
   * Send command to IDE
   */
  sendCommand(connectionId: string, command: IDECommand): void {
    const connection = this.connections.get(connectionId)
    if (!connection || connection.status !== 'connected') {
      throw new Error(`IDE ${connectionId} not connected`)
    }

    // In real implementation, send via WebSocket/HTTP
    console.log(`[IDE] Sending command to ${connectionId}:`, command)
  }

  /**
   * Execute VSCode command
   */
  executeVSCodeCommand(connectionId: string, command: string, args?: unknown[]): void {
    this.sendCommand(connectionId, {
      id: randomUUID(),
      type: 'execute',
      method: command,
      params: args,
    })
  }

  // ============================================================================
  // Event Handling
  // ============================================================================

  /**
   * Subscribe to IDE events
   */
  subscribe(connectionId: string, handler: (event: IDEEvent) => void): () => void {
    if (!this.listeners.has(connectionId)) {
      this.listeners.set(connectionId, new Set())
    }
    this.listeners.get(connectionId)!.add(handler)

    return () => {
      this.listeners.get(connectionId)?.delete(handler)
    }
  }

  /**
   * Emit event to listeners
   */
  private emit(event: IDEEvent): void {
    for (const handlers of this.listeners.values()) {
      for (const handler of handlers) {
        try {
          handler(event)
        } catch (e) {
          console.error('[IDE] Event handler error:', e)
        }
      }
    }
  }

  // ============================================================================
  // Workspace
  // ============================================================================

  /**
   * Open workspace in IDE
   */
  openWorkspace(connectionId: string, path: string): void {
    const connection = this.connections.get(connectionId)
    if (!connection) return

    try {
      switch (connection.type) {
        case 'vscode':
          execSync(`code "${path}"`, { stdio: 'ignore' })
          break
        case 'cursor':
          execSync(`cursor "${path}"`, { stdio: 'ignore' })
          break
        case 'windsurf':
          execSync(`windsurf "${path}"`, { stdio: 'ignore' })
          break
      }

      this.emit({ type: 'workspace_opened', path })
    } catch (e) {
      console.error('[IDE] Failed to open workspace:', e)
    }
  }

  /**
   * Close workspace in IDE
   */
  closeWorkspace(connectionId: string, path: string): void {
    this.emit({ type: 'workspace_closed', path })
  }
}

// ============================================================================
// Effect Context
// ============================================================================

export const IDEConfigContext = Context.GenericTag<IDEConfig>('IDEConfig')
export const IDEServiceContext = Context.GenericTag<IDEService>('IDEService')

// ============================================================================
// Singleton
// ============================================================================

let ideService: IDEService | null = null

export function getIDEService(config?: Partial<IDEConfig>): IDEService {
  if (!ideService) {
    ideService = new IDEService(config)
  }
  return ideService
}

// ============================================================================
// Convenience Functions
// ============================================================================

export function detectIDE(): IDEType | undefined {
  return getIDEService().detectIDE()
}

export function installIDEExtension(ide: IDEType): void {
  return getIDEService().installExtension(ide)
}

export function connectToIDE(ide: IDEType, endpoint?: string): IDEConnection {
  return getIDEService().connect(ide, endpoint)
}
