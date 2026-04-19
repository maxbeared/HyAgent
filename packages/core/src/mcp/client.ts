/**
 * MCP Client Implementation
 *
 * 使用 @modelcontextprotocol/sdk 实现 MCP 客户端，
 * 支持 stdio、HTTP、SSE 三种传输方式。
 * 支持 OAuth 认证。
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {
  CallToolResultSchema,
  ListToolsResultSchema,
  ListPromptsResultSchema,
  GetPromptResultSchema,
  ListResourcesResultSchema,
  ReadResourceResultSchema,
  type Tool as MCPToolDefinition,
} from '@modelcontextprotocol/sdk/types.js'
import type {
  MCPClient,
  MCPServerConfig,
  MCPTool,
  MCPToolResult,
  MCPPrompt,
  MCPPromptResult,
  MCPResource,
  MCPResourceContent,
  MCPConnectionStatus,
} from './types.js'
import { McpOAuthProvider, getMcpAuthManager } from './auth.js'

/**
 * MCP Client implementation
 */
export class MCPClientImpl implements MCPClient {
  private client: Client | null = null
  private status: MCPConnectionStatus = 'disconnected'
  private errorMessage?: string
  private config: MCPServerConfig
  private oauthProvider?: McpOAuthProvider

  constructor(config: MCPServerConfig) {
    this.config = config
    // Initialize OAuth provider if needed
    const authManager = getMcpAuthManager()
    if (authManager.needsAuth(config)) {
      this.oauthProvider = authManager.getProvider(config)
    }
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
      // Check if OAuth is needed
      if (this.oauthProvider) {
        const authStatus = this.oauthProvider.getAuthStatus()
        if (authStatus.needsAuth && !authStatus.authUrl) {
          throw new Error('OAuth authentication required but no auth URL available')
        }
      }

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

    // Build headers including OAuth token if available
    const headers: Record<string, string> = {}
    const authHeader = this.oauthProvider?.getAuthorizationHeader()
    if (authHeader) {
      headers['Authorization'] = authHeader
    }

    const transport = new StreamableHTTPClientTransport(
      new URL(this.config.url),
      { requestInit: { headers } }
    )

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
   * List available prompts from the server
   */
  async listPrompts(): Promise<MCPPrompt[]> {
    if (!this.client || this.status !== 'connected') {
      throw new Error('Client not connected')
    }

    try {
      const response = await this.client.request(
        { method: 'prompts/list' },
        ListPromptsResultSchema
      )

      return (response.prompts || []).map((prompt: any) => ({
        name: prompt.name,
        description: prompt.description,
        arguments: prompt.arguments,
      }))
    } catch (err) {
      // Server may not support prompts
      console.warn('listPrompts not supported:', err)
      return []
    }
  }

  /**
   * Get a prompt from the server
   */
  async getPrompt(name: string, args?: Record<string, unknown>): Promise<MCPPromptResult> {
    if (!this.client || this.status !== 'connected') {
      throw new Error('Client not connected')
    }

    try {
      const response = await this.client.request(
        {
          method: 'prompts/get',
          params: { name, arguments: args },
        },
        GetPromptResultSchema
      )

      return {
        messages: response.messages.map((msg: any) => ({
          role: msg.role,
          content: msg.content,
        })),
      }
    } catch (err) {
      throw new Error(`Failed to get prompt ${name}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /**
   * List available resources from the server
   */
  async listResources(): Promise<MCPResource[]> {
    if (!this.client || this.status !== 'connected') {
      throw new Error('Client not connected')
    }

    try {
      const response = await this.client.request(
        { method: 'resources/list' },
        ListResourcesResultSchema
      )

      return (response.resources || []).map((resource: any) => ({
        uri: resource.uri,
        name: resource.name,
        description: resource.description,
        mimeType: resource.mimeType,
      }))
    } catch (err) {
      // Server may not support resources
      console.warn('listResources not supported:', err)
      return []
    }
  }

  /**
   * Read a resource from the server
   */
  async readResource(uri: string): Promise<MCPResourceContent> {
    if (!this.client || this.status !== 'connected') {
      throw new Error('Client not connected')
    }

    try {
      const response = await this.client.request(
        {
          method: 'resources/read',
          params: { uri },
        },
        ReadResourceResultSchema
      )

      return {
        contents: response.contents.map((c: any) => ({
          uri: c.uri,
          mimeType: c.mimeType,
          text: c.text,
          blob: c.blob,
        })),
      }
    } catch (err) {
      throw new Error(`Failed to read resource ${uri}: ${err instanceof Error ? err.message : String(err)}`)
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
