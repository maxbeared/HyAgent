/**
 * MCP (Model Context Protocol) Module
 *
 * 提供 MCP 客户端功能，支持连接外部 MCP Server 并调用其工具。
 *
 * 参考来源:
 * - @modelcontextprotocol/sdk
 * - Anthropic-Leaked-Source-Code/services/mcp/
 * - opencode/packages/opencode/src/mcp/
 */

// Re-export everything from types
export type {
  MCPClient,
  MCPServerConfig,
  MCPServerState,
  MCPTool,
  MCPToolResult,
  MCPConnectionStatus,
} from './types.js'

// Re-export client
export { createMCPClient, MCPClientImpl } from './client.js'

// Re-export manager (synchronous, for use with Hono routes)
export { MCPServerManager, getMCPServerManager } from './manager.js'

// Re-export tool helpers (from tool/mcp.ts)
export {
  createMCPTool,
  createMCPListServersTool,
  createMCPListToolsTool,
} from '../tool/mcp.js'
export type { MCPInput } from '../tool/mcp.js'
