/**
 * Permission Pipeline - 来自Claude Code的7步权限检查管道
 *
 * 这是混合权限系统的核心检查逻辑，融合了：
 * - Claude Code的7步检查管道
 * - OpenCode的Effect整合
 * - 路径安全检查
 * - 沙箱决策
 *
 * 参考来源: Anthropic-Leaked-Source-Code/utils/permissions/permissions.ts
 */

import { Effect, Layer } from 'effect'
import type { PermissionMode, PermissionResult, PermissionContext, Rule } from './types.js'
import { evaluate } from './evaluate.js'
import { validatePathSafety, isProtectedPath, isShellConfigPath } from './pathValidation.js'
import { sandboxManager } from './sandbox.js'

// ============================================================================
// Pipeline Types
// ============================================================================

/**
 * Input for the permission pipeline
 */
export interface PipelineInput {
  mode: PermissionMode
  toolName: string
  input: unknown
  context: PermissionContext
  additionalChecks?: {
    checkPathSafety?: boolean
    paths?: string[]
    command?: string
  }
}

/**
 * Pipeline step result
 */
export interface PipelineStepResult {
  behavior: 'allow' | 'deny' | 'ask' | 'passthrough'
  step: number
  reason?: string
  rule?: Rule
  updatedInput?: unknown
}

// ============================================================================
// Default Rules
// ============================================================================

/**
 * Built-in always-deny rules for safety-critical paths
 * 这些规则即使在bypass模式下也会被阻止
 */
const BUILT_IN_DENY_RULES: Rule[] = [
  // Protected paths
  { permission: '*', pattern: '*~/.git/*', action: 'deny' },
  { permission: '*', pattern: '*~/.claude/*', action: 'deny' },
  { permission: '*', pattern: '*~/.ssh/*', action: 'deny' },
  { permission: '*', pattern: '*~/.aws/*', action: 'deny' },

  // Shell config protection
  { permission: 'write', pattern: '*.bashrc', action: 'deny' },
  { permission: 'write', pattern: '*.bash_profile', action: 'deny' },
  { permission: 'write', pattern: '*.zshrc', action: 'deny' },
  { permission: 'edit', pattern: '*.bashrc', action: 'deny' },
  { permission: 'edit', pattern: '*.zshrc', action: 'deny' },

  // Environment files
  { permission: 'write', pattern: '*.env', action: 'ask' },
  { permission: 'edit', pattern: '*.env', action: 'ask' },
]

/**
 * Get bypass-immune rules (always blocked even in bypass mode)
 */
const BYPASS_IMMUNE_PATTERNS = [
  /\.git\//,
  /\.claude\//,
  /\.vscode\//,
  /\.ssh\//,
  /\.aws\//,
  /\.config\/.*/,
]

/**
 * Check if a pattern matches bypass-immune rules
 */
function isBypassImmune(path: string): boolean {
  const normalizedPath = path.replace(/\\/g, '/').toLowerCase()
  return BYPASS_IMMUNE_PATTERNS.some((pattern) => pattern.test(normalizedPath))
}

// ============================================================================
// Pipeline Steps
// ============================================================================

/**
 * Step 1a: Check if entire tool is denied by deny rule
 */
function step1a_checkDenyRule(
  toolName: string,
  _input: unknown,
  context: PermissionContext
): PipelineStepResult | null {
  const denyRule = context.alwaysDenyRules.find(
    (r) => r.permission === toolName && r.pattern === '*'
  )

  if (denyRule) {
    return {
      behavior: 'deny',
      step: 1,
      reason: `Tool ${toolName} is denied by rule`,
      rule: denyRule,
    }
  }

  return null
}

/**
 * Step 1b: Check if entire tool is set to always ask
 */
function step1b_checkAskRule(
  toolName: string,
  input: unknown,
  context: PermissionContext
): PipelineStepResult | null {
  const askRule = context.alwaysAskRules.find(
    (r) => r.permission === toolName && r.pattern === '*'
  )

  if (askRule) {
    // Exception: sandbox auto-allows for certain tools
    if (
      toolName === 'bash' &&
      sandboxManager.isEnabled() &&
      sandboxManager.isAutoAllowBashIfSandboxedEnabled() &&
      context.mode === 'default'
    ) {
      return null // Skip ask, continue
    }

    return {
      behavior: 'ask',
      step: 2,
      reason: `Tool ${toolName} requires permission`,
      rule: askRule,
    }
  }

  return null
}

/**
 * Step 1c-1e: Check for bypass-immune paths
 */
function step1c_checkBypassImmune(
  toolName: string,
  input: unknown,
  context: PermissionContext,
  paths?: string[]
): PipelineStepResult | null {
  if (!paths || paths.length === 0) {
    return null
  }

  for (const path of paths) {
    // Check protected path safety
    const safety = validatePathSafety(path)
    if (!safety.isSafe && safety.pathType === 'blocked') {
      return {
        behavior: 'deny',
        step: 3,
        reason: safety.reason,
      }
    }

    // Check bypass-immune patterns
    if (isBypassImmune(path)) {
      return {
        behavior: 'deny',
        step: 3,
        reason: `Path ${path} is protected even in bypass mode`,
      }
    }
  }

  return null
}

