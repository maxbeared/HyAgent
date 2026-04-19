/**
 * MCP (Model Context Protocol) Types
 *
 * 参考来源:
 * - @modelcontextprotocol/sdk
 * - Anthropic-Leaked-Source-Code/services/mcp/
 * - opencode/packages/opencode/src/mcp/
 */

import { z } from 'zod'

// ============================================================================
// MCP Server Configuration
// ============================================================================

/**
 * MCP Server transport type
 */
export const MCPTransportTypeSchema = z.enum(['stdio', 'http', 'sse'])
export type MCPTransportType = z.infer<typeof MCPTransportTypeSchema>

/**
 * MCP Server configuration
 */
export const MCPServerConfigSchema = z.object({
  name: z.string(),
  command: z.string().optional(),       // For stdio: the command to run
  args: z.array(z.string()).optional(), // For stdio: command arguments
  env: z.record(z.string()).optional(), // For stdio: environment variables
  url: z.string().optional(),           // For http/sse: the server URL
})
export type MCPServerConfig = z.infer<typeof MCPServerConfigSchema>

/**
 * MCP Server status
 */
export const MCPConnectionStatusSchema = z.enum(['connecting', 'connected', 'disconnected', 'error'])
export type MCPConnectionStatus = z.infer<typeof MCPConnectionStatusSchema>

/**
 * MCP Server state
 */
export interface MCPServerState {
  config: MCPServerConfig
  status: MCPConnectionStatus
  error?: string
  tools: MCPTool[]
}

/**
 * MCP Tool definition from server
 */
export interface MCPTool {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties?: Record<string, any>
    required?: string[]
  }
}

/**
 * MCP Tool call result
 */
export interface MCPToolResult {
  success: boolean
  content: Array<{
    type: 'text' | 'image' | 'resource'
    text?: string
    data?: string
    mimeType?: string
  }>
  error?: string
}

// ============================================================================
// MCP JSON-RPC Protocol Types
// ============================================================================

/**
 * JSON-RPC request/response types for MCP protocol
 */
export interface JSONRPCRequest {
  jsonrpc: '2.0'
  id: number | string
  method: string
  params?: Record<string, unknown>
}

export interface JSONRPCResponse {
  jsonrpc: '2.0'
  id: number | string
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

export interface JSONRPCNotification {
  jsonrpc: '2.0'
  method: string
  params?: Record<string, unknown>
}

// ============================================================================
// MCP Client Interface
// ============================================================================

/**
 * MCP Client interface for connecting to servers
 */
export interface MCPClient {
  /**
   * Connect to the MCP server
   */
  connect(): Promise<void>

  /**
   * Disconnect from the MCP server
   */
  disconnect(): void

  /**
   * List available tools from the server
   */
  listTools(): Promise<MCPTool[]>

  /**
   * Call a tool on the server
   */
  callTool(name: string, args: Record<string, unknown>): Promise<MCPToolResult>

  /**
   * Get connection status
   */
  getStatus(): MCPConnectionStatus
}
