/**
 * Plugin System Types
 *
 * 简化版 Plugin 系统，支持：
 * - 工具扩展
 * - 生命周期钩子
 *
 * 参考来源:
 * - Anthropic-Leaked-Source-Code/plugins/
 * - opencode/packages/opencode/src/plugin/
 */

import { z } from 'zod'
import type { ToolDef } from '../tool/tool.js'

// ============================================================================
// Plugin Types
// ============================================================================

/**
 * Plugin manifest (package.json plugin section)
 */
export const PluginManifestSchema = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string().optional(),
  main: z.string().optional(),
  hyagent: z.object({
    tools: z.array(z.string()).optional(),
    hooks: z.array(z.string()).optional(),
  }).optional(),
})
export type PluginManifest = z.infer<typeof PluginManifestSchema>

/**
 * Plugin instance
 */
export interface Plugin {
  name: string
  version: string
  description?: string

  /**
   * Initialize the plugin
   */
  init?: () => void | Promise<void>

  /**
   * Get tools provided by this plugin
   */
  getTools?: () => ToolDef[]

  /**
   * Get lifecycle hooks
   */
  getHooks?: () => PluginHooks

  /**
   * Cleanup when plugin is unloaded
   */
  unload?: () => void | Promise<void>
}

/**
 * Plugin hooks for lifecycle events
 */
export interface PluginHooks {
  /**
   * Called before each agent iteration
   */
  onBeforeIteration?: (context: HookContext) => void | Promise<void>

  /**
   * Called after each agent iteration
   */
  onAfterIteration?: (context: HookContext & { result: IterationResult }) => void | Promise<void>

  /**
   * Called when a tool is about to be executed
   */
  onBeforeTool?: (context: HookContext & { tool: string; input: unknown }) => void | Promise<void>

  /**
   * Called after a tool is executed
   */
  onAfterTool?: (context: HookContext & { tool: string; input: unknown; result: unknown }) => void | Promise<void>

  /**
   * Called when session is created
   */
  onSessionCreate?: (context: HookContext & { sessionId: string }) => void | Promise<void>

  /**
   * Called when an error occurs
   */
  onError?: (context: HookContext & { error: Error }) => void | Promise<void>

  /**
   * Called when tool definitions are being built.
   * Allows plugins to modify, add, or remove tool definitions before sending to LLM.
   *
   * @param tools - Current array of tool definitions
   * @returns Modified tool definitions or void (if no changes)
   */
  onToolDefinition?: (tools: ToolDef[]) => ToolDef[] | void | Promise<ToolDef[] | void>
}

/**
 * Context passed to hooks
 */
export interface HookContext {
  sessionId?: string
  task?: string
  messages?: unknown[]
}

/**
 * Result of an agent iteration
 */
export interface IterationResult {
  stopReason: string
  iterations: number
}

// ============================================================================
// Plugin Registry Types
// ============================================================================

/**
 * Plugin registration
 */
export interface PluginRegistration {
  name: string
  version: string
  instance: Plugin
  tools: ToolDef[]
  hooks: PluginHooks
}

/**
 * Plugin loader options
 */
export interface PluginLoadOptions {
  /**
   * Plugin package name or path
   */
  name: string

  /**
   * Optional version constraint
   */
  version?: string

  /**
   * Plugin-specific options
   */
  options?: Record<string, unknown>
}
