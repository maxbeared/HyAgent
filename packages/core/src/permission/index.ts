/**
 * Permission Service - 融合Claude Code和OpenCode的权限系统
 *
 * 提供完整的权限检查、请求、评估功能：
 * - 7步检查管道 (Claude Code)
 * - 扁平规则匹配 (OpenCode)
 * - 路径安全检查 (Claude Code)
 * - 沙箱决策 (Claude Code)
 *
 * 参考来源:
 * - Anthropic-Leaked-Source-Code/utils/permissions/permissions.ts
 * - opencode/packages/opencode/src/permission/index.ts
 */

import { Effect, Layer, Context } from 'effect'
import type {
  PermissionMode,
  PermissionResult,
  PermissionRequest,
  PermissionContext,
  Rule,
  Ruleset,
  PathValidationResult,
} from './types.js'
import { runPermissionPipeline, checkPathSafety, checkShouldSandbox } from './pipeline.js'
import { evaluate, mergeRulesets } from './evaluate.js'
import { validatePathSafety, validateCommandPaths } from './pathValidation.js'
import { sandboxManager, SandboxManager } from './sandbox.js'

// ============================================================================
// Service Interface
// ============================================================================

/**
 * Permission Service interface
 */
export interface PermissionService {
  /**
   * Check permission for a tool execution
   */
  check(input: {
    mode: PermissionMode
    toolName: string
    input: unknown
    context: PermissionContext
    paths?: string[]
  }): Effect.Effect<PermissionResult>

  /**
   * Request user permission for a tool
   */
  ask(request: PermissionRequest): Effect.Effect<void>

  /**
   * Evaluate rules for a permission/pattern
   */
  evaluateRules(permission: string, pattern: string, ...rulesets: Ruleset[]): Effect.Effect<Rule>

  /**
   * Check path safety
   */
  checkPathSafety(path: string): Effect.Effect<PathValidationResult>

  /**
   * Check if command should use sandbox
   */
  shouldSandbox(command: string): Effect.Effect<boolean>

  /**
   * Check command paths for safety
   */
  checkCommandPaths(
    command: string
  ): Effect.Effect<{ isSafe: boolean; unsafePaths: string[]; reasons: string[] }>

  /**
   * Create isolated permission context for a worker
   */
  createIsolatedContext(rules: Ruleset): Effect.Effect<PermissionContext>

  /**
   * Merge multiple rulesets
   */
  mergeRules(...rulesets: Ruleset[]): Effect.Effect<Ruleset>
}

/**
 * Permission service tag for Effect context
 */
export const PermissionServiceTag = Context.GenericTag<PermissionService>('@hybrid-agent/permission')

// ============================================================================
// Service Implementation
// ============================================================================

/**
 * Create the Permission Service layer
 */
export const PermissionServiceLayer = Layer.effect(
  PermissionServiceTag,
  Effect.gen(function* () {
    // Pending permission requests
    const pendingRequests = new Map<string, PermissionRequest>()
    const approvedRules = new Map<string, Rule>()

    return {
      check(input) {
        return Effect.sync(() => {
          const result = runPermissionPipeline({
            mode: input.mode,
            toolName: input.toolName,
            input: input.input,
            context: input.context,
            additionalChecks: { paths: input.paths },
          })
          return {
            behavior: result.behavior,
            reason: result.reason,
            updatedInput: result.updatedInput,
            rule: result.rule as any,
          }
        })
      },

      ask(request) {
        return Effect.sync(() => {
          pendingRequests.set(request.id, request)
          // In a real implementation, this would trigger UI prompt
          // For now, we just store the request
        })
      },

      evaluateRules(permission, pattern, ...rulesets) {
        return Effect.sync(() => {
          return evaluate(permission, pattern, ...rulesets)
        })
      },

      checkPathSafety(path) {
        return Effect.sync(() => {
          const result = validatePathSafety(path)
          return {
            isSafe: result.isSafe,
            reason: result.reason ?? undefined,
            pathType: result.pathType,
          }
        })
      },

      shouldSandbox(command) {
        return Effect.sync(() => sandboxManager.shouldSandbox(command))
      },

      checkCommandPaths(command) {
        return Effect.sync(() => {
          return validateCommandPaths(command)
        })
      },

      createIsolatedContext(rules) {
        return Effect.sync(() => {
          return createDefaultContext(rules)
        })
      },

      mergeRules(...rulesets) {
        return Effect.sync(() => mergeRulesets(...rulesets))
      },
    }
  })
)

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a default permission context
 */
