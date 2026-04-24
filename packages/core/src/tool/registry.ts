/**
 * Tool Registry - 工具注册表
 *
 * 参考来源: opencode/packages/opencode/src/tool/registry.ts
 */

import { Effect, Layer, Context } from 'effect'
import type { ToolDef, ToolRegistry, ToolContext } from './tool.js'
import { ToolRegistryTag } from './tool.js'

export { ToolRegistryTag }
import { BashTool } from './bash.js'
import { ReadTool } from './read.js'
import { EditTool } from './edit.js'

/**
 * Tool registry implementation
 */
export const ToolRegistryImpl = Effect.gen(function* () {
  const tools = new Map<string, ToolDef>()

  // Register built-in tools
  const builtInTools = [BashTool, ReadTool, EditTool]

  for (const tool of builtInTools) {
    tools.set(tool.id, tool)
  }

  return {
    register(tool) {
      return Effect.sync(() => {
        tools.set(tool.id, tool)
      })
    },

    get(id) {
      return Effect.sync(() => {
        const tool = tools.get(id)
        if (!tool) {
          throw new Error(`Tool not found: ${id}`)
        }
        return tool
      })
    },

    list() {
      return Effect.sync(() => Array.from(tools.values()))
    },

    listByAgent(agent) {
      return Effect.sync(() => {
        // In a real implementation, filter by agent-specific tool permissions
        return Array.from(tools.values())
      })
    },
  }
})

/**
 * Layer for tool registry
 */
export const ToolRegistryLayer = Layer.effect(ToolRegistryTag, ToolRegistryImpl)

// ============================================================================
// Tool Executor
// ============================================================================

/**
 * Execute a tool by ID
 */
export function executeTool(
  toolId: string,
  input: unknown,
  context: ToolContext
): Effect.Effect<{ title: string; output: string; metadata: unknown }, Error, ToolRegistry> {
  return Effect.gen(function* () {
    const registry = yield* ToolRegistryTag
    const tool = yield* registry.get(toolId)

    // Parse and validate input
    const parsedInput = tool.parameters.parse(input)

    // Check permissions if tool supports it
    if (tool.checkPermissions) {
      const result = yield* tool.checkPermissions(parsedInput, context)
      if (result.behavior === 'deny') {
        return {
          title: 'Permission Denied',
          output: result.reason ?? 'Permission denied',
          metadata: {},
        }
      }
    }

    // Execute
    const execResult = yield* tool.execute(parsedInput, context)

    return {
      title: execResult.title,
      output: execResult.output,
      metadata: execResult.metadata,
    }
  })
}
