/**
 * LSP Client - Language Server Protocol client implementation
 *
 * 参考来源: opencode/packages/opencode/src/lsp/client.ts
 */

import { createMessageConnection, MessageConnection } from 'vscode-jsonrpc'
import { StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node'
import type { Diagnostic } from 'vscode-languageserver-protocol'
import { pathToFileURL, fileURLToPath } from 'url'
import path from 'path'
import { readFile } from 'fs/promises'

const DIAGNOSTICS_DEBOUNCE_MS = 150

export interface LSPServerHandle {
  process: {
    stdin: NodeJS.WritableStream
    stdout: NodeJS.ReadableStream
    pid: number
  }
  initialization?: Record<string, unknown>
}

export interface LSPClientInfo {
  root: string
  serverID: string
  connection: MessageConnection
  diagnostics: Map<string, Diagnostic[]>
  notify: {
    open(input: { path: string }): Promise<void>
  }
  waitForDiagnostics(input: { path: string }): Promise<void>
  shutdown(): Promise<void>
}

type DiagnosticsHandler = (params: { uri: string; diagnostics: Diagnostic[] }) => void

/**
 * Create an LSP client connection to a server
 */
export async function createLSPClient(input: {
  serverID: string
  server: LSPServerHandle
  root: string
  onDiagnostics?: DiagnosticsHandler
}): Promise<LSPClientInfo> {
  const { serverID, server, root } = input

  const connection = createMessageConnection(
    new StreamMessageReader(server.process.stdout as any),
    new StreamMessageWriter(server.process.stdin as any)
  )

  const diagnostics = new Map<string, Diagnostic[]>()

  connection.onNotification('textDocument/publishDiagnostics', (params) => {
    const filePath = fileURLToPath(params.uri)
    const exists = diagnostics.has(filePath)
    diagnostics.set(filePath, params.diagnostics)

    if (!exists || serverID === 'typescript') return

    if (input.onDiagnostics) {
      input.onDiagnostics({ uri: params.uri, diagnostics: params.diagnostics })
    }
  })

  connection.onRequest('window/workDoneProgress/create', () => null)
  connection.onRequest('workspace/configuration', async () => [server.initialization ?? {}])
  connection.onRequest('client/registerCapability', async () => {})
  connection.onRequest('client/unregisterCapability', async () => {})
  connection.onRequest('workspace/workspaceFolders', async () => [
    { name: 'workspace', uri: pathToFileURL(root).href }
  ])

  connection.listen()

  // Initialize the LSP server
  await connection.sendRequest('initialize', {
    rootUri: pathToFileURL(root).href,
    processId: server.process.pid,
    workspaceFolders: [{ name: 'workspace', uri: pathToFileURL(root).href }],
    initializationOptions: server.initialization ?? {},
    capabilities: {
      window: { workDoneProgress: true },
      workspace: {
        configuration: true,
        didChangeWatchedFiles: { dynamicRegistration: true }
      },
      textDocument: {
        synchronization: { didOpen: true, didChange: true },
        publishDiagnostics: { versionSupport: true }
      }
    }
  })

  await connection.sendNotification('initialized', {})

  if (server.initialization) {
    await connection.sendNotification('workspace/didChangeConfiguration', {
      settings: server.initialization
    })
  }

  const files: Record<string, number> = {}

  const result: LSPClientInfo = {
    root,
    serverID,
    connection,
    diagnostics,
    notify: {
      async open(input: { path: string }) {
        input.path = path.isAbsolute(input.path) ? input.path : path.resolve(root, input.path)
        const text = await readFile(input.path, 'utf-8').catch(() => '')
        const extension = path.extname(input.path)

        const version = files[input.path]
        if (version !== undefined) {
          await connection.sendNotification('workspace/didChangeWatchedFiles', {
            changes: [{ uri: pathToFileURL(input.path).href, type: 2 }]
          })

          const next = version + 1
          files[input.path] = next

          await connection.sendNotification('textDocument/didChange', {
            textDocument: { uri: pathToFileURL(input.path).href, version: next },
            contentChanges: [{ text }]
          })
          return
        }

        await connection.sendNotification('workspace/didChangeWatchedFiles', {
          changes: [{ uri: pathToFileURL(input.path).href, type: 1 }]
        })

        diagnostics.delete(input.path)
        await connection.sendNotification('textDocument/didOpen', {
          textDocument: {
            uri: pathToFileURL(input.path).href,
            languageId: 'typescript',
            version: 0,
            text
          }
        })
        files[input.path] = 0
      }
    },
    waitForDiagnostics: async (input: { path: string }) => {
      const normalizedPath = path.isAbsolute(input.path) ? input.path : path.resolve(root, input.path)
      let timeout: ReturnType<typeof setTimeout>

      return new Promise<void>((resolve) => {
        const check = () => {
          if (diagnostics.has(normalizedPath)) {
            clearTimeout(timeout)
            resolve()
          } else {
            timeout = setTimeout(check, 50)
          }
        }
        setTimeout(check, 50)
      })
    },
    shutdown: async () => {
      connection.end()
      connection.dispose()
    }
  }

  return result
}
