/**
 * Bus Event Types
 *
 * 简单的 PubSub 事件系统，用于模块间松耦合通信。
 *
 * 参考来源:
 * - opencode/packages/opencode/src/bus/bus-event.ts
 */

import { z } from 'zod'

// ============================================================================
// Event Types
// ============================================================================

/**
 * Event handler type
 */
export type EventHandler<T = unknown> = (data: T) => void | Promise<void>

/**
 * Event definition schema
 */
export function defineEvent<T extends z.ZodType>(
  name: string,
  schema: T
) {
  return {
    name,
    schema,
    parse: (data: unknown) => schema.parse(data),
  }
}

/**
 * Typed event definition
 */
export interface EventDefinition<T = unknown> {
  name: string
  schema: z.ZodType<T>
  parse: (data: unknown) => T
}

// ============================================================================
// Predefined Events
// ============================================================================

/**
 * Session events
 */
export const SessionEvents = {
  Created: defineEvent('session:created', z.object({
    sessionId: z.string(),
  })),

  Deleted: defineEvent('session:deleted', z.object({
    sessionId: z.string(),
  })),

  MessageAdded: defineEvent('session:message_added', z.object({
    sessionId: z.string(),
    messageId: z.string(),
    role: z.enum(['user', 'assistant', 'system']),
  })),
} as const

/**
 * Agent events
 */
export const AgentEvents = {
  IterationStart: defineEvent('agent:iteration_start', z.object({
    sessionId: z.string(),
    iteration: z.number(),
  })),

  IterationEnd: defineEvent('agent:iteration_end', z.object({
    sessionId: z.string(),
    iteration: z.number(),
    stopReason: z.string(),
  })),

  ToolStart: defineEvent('agent:tool_start', z.object({
    sessionId: z.string(),
    tool: z.string(),
    input: z.unknown(),
  })),

  ToolEnd: defineEvent('agent:tool_end', z.object({
    sessionId: z.string(),
    tool: z.string(),
    success: z.boolean(),
  })),

  Error: defineEvent('agent:error', z.object({
    sessionId: z.string(),
    error: z.string(),
  })),
} as const

/**
 * MCP events
 */
export const MCPEvents = {
  ServerConnected: defineEvent('mcp:server_connected', z.object({
    serverName: z.string(),
  })),

  ServerDisconnected: defineEvent('mcp:server_disconnected', z.object({
    serverName: z.string(),
  })),

  ToolCall: defineEvent('mcp:tool_call', z.object({
    serverName: z.string(),
    toolName: z.string(),
    success: z.boolean(),
  })),
} as const

/**
 * Plugin events
 */
export const PluginEvents = {
  Loaded: defineEvent('plugin:loaded', z.object({
    name: z.string(),
    version: z.string(),
  })),

  Unloaded: defineEvent('plugin:unloaded', z.object({
    name: z.string(),
  })),

  Error: defineEvent('plugin:error', z.object({
    name: z.string(),
    error: z.string(),
  })),
} as const

/**
 * All predefined events
 */
export const Events = {
  ...SessionEvents,
  ...AgentEvents,
  ...MCPEvents,
  ...PluginEvents,
} as const

/**
 * Event name to type mapping
 */
export type EventData<E extends EventDefinition> = z.infer<E['schema']>