export function createDefaultContext(additionalRules?: Ruleset): PermissionContext {
  const alwaysAllowRules: Ruleset = additionalRules
    ? additionalRules.filter((r) => r.action === 'allow')
    : []

  const alwaysDenyRules: Ruleset = additionalRules
    ? additionalRules.filter((r) => r.action === 'deny')
    : []

  const alwaysAskRules: Ruleset = additionalRules
    ? additionalRules.filter((r) => r.action === 'ask')
    : []

  return {
    mode: 'default',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules,
    alwaysDenyRules,
    alwaysAskRules,
    isBypassPermissionsModeAvailable: true,
  }
}

/**
 * Create a permissive context (for trusted environments)
 */
export function createPermissiveContext(): PermissionContext {
  return {
    mode: 'bypassPermissions',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: [{ permission: '*', pattern: '*', action: 'allow' }],
    alwaysDenyRules: [],
    alwaysAskRules: [],
    isBypassPermissionsModeAvailable: true,
  }
}

/**
 * Create a restrictive context (for untrusted environments)
 */
export function createRestrictiveContext(): PermissionContext {
  return {
    mode: 'dontAsk',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: [
      // Only allow safe read operations
      { permission: 'read', pattern: '*.{js,ts,jsx,tsx,md,json,yaml,yml,txt}', action: 'allow' },
      { permission: 'glob', pattern: '*', action: 'allow' },
      { permission: 'grep', pattern: '*', action: 'allow' },
    ],
    alwaysDenyRules: [
      // Deny all write operations
      { permission: 'write', pattern: '*', action: 'deny' },
      { permission: 'edit', pattern: '*', action: 'deny' },
      { permission: 'bash', pattern: '*', action: 'deny' },
    ],
    alwaysAskRules: [
      // Ask for everything else
      { permission: '*', pattern: '*', action: 'ask' },
    ],
    isBypassPermissionsModeAvailable: false,
  }
}

/**
 * Create a plan mode context (for read-only planning)
 */
export function createPlanContext(): PermissionContext {
  return {
    mode: 'plan',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: [
      { permission: 'read', pattern: '*', action: 'allow' },
      { permission: 'glob', pattern: '*', action: 'allow' },
      { permission: 'grep', pattern: '*', action: 'allow' },
      { permission: 'plan', pattern: '*', action: 'allow' },
    ],
    alwaysDenyRules: [
      { permission: 'write', pattern: '*', action: 'deny' },
      { permission: 'edit', pattern: '*', action: 'deny' },
      { permission: 'bash', pattern: '*', action: 'deny' },
    ],
    alwaysAskRules: [],
    isBypassPermissionsModeAvailable: true,
  }
}

// ============================================================================
// Default Rulesets
// ============================================================================

/**
 * Default ruleset for build agent
 */
export const defaultBuildRuleset: Ruleset = [
  { permission: 'read', pattern: '*', action: 'allow' },
  { permission: 'glob', pattern: '*', action: 'allow' },
  { permission: 'grep', pattern: '*', action: 'allow' },
  { permission: 'bash', pattern: '*', action: 'ask' },
  { permission: 'write', pattern: '*', action: 'ask' },
  { permission: 'edit', pattern: '*', action: 'ask' },
]

/**
 * Default ruleset for plan agent (read-only)
 */
export const defaultPlanRuleset: Ruleset = [
  { permission: 'read', pattern: '*', action: 'allow' },
  { permission: 'glob', pattern: '*', action: 'allow' },
  { permission: 'grep', pattern: '*', action: 'allow' },
  { permission: 'plan', pattern: '*', action: 'allow' },
  { permission: 'write', pattern: '*.md', action: 'ask' },
  { permission: '*', pattern: '*', action: 'deny' },
]

/**
 * Default ruleset for explore agent (fast read-only)
 */
export const defaultExploreRuleset: Ruleset = [
  { permission: 'read', pattern: '*', action: 'allow' },
  { permission: 'glob', pattern: '*', action: 'allow' },
  { permission: 'grep', pattern: '*', action: 'allow' },
  { permission: 'bash', pattern: 'git *', action: 'allow' },
  { permission: 'bash', pattern: 'ls *', action: 'allow' },
  { permission: '*', pattern: '*', action: 'deny' },
]

// ============================================================================
// Export
// ============================================================================

export { PermissionContext, Rule, Ruleset } from './types.js'
export { SandboxManager, sandboxManager } from './sandbox.js'
export { validatePathSafety, validateCommandPaths } from './pathValidation.js'
export { evaluate } from './evaluate.js'

// Denial tracking
export {
  recordDenial,
  recordAllow,
  getDenialStatus,
  processPermissionDecision,
  getDenialSuggestions,
  getDenialTrackingState,
  resetDenialTracking,
  setDenialThreshold,
  setDenialWindow,
  serializeDenialState,
  deserializeDenialState,
  type DenialTrackingState,
  type DenialSuggestion,
} from './denialTracking.js'
