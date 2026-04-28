/**
 * Tool System - 融合Claude Code和OpenCode的工具系统
 *
 * 特性:
 * - Effect-based执行 (来自OpenCode)
 * - Permission检查集成 (来自Claude Code)
 * - Path安全检查 (来自Claude Code)
 * - Sandbox决策 (来自Claude Code)
 *
 * 参考来源:
 * - opencode/packages/opencode/src/tool/tool.ts
 * - Anthropic-Leaked-Source-Code/Tool.ts
 */

import { Effect, Layer, Context } from 'effect'
import { z } from 'zod'

// ============================================================================
// Tool Types
// ============================================================================

/**
 * Tool definition
 * 融合了Claude Code的安全特性和OpenCode的Effect模式
 */
export interface ToolDef<Parameters extends z.ZodType = z.ZodType, M extends Record<string, unknown> = Record<string, unknown>> {
  id: string
  description: string
  parameters: Parameters
  execute(args: z.infer<Parameters>, ctx: ToolContext): Effect.Effect<ExecuteResult<M>>

  // 来自Claude Code的安全特性
  /**
   * Check permissions before execution
   */
  checkPermissions?: (
    input: z.infer<Parameters>,
    ctx: ToolContext
  ) => Effect.Effect<PermissionResult>

  /**
   * Input for auto-mode classifier
   */
  toAutoClassifierInput?: (input: z.infer<Parameters>) => string

  /**
   * Whether this tool can run concurrently
   */
  isConcurrencySafe?: (input: z.infer<Parameters>) => boolean
}

/**
 * Tool metadata
 */
export type Metadata = Record<string, unknown>

/**
 * Tool execution result
 */
export interface ExecuteResult<M extends Record<string, unknown> = Record<string, unknown>> {
  title: string
  metadata: M
  output: string
  attachments?: ToolAttachment[]
}

/**
 * File attachment in tool result
 */
export interface ToolAttachment {
  type: 'file' | 'image' | 'text'
  name: string
  content: string
  mimeType?: string
}

/**
 * Tool context passed during execution
 * 融合了Claude Code的ToolUseContext和OpenCode的Tool.Context
 */
export interface ToolContext {
  sessionID: string
  messageID: string
  agent: string
  abort: AbortSignal
  callID?: string
  messages: ToolMessage[]

  // 来自Claude Code的扩展
  permission: PermissionContext
  sandbox: SandboxContext
}

/**
 * Minimal message type for tool context
 */
export interface ToolMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
}

/**
 * Permission result type
 */
export interface PermissionResult {
  behavior: 'allow' | 'deny' | 'ask' | 'passthrough'
  reason?: string
}

/**
 * Sandbox context
 */
export interface SandboxContext {
  manager: SandboxManager
  isSandboxed: boolean
}

/**
 * Sandbox manager interface
 */
export interface SandboxManager {
  shouldSandbox(command: string): boolean
  isPathAllowed(path: string): boolean
}

/**
 * Permission context interface
 */
export interface PermissionContext {
  mode: PermissionMode
  alwaysAllowRules: PermissionRule[]
  alwaysDenyRules: PermissionRule[]
  alwaysAskRules: PermissionRule[]
}

export type PermissionMode = 'acceptEdits' | 'bypassPermissions' | 'default' | 'dontAsk' | 'plan' | 'auto'

export interface PermissionRule {
  permission: string
  pattern: string
  action: 'allow' | 'deny' | 'ask'
}

// ============================================================================
// Tool Service
// ============================================================================

/**
 * Tool registry service
 */
export interface ToolRegistry {
  register(tool: ToolDef): Effect.Effect<void>
  get(id: string): Effect.Effect<ToolDef>
  list(): Effect.Effect<ToolDef[]>
  listByAgent(agent: string): Effect.Effect<ToolDef[]>
}

/**
 * Tool registry tag for Effect context
 */
export const ToolRegistryTag = Context.GenericTag<ToolRegistry>('@hyagent/tool-registry')

// ============================================================================
// Input/Output Schemas (examples)
// ============================================================================

/**
 * Bash tool input schema
 */
export const BashInput = z.object({
  command: z.string().describe('Shell command to execute'),
  timeout: z.number().optional().describe('Timeout in milliseconds'),
  cwd: z.string().optional().describe('Working directory'),
})

/**
 * Read tool input schema
 */
export const ReadInput = z.object({
  path: z.string().describe('File path to read'),
  limit: z.number().optional().describe('Limit number of lines'),
  offset: z.number().optional().describe('Start reading from line'),
})

/**
 * Edit tool input schema
 */
export const EditInput = z.object({
  path: z.string().describe('File path to edit'),
  oldString: z.string().describe('Text to replace'),
  newString: z.string().describe('Replacement text'),
})

/**
 * Write tool input schema
 */
export const WriteInput = z.object({
  path: z.string().describe('File path to write'),
  content: z.string().describe('Content to write'),
})

/**
 * Glob tool input schema
 */
export const GlobInput = z.object({
  pattern: z.string().describe('Glob pattern to match'),
  cwd: z.string().optional().describe('Working directory'),
})

/**
 * Grep tool input schema
 */
export const GrepInput = z.object({
  pattern: z.string().describe('Search pattern'),
  path: z.string().optional().describe('Path to search in'),
  glob: z.string().optional().describe('File glob pattern'),
  caseSensitive: z.boolean().optional().default(true),
})
