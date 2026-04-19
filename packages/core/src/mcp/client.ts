/**
 * MCP Client Implementation
 *
 * 使用 @modelcontextprotocol/sdk 实现 MCP 客户端，
 * 支持 stdio、HTTP、SSE 三种传输方式。
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {
  CallToolResultSchema,
  ListToolsResultSchema,
  type Tool as MCPToolDefinition,
} from '@modelcontextprotocol/sdk/types.js'
import type {
  MCPClient,
  MCPServerConfig,
  MCPTool,
  MCPToolResult,
  MCPConnectionStatus,
} from './types.js'
import { spawn } from 'child_process'

/**
 * MCP Client implementation
 */
export class MCPClientImpl implements MCPClient {
  private client: Client | null = null
  private status: MCPConnectionStatus = 'disconnected'
  private errorMessage?: string
  private config: MCPServerConfig

  constructor(config: MCPServerConfig) {
    this.config = config
  }

  /**
   * Connect to the MCP server
   */
  async connect(): Promise<void> {
    if (this.status === 'connected') {
      return
    }

    this.status = 'connecting'

    try {
      if (this.config.command) {
        // Stdio transport
        await this.connectStdio()
      } else if (this.config.url) {
        // HTTP/SSE transport
        await this.connectHttp()
      } else {
        throw new Error('MCP server config must have either command or url')
      }

      this.status = 'connected'
    } catch (err) {
      this.status = 'error'
      this.errorMessage = err instanceof Error ? err.message : String(err)
      throw err
    }
  }

  /**
   * Connect using stdio transport
   */
  private async connectStdio(): Promise<void> {
    if (!this.config.command) {
      throw new Error('Command is required for stdio transport')
    }

    const transport = new StdioClientTransport({
      command: this.config.command,
      args: this.config.args ?? [],
      env: this.config.env ?? {},
    })

    this.client = new Client({
      name: 'hybrid-agent',
      version: '0.1.0',
    })

    await this.client.connect(transport)
  }

  /**
   * Connect using HTTP/SSE transport
   */
  private async connectHttp(): Promise<void> {
    if (!this.config.url) {
      throw new Error('URL is required for HTTP transport')
    }

    const transport = new StreamableHTTPClientTransport({
      url: new URL(this.config.url),
    })

    this.client = new Client({
      name: 'hybrid-agent',
      version: '0.1.0',
    })

    await this.client.connect(transport)
  }

  /**
   * Disconnect from the MCP server
   */
  disconnect(): void {
    if (this.client) {
      this.client.close()
      this.client = null
    }
    this.status = 'disconnected'
  }

  /**
   * List available tools from the server
   */
  async listTools(): Promise<MCPTool[]> {
    if (!this.client || this.status !== 'connected') {
      throw new Error('Client not connected')
    }

    const response = await this.client.request(
      { method: 'tools/list' },
      ListToolsResultSchema
    )

    return response.tools.map((tool: MCPToolDefinition) => ({
      name: tool.name,
      description: tool.description ?? '',
      inputSchema: tool.inputSchema as MCPTool['inputSchema'],
    }))
  }

  /**
   * Call a tool on the server
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    if (!this.client || this.status !== 'connected') {
      throw new Error('Client not connected')
    }

    try {
      const response = await this.client.request(
        {
          method: 'tools/call',
          params: {
            name,
            arguments: args,
          },
        },
        CallToolResultSchema
      )

      return {
        success: !response.isError,
        content: response.content.map((block) => {
          if (block.type === 'text') {
            return { type: 'text' as const, text: block.text }
          } else if (block.type === 'image') {
            return {
              type: 'image' as const,
              data: block.data,
              mimeType: block.mimeType,
            }
          } else {
            return { type: 'text' as const, text: JSON.stringify(block) }
          }
        }),
      }
    } catch (err) {
      return {
        success: false,
        content: [],
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  /**
   * Get connection status
   */
  getStatus(): MCPConnectionStatus {
    return this.status
  }

  /**
   * Get error message if any
   */
  getError(): string | undefined {
    return this.errorMessage
  }
}

/**
 * Create an MCP client from config
 */
export function createMCPClient(config: MCPServerConfig): MCPClient {
  return new MCPClientImpl(config)
}