/**
 * Step 2a: Check mode-based bypass
 */
function step2a_checkModeBypass(
  mode: PermissionMode,
  context: PermissionContext,
  toolName: string,
  input: unknown
): PipelineStepResult | null {
  // bypassPermissions mode skips most checks
  if (mode === 'bypassPermissions' && context.isBypassPermissionsModeAvailable) {
    // But still check bypass-immune paths
    if (input && typeof input === 'object' && 'path' in input) {
      const path = String((input as Record<string, unknown>).path)
      if (isBypassImmune(path)) {
        return {
          behavior: 'deny',
          step: 4,
          reason: `Path ${path} is protected even in bypass mode`,
        }
      }
    }
    return null // Allow
  }

  // plan mode with bypass available
  if (mode === 'plan' && context.prePlanMode === 'bypassPermissions') {
    return null
  }

  return null
}

/**
 * Step 2b: Check if tool is in always-allow rules
 */
function step2b_checkAllowRule(
  toolName: string,
  input: unknown,
  context: PermissionContext
): PipelineStepResult | null {
  const allowRule = context.alwaysAllowRules.find(
    (r) => r.permission === toolName && r.pattern === '*'
  )

  if (allowRule) {
    return {
      behavior: 'allow',
      step: 5,
      reason: `Tool ${toolName} is allowed by rule`,
      rule: allowRule,
    }
  }

  return null
}

/**
 * Step 3: Evaluate pattern-specific rules
 */
function step3_evaluatePatternRules(
  toolName: string,
  input: unknown,
  context: PermissionContext,
  paths?: string[]
): PipelineStepResult | null {
  // If we have paths, check rules for each
  if (paths && paths.length > 0) {
    for (const path of paths) {
      const rule = evaluate(toolName, path, context.alwaysAllowRules, context.alwaysDenyRules)

      if (rule.action === 'deny') {
        return {
          behavior: 'deny',
          step: 6,
          reason: `Pattern ${path} matches deny rule`,
          rule,
        }
      }

      if (rule.action === 'ask') {
        return {
          behavior: 'ask',
          step: 6,
          reason: `Pattern ${path} requires permission`,
          rule,
        }
      }
      // allow: continue checking
    }
  }

  return null
}

// ============================================================================
// Main Pipeline
// ============================================================================

/**
 * Run the permission pipeline
 * 来自: Anthropic-Leaked-Source-Code/utils/permissions/permissions.ts
 */
export function runPermissionPipeline(input: PipelineInput): PipelineStepResult {
  const { mode, toolName, input: toolInput, context, additionalChecks } = input
  const paths = additionalChecks?.paths

  // Step 1a: Check deny rules
  const step1a = step1a_checkDenyRule(toolName, toolInput, context)
  if (step1a) return step1a

  // Step 1b: Check ask rules
  const step1b = step1b_checkAskRule(toolName, toolInput, context)
  if (step1b) return step1b

  // Step 1c: Check bypass-immune paths (safety check)
  const step1c = step1c_checkBypassImmune(toolName, toolInput, context, paths)
  if (step1c) return step1c

  // Step 2a: Check mode-based bypass
  const step2a = step2a_checkModeBypass(mode, context, toolName, toolInput)
  if (step2a) return step2a

  // Step 2b: Check allow rules
  const step2b = step2b_checkAllowRule(toolName, toolInput, context)
  if (step2b) return step2b

  // Step 3: Evaluate pattern-specific rules
  const step3 = step3_evaluatePatternRules(toolName, toolInput, context, paths)
  if (step3) return step3

  // Default: ask for permission
  return {
    behavior: 'ask',
    step: 7,
    reason: 'Default: permission required',
  }
}

/**
 * Convert pipeline result to PermissionResult
 */
export function pipelineToResult(stepResult: PipelineStepResult): PermissionResult {
  return {
    behavior: stepResult.behavior,
    reason: stepResult.reason,
    updatedInput: stepResult.updatedInput,
    rule: stepResult.rule ? stepResult.rule as any : undefined,
  }
}

// ============================================================================
// Effect-based Pipeline
// ============================================================================

/**
 * Run permission check as Effect
 */
export const checkPermission = (input: PipelineInput) =>
  Effect.sync(() => {
    const result = runPermissionPipeline(input)
    return pipelineToResult(result)
  })

/**
 * Check if a path is safe (bypass-immune check)
 */
export const checkPathSafety = (path: string) =>
  Effect.sync(() => {
    const safety = validatePathSafety(path)
    return {
      isSafe: safety.isSafe,
      reason: safety.reason,
      pathType: safety.pathType,
    }
  })

/**
 * Check if command should use sandbox
 */
export const checkShouldSandbox = (command: string) =>
  Effect.sync(() => sandboxManager.shouldSandbox(command))
