/**
 * MCP Tool - 让 Agent 能够调用 MCP Server 工具
 *
 * 这个工具封装了 MCP Service，允许 Agent 通过统一的接口
 * 调用所有已连接的 MCP Server 上的工具。
 */

import { z } from 'zod'
import { Effect } from 'effect'
import type { ToolDef, ToolContext, ExecuteResult } from './tool.js'
import type { MCPToolResult } from '../mcp/index.js'

// ============================================================================
// Tool Input/Output Types
// ============================================================================

/**
 * MCP Tool input schema
 */
export const MCPInputSchema = z.object({
  server: z.string().describe('MCP server name'),
  tool: z.string().describe('Tool name to call'),
  args: z.record(z.unknown()).optional().describe('Tool arguments'),
})

export type MCPInput = z.infer<typeof MCPInputSchema>

/**
 * MCP Tool metadata
 */
export type MCPMetadata = {
  server: string
  tool: string
  durationMs: number
  success: boolean
}

// ============================================================================
// MCP Tool Definition
// ============================================================================

/**
 * Create the MCP tool for calling external MCP server tools
 *
 * 注意：这个工具需要 MCPService 在上下文中可用。
 * Agent 使用此工具前需要先通过配置添加并连接 MCP servers。
 */
export function createMCPTool(
  getMCPTools: () => Promise<Array<{ server: string; tool: any }>>,
  callMCPtool: (server: string, tool: string, args: Record<string, unknown>) => Promise<MCPToolResult>
): ToolDef<typeof MCPInputSchema, MCPMetadata> {
  return {
    id: 'mcp',
    description: 'Call a tool on a connected MCP (Model Context Protocol) server. Use this to access external tools provided by MCP servers like filesystem, memory, or custom tools.',
    parameters: MCPInputSchema,

    isConcurrencySafe() {
      return false // MCP calls should be sequential to maintain state
    },

    execute(input, _ctx) {
      return Effect.gen(function* () {
        const startTime = Date.now()

        // First, get available tools to validate the request
        const availableTools = yield* Effect.promise(() => getMCPTools())
        const matchingTool = availableTools.find(
          (t) => t.server === input.server && t.tool.name === input.tool
        )

        if (!matchingTool) {
          const available = availableTools
            .map((t) => `${t.server}:${t.tool.name}`)
            .join(', ')
          return {
            title: 'MCP Tool Error',
            metadata: { server: input.server, tool: input.tool, durationMs: Date.now() - startTime, success: false } as MCPMetadata,
            output: `Tool '${input.tool}' on server '${input.server}' not found.\nAvailable tools: ${available || 'none'}`,
          }
        }

        // Call the MCP tool
        const result = yield* Effect.promise(() =>
          callMCPtool(input.server, input.tool, input.args ?? {})
        )

        const durationMs = Date.now() - startTime

        // Format the result
        let output = ''
        if (result.success) {
          output = result.content
            .map((block) => {
              if (block.type === 'text' && block.text) {
                return block.text
              } else if (block.type === 'image' && block.data) {
                return `[Image: ${block.mimeType || 'image'}]`
              }
              return JSON.stringify(block)
            })
            .join('\n')
        } else {
          output = `Error: ${result.error || 'Unknown error'}`
        }

        return {
          title: `MCP: ${input.server}/${input.tool}`,
          metadata: { server: input.server, tool: input.tool, durationMs, success: result.success } as MCPMetadata,
          output: output.trim(),
        }
      })
    },
  }
}

/**
 * MCP List Servers Tool - 列出已配置的 MCP servers
 */
export const MCPListServersInputSchema = z.object({})

export function createMCPListServersTool(
  getServers: () => Promise<Array<{ name: string; status: string; toolCount: number }>>
): ToolDef<typeof MCPListServersInputSchema, Record<string, never>> {
  return {
    id: 'mcp_list_servers',
    description: 'List all configured MCP servers and their status',
    parameters: MCPListServersInputSchema,

    isConcurrencySafe() {
      return true
    },

    execute(_input, _ctx) {
      return Effect.gen(function* () {
        const servers = yield* Effect.promise(() => getServers())

        if (servers.length === 0) {
          return {
            title: 'MCP Servers',
            metadata: {},
            output: 'No MCP servers configured.',
          }
        }

        const lines = servers.map(
          (s) => `- ${s.name}: ${s.status} (${s.toolCount} tools)`
        )

        return {
          title: 'MCP Servers',
          metadata: {},
          output: `Configured MCP servers:\n${lines.join('\n')}`,
        }
      })
    },
  }
}

/**
 * MCP List Tools Tool - 列出某个 server 上的工具
 */
export const MCPListToolsInputSchema = z.object({
  server: z.string().optional().describe('MCP server name (optional, lists all if not specified)'),
})

export function createMCPListToolsTool(
  getTools: (server?: string) => Promise<Array<{ server: string; tool: any }>>
): ToolDef<typeof MCPListToolsInputSchema, Record<string, never>> {
  return {
    id: 'mcp_list_tools',
    description: 'List available tools on MCP servers',
    parameters: MCPListToolsInputSchema,

    isConcurrencySafe() {
      return true
    },

    execute(input, _ctx) {
      return Effect.gen(function* () {
        const tools = yield* Effect.promise(() => getTools(input.server ?? undefined))

        if (tools.length === 0) {
          return {
            title: 'MCP Tools',
            metadata: {},
            output: 'No MCP tools available.',
          }
        }

        // Group by server
        const byServer = new Map<string, any[]>()
        for (const { server, tool } of tools) {
          if (!byServer.has(server)) {
            byServer.set(server, [])
          }
          byServer.get(server)!.push(tool)
        }

        const lines: string[] = []
        for (const [server, serverTools] of byServer) {
          lines.push(`\n${server}:`)
          for (const tool of serverTools) {
            lines.push(`  - ${tool.name}: ${tool.description || '(no description)'}`)
          }
        }

        return {
          title: 'MCP Tools',
          metadata: {},
          output: `Available MCP tools:${lines.join('\n')}`,
        }
      })
    },
  }
}
