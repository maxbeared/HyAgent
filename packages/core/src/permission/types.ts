/**
 * Permission Types - 融合Claude Code和OpenCode的类型定义
 *
 * 参考来源:
 * - Anthropic-Leaked-Source-Code/types/permissions.ts
 * - opencode/packages/opencode/src/permission/index.ts
 */

// ============================================================================
// Claude Code Types (PermissionMode, Rule, etc.)
// ============================================================================

/**
 * Permission mode determines how permissions are checked
 * 来自: Anthropic-Leaked-Source-Code/types/permissions.ts
 */
export type PermissionMode =
  | 'acceptEdits'   // 自动允许编辑操作
  | 'bypassPermissions' // 绕过所有权限检查 (谨慎使用)
  | 'default'       // 默认权限检查
  | 'dontAsk'       // 不询问，自动拒绝
  | 'plan'          // Planning模式，权限会bubble到父级
  | 'auto'          // 自动模式，使用AI分类器决策

/**
 * Permission behavior when rules match
 */
export type PermissionBehavior = 'allow' | 'deny' | 'ask'

/**
 * Rule source indicates where the rule came from
 * 来自: Anthropic-Leaked-Source-Code/types/permissions.ts
 */
export type PermissionRuleSource =
  | 'userSettings'
  | 'projectSettings'
  | 'localSettings'
  | 'flagSettings'
  | 'policySettings'
  | 'cliArg'
  | 'command'
  | 'session'

/**
 * Permission rule value
 * 来自: Anthropic-Leaked-Source-Code/types/permissions.ts
 */
export interface PermissionRuleValue {
  toolName: string
  ruleContent?: string // Optional content pattern to match
}

/**
 * A single permission rule
 * 来自: Anthropic-Leaked-Source-Code/types/permissions.ts
 */
export interface PermissionRule {
  source: PermissionRuleSource
  ruleBehavior: PermissionBehavior
  ruleValue: PermissionRuleValue
}

/**
 * Permission decision result
 */
export type PermissionDecision =
  | { behavior: 'allow'; updatedInput?: unknown }
  | { behavior: 'deny'; reason?: string }
  | { behavior: 'ask'; decisionReason?: { type: 'rule'; rule: PermissionRule } }
  | { behavior: 'passthrough'; updatedInput?: unknown }

// ============================================================================
// OpenCode Types (Rule, Ruleset, Request, Reply)
// ============================================================================

/**
 * Simple permission rule with glob pattern matching
 * 来自: opencode/packages/opencode/src/permission/index.ts
 */
export interface Rule {
  permission: string   // Tool name (e.g., "edit", "bash", "read")
  pattern: string       // Glob pattern (e.g., "*.txt", "/path/to/file")
  action: 'allow' | 'deny' | 'ask'
}

/**
 * A ruleset is an array of rules
 * 来自: opencode/packages/opencode/src/permission/index.ts
 */
export type Ruleset = Rule[]

/**
 * Permission request for a tool execution
 * 来自: opencode/packages/opencode/src/permission/index.ts
 */
export interface PermissionRequest {
  id: string
  permission: string
  patterns: string[]
  metadata: Record<string, unknown>
  always: string[] // Patterns to always allow
  tool?: {
    messageID: string
    callID: string
  }
}

/**
 * Permission reply types
 * 来自: opencode/packages/opencode/src/permission/index.ts
 */
export type PermissionReply = 'once' | 'always' | 'reject'

// ============================================================================
// Hybrid Types (Combined)
// ============================================================================

/**
 * Permission input for checking
 */
export interface PermissionInput {
  mode: PermissionMode
  toolName: string
  input: unknown
  context?: PermissionContext
}

/**
 * Permission context passed to permission checks
 * 来自: Anthropic-Leaked-Source-Code/Tool.ts (ToolPermissionContext)
 */
export interface PermissionContext {
  mode: PermissionMode
  additionalWorkingDirectories: Map<string, AdditionalWorkingDirectory>
  alwaysAllowRules: Ruleset
  alwaysDenyRules: Ruleset
  alwaysAskRules: Ruleset
  isBypassPermissionsModeAvailable: boolean
  shouldAvoidPermissionPrompts?: boolean
  prePlanMode?: PermissionMode
}

/**
 * Additional working directory configuration
 */
export interface AdditionalWorkingDirectory {
  path: string
  permissions: Ruleset
}

// ============================================================================
// Permission Result Types
// ============================================================================

/**
 * Result of a permission check
 */
export interface PermissionResult {
  behavior: 'allow' | 'deny' | 'ask' | 'passthrough'
  reason?: string
  updatedInput?: unknown
  rule?: PermissionRule
}

/**
 * Auto-mode classifier result
 * 来自: Anthropic-Leaked-Source-Code/utils/permissions/yoloClassifier.ts
 */
export interface ClassifierResult {
  shouldBlock: boolean
  reason?: string
  confidence: 'high' | 'medium' | 'low'
}

/**
 * Path validation result
 * 来自: Anthropic-Leaked-Source-Code/utils/permissions/pathValidation.ts
 */
export interface PathValidationResult {
  isSafe: boolean
  reason?: string
  pathType: 'normal' | 'dangerous' | 'blocked'
}
