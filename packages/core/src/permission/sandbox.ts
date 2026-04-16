/**
 * Sandbox Integration - 来自Claude Code的沙箱执行决策
 *
 * 沙箱配置和决策逻辑：
 * - 检测是否应该使用沙箱
 * - 文件系统权限控制
 * - 网络权限控制
 * - 命令排除列表
 *
 * 参考来源: Anthropic-Leaked-Source-Code/utils/permissions/permissions.ts
 *          Anthropic-Leaked-Source-Code/utils/sandbox/sandbox-adapter.ts
 */

import type { Rule, Ruleset } from './types.js'

// ============================================================================
// Sandbox Configuration
// ============================================================================

/**
 * Sandbox network configuration
 */
export interface SandboxNetworkConfig {
  allowedDomains?: string[]
  allowUnixSockets?: boolean
  httpProxyPort?: number
}

/**
 * Sandbox filesystem configuration
 */
export interface SandboxFilesystemConfig {
  allowOnly?: string[]      // 只允许访问这些路径
  allowWrite?: string[]     // 允许写入的路径
  denyWrite?: string[]      // 拒绝写入的路径
  denyRead?: string[]       // 拒绝读取的路径
  allowRead?: string[]      // 允许读取的路径
}

/**
 * Sandbox settings
 * 来自: Anthropic-Leaked-Source-Code/entrypoints/sandboxTypes.ts
 */
export interface SandboxSettings {
  enabled?: boolean
  failIfUnavailable?: boolean
  autoAllowBashIfSandboxed?: boolean
  allowUnsandboxedCommands?: boolean
  network?: SandboxNetworkConfig
  filesystem?: SandboxFilesystemConfig
  ignoreViolations?: Record<string, string[]>
  excludedCommands?: string[]
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_SANDBOX_SETTINGS: SandboxSettings = {
  enabled: false, // 默认关闭，需要明确启用
  failIfUnavailable: false,
  autoAllowBashIfSandboxed: false,
  allowUnsandboxedCommands: true,
  excludedCommands: [
    'sudo',
    'su',
    'ssh',
    'scp',
    'sftp',
    'rsync',
    'curl',
    'wget',
    'nc',
    'netcat',
    'ncat',
    'openssl',
  ],
}

// ============================================================================
// Sandbox Manager
// ============================================================================

/**
 * Sandbox manager for determining sandbox usage and configuration
 */
export class SandboxManager {
  private settings: SandboxSettings
  private static instance: SandboxManager | null = null

  private constructor(settings: SandboxSettings = {}) {
    this.settings = { ...DEFAULT_SANDBOX_SETTINGS, ...settings }
  }

  /**
   * Get singleton instance
   */
  static getInstance(settings?: SandboxSettings): SandboxManager {
    if (!SandboxManager.instance) {
      SandboxManager.instance = new SandboxManager(settings)
    }
    return SandboxManager.instance
  }

  /**
   * Reset instance (for testing)
   */
  static reset(): void {
    SandboxManager.instance = null
  }

  /**
   * Check if sandboxing is enabled
   */
  isEnabled(): boolean {
    return this.settings.enabled ?? false
  }

  /**
   * Check if a command should be sandboxed
   * 来自: Anthropic-Leaked-Source-Code/tools/BashTool/shouldUseSandbox.ts
   */
  shouldSandbox(command: string): boolean {
    if (!this.isEnabled()) {
      return false
    }

    // Check if command is excluded
    if (this.isExcludedCommand(command)) {
      return false
    }

    return true
  }

  /**
   * Check if a command is in the exclusion list
   */
  isExcludedCommand(command: string): boolean {
    const excluded = this.settings.excludedCommands ?? []
    const normalizedCommand = command.toLowerCase().trim()

    for (const exe of excluded) {
      // Check if command starts with the excluded executable
      if (normalizedCommand.startsWith(exe.toLowerCase())) {
        return true
      }
      // Also check for exact match with common variations
      const variations = [
        `/${exe}`,
        `/${exe}.exe`,
        `${exe}.exe`,
      ]
      for (const v of variations) {
        if (normalizedCommand.includes(v)) {
          return true
        }
      }
    }

    return false
  }

  /**
   * Check if unsandboxed commands are allowed
   */
  areUnsandboxedCommandsAllowed(): boolean {
    return this.settings.allowUnsandboxedCommands ?? true
  }

  /**
   * Check if auto-allow bash when sandboxed
   */
  isAutoAllowBashIfSandboxedEnabled(): boolean {
    return this.settings.autoAllowBashIfSandboxed ?? false
  }

  /**
   * Get filesystem write configuration
   */
  getFsWriteConfig(): {
    allowOnly: string[]
    denyWithinAllow: string[]
  } {
    const fs = this.settings.filesystem ?? {}
    return {
      allowOnly: fs.allowOnly ?? [],
      denyWithinAllow: fs.denyWrite ?? [],
    }
  }

  /**
   * Get filesystem read configuration
   */
  getFsReadConfig(): {
    allowOnly: string[]
    denyWithinAllow: string[]
  } {
    const fs = this.settings.filesystem ?? {}
    return {
      allowOnly: fs.allowOnly ?? [],
      denyWithinAllow: fs.denyRead ?? [],
    }
  }

  /**
   * Check if path is in sandbox write allowlist
   */
  isPathInWriteAllowlist(resolvedPath: string): boolean {
    const { allowOnly, denyWithinAllow } = this.getFsWriteConfig()

    if (allowOnly.length === 0) {
      return true // No restriction
    }

    const normalizedPath = resolvedPath.toLowerCase().replace(/\\/g, '/')

    // Check if in allowed paths
    for (const allowed of allowOnly) {
      if (normalizedPath.startsWith(allowed.toLowerCase())) {
        // Check if in deny list within allowed
        for (const denied of denyWithinAllow) {
          if (normalizedPath.includes(denied.toLowerCase())) {
            return false
          }
        }
        return true
      }
    }

    return false
  }

  /**
   * Check if path is in sandbox read allowlist
   */
  isPathInReadAllowlist(resolvedPath: string): boolean {
    const { allowOnly, denyWithinAllow } = this.getFsReadConfig()

    if (allowOnly.length === 0) {
      return true // No restriction
    }

    const normalizedPath = resolvedPath.toLowerCase().replace(/\\/g, '/')

    for (const allowed of allowOnly) {
      if (normalizedPath.startsWith(allowed.toLowerCase())) {
        for (const denied of denyWithinAllow) {
          if (normalizedPath.includes(denied.toLowerCase())) {
            return false
          }
        }
        return true
      }
    }

    return false
  }

  /**
   * Update settings dynamically
   */
  updateSettings(settings: Partial<SandboxSettings>): void {
    this.settings = { ...this.settings, ...settings }
  }

  /**
   * Get current settings
   */
  getSettings(): SandboxSettings {
    return { ...this.settings }
  }
}

// ============================================================================
// Sandbox Context for Tool Execution
// ============================================================================

/**
 * Sandbox context passed to tools during execution
 */
export interface SandboxContext {
  manager: SandboxManager
  isSandboxed: boolean
}

/**
 * Create a sandbox context
 */
export function createSandboxContext(
  settings?: SandboxSettings
): SandboxContext {
  const manager = SandboxManager.getInstance(settings)
  return {
    manager,
    isSandboxed: manager.isEnabled(),
  }
}

// ============================================================================
// Default Export
// ============================================================================

export const sandboxManager = SandboxManager.getInstance()
