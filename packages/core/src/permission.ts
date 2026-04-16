/**
 * Permission and safety checks
 * Adapted from Claude Code's pathValidation.ts and safety patterns.
 *
 * Provides:
 * - UNC path blocking (prevents NTLM credential leaks)
 * - Device path blocking (/dev/*)
 * - Protected path detection (.git/, .ssh/, .aws/)
 * - Path traversal detection
 * - Dangerous command detection
 */

export interface PathCheckResult {
  isSafe: boolean
  reason?: string
  pathType: 'normal' | 'blocked' | 'dangerous'
}

export interface CommandCheckResult {
  isSafe: boolean
  reasons: string[]
}

const BLOCKED_DEVICE_PATHS = [
  '/dev/zero', '/dev/random', '/dev/urandom',
  '/dev/stdin', '/dev/tty', '/dev/stdout', '/dev/stderr',
  '/dev/null',
]

const PROTECTED_PATH_PATTERNS = [
  /\.git\//,
  /\.claude\//,
  /\.ssh\//,
  /\.aws\//,
  /\.gnupg\//,
]

const DANGEROUS_COMMAND_PATTERNS = [
  { pattern: /rm\s+-rf\s+\//, reason: 'Root delete command (rm -rf /)' },
  { pattern: /rm\s+-rf\s+~/, reason: 'Home directory delete command' },
  { pattern: /dd\s+if=.*of=\/dev\//, reason: 'Disk dump to device' },
  { pattern: /mkfs\./, reason: 'Filesystem format command' },
  { pattern: /:\(\)\{.*\}.*:;/, reason: 'Fork bomb pattern detected' },
  { pattern: /wget.*\|.*sh/, reason: 'Download and execute pattern' },
  { pattern: /curl.*\|.*sh/, reason: 'Download and execute pattern' },
]

export function checkPathSafety(filePath: string): PathCheckResult {
  // UNC path blocking (Windows network paths - prevent NTLM leaks)
  if (filePath.startsWith('\\\\') || filePath.startsWith('//')) {
    return { isSafe: false, reason: 'UNC paths are blocked', pathType: 'blocked' }
  }

  // Device path blocking
  if (BLOCKED_DEVICE_PATHS.includes(filePath)) {
    return { isSafe: false, reason: 'Device paths are blocked', pathType: 'blocked' }
  }

  // Path traversal detection
  const normalized = filePath.replace(/\\/g, '/')
  if (normalized.includes('../') || normalized.includes('..\\')) {
    return { isSafe: false, reason: 'Path traversal is not allowed', pathType: 'dangerous' }
  }

  // Protected path detection
  for (const pattern of PROTECTED_PATH_PATTERNS) {
    if (pattern.test(filePath)) {
      return { isSafe: false, reason: `Protected path: ${filePath}`, pathType: 'dangerous' }
    }
  }

  return { isSafe: true, pathType: 'normal' }
}

// Extract file paths from a shell command string
function extractPathsFromCommand(command: string): string[] {
  const paths: string[] = []
  // Match quoted paths and unquoted path-like tokens
  const pathRegex = /['"]([^'"]+)['"]|([./~\\][^\s;|&><]+)/g
  let match
  while ((match = pathRegex.exec(command)) !== null) {
    const p = match[1] ?? match[2]
    if (p && !p.startsWith('-')) paths.push(p)
  }
  return paths
}

export function checkCommandSafety(command: string): CommandCheckResult {
  const reasons: string[] = []

  for (const { pattern, reason } of DANGEROUS_COMMAND_PATTERNS) {
    if (pattern.test(command)) reasons.push(reason)
  }

  // Check paths extracted from command
  for (const filePath of extractPathsFromCommand(command)) {
    const check = checkPathSafety(filePath)
    if (!check.isSafe && check.reason) {
      reasons.push(`Path issue in command: ${check.reason} (${filePath})`)
    }
  }

  return { isSafe: reasons.length === 0, reasons }
}
