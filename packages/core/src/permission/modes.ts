/**
 * Permission Modes - 用户可配置的权限模式
 *
 * 4种模式:
 * - permissive: 允许所有操作（危险，仅受控环境使用）
 * - default: 安全操作直接允许，危险操作询问
 * - askAll: 所有操作都询问用户
 * - plan: 规划模式，只读但可以制定计划
 */

import type { PermissionMode, PermissionContext } from './types.js'

// ============================================================================
// Permission Mode Definitions
// ============================================================================

export interface ModeConfig {
  name: PermissionMode
  description: string
  allowUnknown: boolean
  askForUnknown: boolean
}

export const MODE_CONFIGS: Record<PermissionMode, ModeConfig> = {
  permissive: {
    name: 'permissive',
    description: '允许所有操作（危险 - 请仅在受控环境中使用）',
    allowUnknown: true,
    askForUnknown: false,
  },
  default: {
    name: 'default',
    description: '安全操作直接允许，危险操作询问',
    allowUnknown: false,
    askForUnknown: true,
  },
  askAll: {
    name: 'askAll',
    description: '所有操作都询问用户',
    allowUnknown: false,
    askForUnknown: true,
  },
  plan: {
    name: 'plan',
    description: '规划模式，可以制定计划但不能修改文件',
    allowUnknown: false,
    askForUnknown: false,
  },
}

// ============================================================================
// Safe Operation Allowlists
// ============================================================================

export const SAFE_TOOLS = new Set([
  'read',
  'glob',
  'grep',
  'webfetch',
  'websearch',
  'task',
  'task_result',
  'task_list',
  'plan_exit',
])

export const DANGEROUS_TOOLS = new Set([
  'bash',
  'write',
  'edit',
  'notebook',
])

export function isSafeTool(toolName: string): boolean {
  return SAFE_TOOLS.has(toolName)
}

export function isDangerousTool(toolName: string): boolean {
  return DANGEROUS_TOOLS.has(toolName)
}

// ============================================================================
// Permission Mode Handler
// ============================================================================

export interface PermissionCheckResult {
  behavior: 'allow' | 'deny' | 'ask'
  reason: string
  isNewRule: boolean
}

export function checkByMode(
  mode: PermissionMode,
  toolName: string,
  _input: unknown,
  _context: PermissionContext,
): PermissionCheckResult {
  const config = MODE_CONFIGS[mode]

  // 1. permissive - 允许所有操作
  if (mode === 'permissive') {
    return { behavior: 'allow', reason: 'permissive mode - all allowed', isNewRule: false }
  }

  // 2. plan - 只读，但允许安全工具
  if (mode === 'plan') {
    if (isSafeTool(toolName)) {
      return { behavior: 'allow', reason: 'safe tool in plan mode', isNewRule: false }
    }
    return { behavior: 'deny', reason: 'plan mode - editing not allowed', isNewRule: false }
  }

  // 3. default - 安全工具直接允许，危险工具询问
  if (mode === 'default') {
    if (isSafeTool(toolName)) {
      return { behavior: 'allow', reason: 'safe tool', isNewRule: false }
    }
    if (isDangerousTool(toolName)) {
      return { behavior: 'ask', reason: `${toolName} requires confirmation`, isNewRule: true }
    }
    if (config.askForUnknown) {
      return { behavior: 'ask', reason: `unknown tool ${toolName} requires confirmation`, isNewRule: true }
    }
    return { behavior: 'deny', reason: `unknown tool ${toolName} not allowed`, isNewRule: false }
  }

  // 4. askAll - 所有操作都询问
  if (mode === 'askAll') {
    return { behavior: 'ask', reason: `${toolName} requires confirmation`, isNewRule: true }
  }

  return { behavior: 'ask', reason: 'default permission check', isNewRule: true }
}

export function getPermissionDeniedMessage(toolName: string, reason: string): string {
  if (reason.includes('plan mode')) {
    return `${toolName} is not allowed in plan mode. Plan mode is read-only.`
  }
  if (reason.includes('blocked')) {
    return `Command blocked: ${reason.replace('blocked: ', '')}`
  }
  return `Permission denied: ${reason}`
}

export function getPermissionAskMessage(toolName: string, reason: string): string {
  return `[Permission needed] ${toolName}: ${reason}`
}
