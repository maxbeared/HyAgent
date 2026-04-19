/**
 * MCP Server Manager - 简单的 MCP Server 管理器
 *
 * 提供 MCP Server 的连接管理和工具调用功能。
 * 这是一个简化版本，不依赖 Effect，便于与 Hono 路由集成。
 */

import { createMCPClient, MCPClientImpl } from './client.js'
import type {
  MCPServerConfig,
  MCPServerState,
  MCPTool,
  MCPToolResult,
  MCPConnectionStatus,
} from './types.js'

/**
 * MCP Server Manager
 */
export class MCPServerManager {
  private servers: Map<string, MCPServerState & { client: MCPClientImpl }> = new Map()

  /**
   * Add an MCP server configuration
   */
  addServer(config: MCPServerConfig): void {
    if (this.servers.has(config.name)) {
      throw new Error(`MCP server already exists: ${config.name}`)
    }

    const client = createMCPClient(config) as MCPClientImpl
    this.servers.set(config.name, {
      config,
      client,
      status: 'disconnected',
      tools: [],
    })
  }

  /**
   * Remove an MCP server
   */
  removeServer(name: string): void {
    const entry = this.servers.get(name)
    if (!entry) {
      throw new Error(`MCP server not found: ${name}`)
    }

    entry.client.disconnect()
    this.servers.delete(name)
  }

  /**
   * Get all server states
   */
  getServers(): MCPServerState[] {
    return Array.from(this.servers.values()).map((e) => ({
      config: e.config,
      status: e.status,
      error: e.error,
      tools: e.tools,
    }))
  }

  /**
   * Connect to a server
   */
  async connect(name: string): Promise<void> {
    const entry = this.servers.get(name)
    if (!entry) {
      throw new Error(`MCP server not found: ${name}`)
    }

    try {
      await entry.client.connect()
      entry.status = 'connected'
      entry.tools = await entry.client.listTools()
    } catch (err) {
      entry.status = 'error'
      entry.error = err instanceof Error ? err.message : String(err)
      throw err
    }
  }

  /**
   * Disconnect from a server
   */
  disconnect(name: string): void {
    const entry = this.servers.get(name)
    if (!entry) {
      throw new Error(`MCP server not found: ${name}`)
    }

    entry.client.disconnect()
    entry.status = 'disconnected'
  }

  /**
   * Get server state
   */
  getServer(name: string): MCPServerState | undefined {
    const entry = this.servers.get(name)
    if (!entry) return undefined
    return {
      config: entry.config,
      status: entry.status,
      error: entry.error,
      tools: entry.tools,
    }
  }

  /**
   * Call a tool on a server
   */
  async callTool(name: string, toolName: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    const entry = this.servers.get(name)
    if (!entry) {
      throw new Error(`MCP server not found: ${name}`)
    }

    if (entry.status !== 'connected') {
      throw new Error(`MCP server not connected: ${name}`)
    }

    return entry.client.callTool(toolName, args)
  }

  /**
   * Get all available tools from all connected servers
   */
  getAllTools(): Array<{ server: string; tool: MCPTool }> {
    const tools: Array<{ server: string; tool: MCPTool }> = []

    for (const [name, entry] of this.servers) {
      if (entry.status === 'connected') {
        for (const tool of entry.tools) {
          tools.push({ server: name, tool })
        }
      }
    }

    return tools
  }
}

// Singleton instance
let managerInstance: MCPServerManager | null = null

/**
 * Get the MCP server manager singleton
 */
export function getMCPServerManager(): MCPServerManager {
  if (!managerInstance) {
    managerInstance = new MCPServerManager()
  }
  return managerInstance
}
