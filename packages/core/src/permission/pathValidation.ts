/**
 * Path Validation - 来自Claude Code的路径安全检查
 *
 * 提供纵深防御安全检查：
 * - UNC路径阻止（防止NTLM凭证泄露）
 * - 设备路径阻止（/dev/*, /proc/*等）
 * - 敏感路径保护（.git/, .claude/, shell配置）
 * - 路径遍历检测
 * - 危险删除检测
 *
 * 参考来源: Anthropic-Leaked-Source-Code/utils/permissions/pathValidation.ts
 */

// ============================================================================
// Constants
// ============================================================================

/**
 * Blocked device paths that could cause security issues
 * 来自: Anthropic-Leaked-Source-Code/tools/FileReadTool/FileReadTool.ts
 */
export const BLOCKED_DEVICE_PATHS = new Set([
  '/dev/zero',
  '/dev/random',
  '/dev/urandom',
  '/dev/stdin',
  '/dev/tty',
  '/dev/stdout',
  '/dev/stderr',
  '/dev/fd/0',
  '/dev/fd/1',
  '/dev/fd/2',
])

/**
 * Sensitive paths that should be protected even in bypass mode
 * 来自: Anthropic-Leaked-Source-Code/utils/permissions/permissions.ts
 */
export const PROTECTED_PATTERNS = [
  /\.git\//,
  /\.claude\//,
  /\.vscode\//,
  /\/home\/.*\/\.ssh\//,
  /\/home\/.*\/\.aws\//,
  /\/home\/.*\/\.config\/.*/,
  /.*\.pem$/,
  /.*\.key$/,
  /.*\.crt$/,
  /.*\.p12$/,
  /.*\.pfx$/,
  /.*\.env$/,
  /.*\.password$/,
  /.*\.secret$/,
]

/**
 * Shell configuration files that should be protected
 */
export const SHELL_CONFIG_PATTERNS = [
  /\.bashrc$/,
  /\.bash_profile$/,
  /\.zshrc$/,
  /\.zprofile$/,
  /\.fishrc$/,
  /\.profile$/,
  /\.zsh\/.*/,
]

/**
 * Patterns that indicate dangerous operations
 */
export const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+\//,           // Dangerous root delete
  /rm\s+-rf\s+\*\s*/,        // Dangerous current dir delete
  /dd\s+if=.*of=\/dev\//,    // Disk dump to device
  /mkfs\./,                   // Format filesystem
  /dd\s+if=.*of=\/dev\/sd/,  // Direct disk write
]

// ============================================================================
// Path Validation Functions
// ============================================================================

/**
 * Check if a path is a UNC path (Windows network share)
 * 来自: Anthropic-Leaked-Source-Code/tools/FileReadTool/FileReadTool.ts
 */
export function isUncPath(path: string): boolean {
  return path.startsWith('\\\\') || path.startsWith('//')
}

/**
 * Check if a path is a blocked device path
 * 来自: Anthropic-Leaked-Source-Code/tools/FileReadTool/FileReadTool.ts
 */
export function isBlockedDevicePath(path: string): boolean {
  const normalizedPath = normalizePath(path)
  return BLOCKED_DEVICE_PATHS.has(normalizedPath)
}

/**
 * Check if a path matches protected patterns
 * 来自: Anthropic-Leaked-Source-Code/utils/permissions/permissions.ts
 */
export function isProtectedPath(path: string): boolean {
  const normalizedPath = normalizePath(path)
  return PROTECTED_PATTERNS.some((pattern) => pattern.test(normalizedPath))
}

/**
 * Check if a path is a shell config file
 */
export function isShellConfigPath(path: string): boolean {
  const normalizedPath = normalizePath(path)
  return SHELL_CONFIG_PATTERNS.some((pattern) => pattern.test(normalizedPath))
}

/**
 * Check if a command contains dangerous patterns
 */
export function containsDangerousCommand(command: string): boolean {
  return DANGEROUS_PATTERNS.some((pattern) => pattern.test(command))
}

/**
 * Check for path traversal sequences
 * 来自: Anthropic-Leaked-Source-Code/utils/permissions/pathValidation.ts
 */
export function containsPathTraversal(path: string): boolean {
  const normalized = normalizePath(path)
  // Check for ../ or /.. sequences
  return (
    normalized.includes('../') ||
    normalized.includes('..\\') ||
    normalized.startsWith('..')
  )
}

/**
 * Normalize a path for comparison
 */
export function normalizePath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
    .toLowerCase()
}

/**
 * Check if a path is safe for file operations
 * 综合检查：UNC、设备、保护路径
 */
export function validatePathSafety(path: string): {
  isSafe: boolean
  reason?: string
  pathType: 'normal' | 'dangerous' | 'blocked'
} {
  // Check UNC path
  if (isUncPath(path)) {
    return {
      isSafe: false,
      reason: 'UNC paths are blocked to prevent NTLM credential leakage',
      pathType: 'blocked',
    }
  }

  // Check device path
  if (isBlockedDevicePath(path)) {
    return {
      isSafe: false,
      reason: 'Device paths are blocked for security',
      pathType: 'blocked',
    }
  }

  // Check path traversal
  if (containsPathTraversal(path)) {
    return {
      isSafe: false,
      reason: 'Path traversal sequences are not allowed',
      pathType: 'dangerous',
    }
  }

  // Check protected paths
  if (isProtectedPath(path)) {
    return {
      isSafe: false,
      reason: 'Protected paths (.git, .claude, .ssh, etc.) are not allowed',
      pathType: 'dangerous',
    }
  }

  // Check shell configs
  if (isShellConfigPath(path)) {
    return {
      isSafe: false,
      reason: 'Shell configuration files are protected',
      pathType: 'dangerous',
    }
  }

  return { isSafe: true, pathType: 'normal' }
}

/**
 * Extract paths from a bash command using simple parsing
 * This is a simplified version - the full implementation uses tree-sitter
 */
export function extractPathsFromCommand(command: string): string[] {
  const paths: string[] = []

  // Match common path patterns
  // eslint-disable-next-line no-useless-escape
  const pathRegex = /['"]?([\.\/\~a-zA-Z0-9_\-@\.\/\\][^\s'"]*)['"]?/g

  let match
  while ((match = pathRegex.exec(command)) !== null) {
    const candidate = match[1]
    // Filter out obvious non-paths
    if (
      !candidate.startsWith('-') &&
      (candidate.startsWith('/') ||
        candidate.startsWith('./') ||
        candidate.startsWith('../') ||
        candidate.startsWith('~') ||
        /^[a-zA-Z]:/.test(candidate))
    ) {
      paths.push(candidate)
    }
  }

  return paths
}

/**
 * Validate multiple paths from a command
 */
export function validateCommandPaths(
  command: string
): { isSafe: boolean; unsafePaths: string[]; reasons: string[] } {
  const paths = extractPathsFromCommand(command)
  const unsafePaths: string[] = []
  const reasons: string[] = []

  for (const path of paths) {
    const result = validatePathSafety(path)
    if (!result.isSafe) {
      unsafePaths.push(path)
      reasons.push(`${path}: ${result.reason}`)
    }
  }

  // Also check for dangerous commands
  if (containsDangerousCommand(command)) {
    return {
      isSafe: false,
      unsafePaths: ['[command is dangerous]'],
      reasons: ['Command matches dangerous pattern (e.g., rm -rf /)'],
    }
  }

  return {
    isSafe: unsafePaths.length === 0,
    unsafePaths,
    reasons,
  }
}
