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
  // /dev/null is intentionally allowed - it's standard for output redirection
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

// ============================================================================
// Zsh Dangerous Commands (from Claude Code bashSecurity.ts)
// ============================================================================

const ZSH_DANGEROUS_PATTERNS = [
  { pattern: /zmodload\s+zsh\/mapfile/, reason: 'zsh mapfile module enables array-based file I/O' },
  { pattern: /zmodload\s+zsh\/system/, reason: 'zsh system module enables sysopen/sysread/syswrite' },
  { pattern: /sysopen\b/, reason: 'zsh sysopen command - direct file descriptor manipulation' },
  { pattern: /sysread\b/, reason: 'zsh sysread command - direct file descriptor reading' },
  { pattern: /syswrite\b/, reason: 'zsh syswrite command - direct file descriptor writing' },
  { pattern: /zpty\b/, reason: 'zsh zpty command - PTY manipulation for command injection' },
  { pattern: /ztcp\b/, reason: 'zsh ztcp command - network socket manipulation' },
  { pattern: /mapfile\s+--/, reason: 'mapfile with flags can access arbitrary files' },
  { pattern: /zf_open|zf_ls|zf_get|zf_put/, reason: 'zf_* commands - zsh FTP commands' },
  { pattern: /emulate\s+-L\s+zsh/, reason: 'zsh emulate mode can reset security options' },
]

// ============================================================================
// Brace Expansion Detection (from Claude Code bashSecurity.ts)
// ============================================================================

const BRACE_EXPANSION_PATTERN = /\{[^}]*\{[^}]*\}[^}]*\}/

// ============================================================================
// Obfuscated Flags Detection (from Claude Code bashSecurity.ts)
// ============================================================================

const OBFUSCATED_PATTERNS = [
  // ANSI-C quoting: $'...'
  { pattern: /\$\x27/, reason: 'ANSI-C quoting can hide characters' },
  // Locale quoting: $"..."
  { pattern: /\$\"/, reason: 'Locale quoting can hide characters' },
  // Empty quote pairs adjacent: ""-f, ""-rf, etc.
  { pattern: /""[-bcdfhnpstuvx]/, reason: 'Empty quote pairs can bypass flag detection' },
  // Homogeneous empty quotes: """-f
  { pattern: /"""-/, reason: 'Triple empty quotes can hide flags' },
  // Quote chaining: "-""exec
  { pattern: /"-""[a-z]+/, reason: 'Quote chaining can hide command names' },
  // Three+ consecutive quotes at word start
  { pattern: /^\s*['"]{3,}/, reason: 'Multiple consecutive quotes may hide command' },
]

// ============================================================================
// Backslash Escaped Operators (parser differential attacks)
// ============================================================================

const BACKSLASH_ESCAPED_OPS = [
  { pattern: /\\;/, reason: 'Escaped semicolon (\\;) parsed differently by shell vs normalized' },
  { pattern: /\\\|/, reason: 'Escaped pipe (\\|) can bypass permission checks' },
  { pattern: /\\&/, reason: 'Escaped ampersand (\\&) can bypass permission checks' },
  { pattern: /\\</, reason: 'Escaped less-than (\\<) can bypass input redirection checks' },
  { pattern: /\\>/, reason: 'Escaped greater-than (\\>) can bypass output redirection checks' },
]

// ============================================================================
// IFS Injection Detection
// ============================================================================

const IFS_INJECTION_PATTERNS = [
  { pattern: /IFS=/, reason: 'IFS variable manipulation can split tokens unexpectedly' },
  { pattern: /IFS=:/, reason: 'IFS with colon can manipulate environment variable parsing' },
  { pattern: /\$IFS/, reason: 'Direct $IFS variable reference for injection' },
]

// ============================================================================
// Additional Dangerous Patterns
// ============================================================================

const ADDITIONAL_DANGEROUS_PATTERNS = [
  // Process substitution: <(), >(), =()
  { pattern: /<>\s*\(/, reason: 'Process substitution (<()) can hide command execution' },
  { pattern: />>\s*\(/, reason: 'Process substitution (>() ) can hide output redirection' },
  { pattern: /=\s*\(/, reason: 'Process substitution (=( )) for command substitution' },
  // Here-doc with substitution: <<EOF ... EOF (with $var)
  { pattern: /<<-?\s*['"]?\w+['"]?.*\$\{/, reason: 'Here-document with variable expansion' },
  // Command substitution in redirection
  { pattern: />\s*\$\(/, reason: 'Command substitution in output redirection' },
  { pattern: /<\s*\$\(/, reason: 'Command substitution in input redirection' },
]

export function checkPathSafety(filePath: string): PathCheckResult {
  // UNC path blocking (Windows network paths - prevent NTLM leaks)
  // Only block actual UNC paths like //server/share, not //c/ drive letters (Git Bash style)
  if (filePath.startsWith('\\\\') || (filePath.startsWith('//') && !filePath.match(/^\/\/[a-zA-Z]\//))) {
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

  // 1. Check basic dangerous command patterns
  for (const { pattern, reason } of DANGEROUS_COMMAND_PATTERNS) {
    if (pattern.test(command)) reasons.push(reason)
  }

  // 2. Check Zsh dangerous commands
  for (const { pattern, reason } of ZSH_DANGEROUS_PATTERNS) {
    if (pattern.test(command)) reasons.push(reason)
  }

  // 3. Check brace expansion (DISABLED - too aggressive, causes false positives with PowerShell)
  // PowerShell uses {} for hashtables and script blocks, not bash-style brace expansion
  // if (BRACE_EXPANSION_PATTERN.test(command)) {
  //   reasons.push('Brace expansion can bypass argument parsing')
  // }

  // 4. Check obfuscated flags
  for (const { pattern, reason } of OBFUSCATED_PATTERNS) {
    if (pattern.test(command)) reasons.push(reason)
  }

  // 5. Check backslash escaped operators
  for (const { pattern, reason } of BACKSLASH_ESCAPED_OPS) {
    if (pattern.test(command)) reasons.push(reason)
  }

  // 6. Check IFS injection
  for (const { pattern, reason } of IFS_INJECTION_PATTERNS) {
    if (pattern.test(command)) reasons.push(reason)
  }

  // 7. Check additional dangerous patterns
  for (const { pattern, reason } of ADDITIONAL_DANGEROUS_PATTERNS) {
    if (pattern.test(command)) reasons.push(reason)
  }

  // 8. Check paths extracted from command
  for (const filePath of extractPathsFromCommand(command)) {
    const check = checkPathSafety(filePath)
    if (!check.isSafe && check.reason) {
      reasons.push(`Path issue in command: ${check.reason} (${filePath})`)
    }
  }

  return { isSafe: reasons.length === 0, reasons }
}

// Export validators for external use
export const validators = {
  checkZshDangerous: (cmd: string) => ZSH_DANGEROUS_PATTERNS.some(({ pattern }) => pattern.test(cmd)),
  checkBraceExpansion: (cmd: string) => BRACE_EXPANSION_PATTERN.test(cmd),
  checkObfuscatedFlags: (cmd: string) => OBFUSCATED_PATTERNS.some(({ pattern }) => pattern.test(cmd)),
  checkBackslashEscaped: (cmd: string) => BACKSLASH_ESCAPED_OPS.some(({ pattern }) => pattern.test(cmd)),
  checkIFSInjection: (cmd: string) => IFS_INJECTION_PATTERNS.some(({ pattern }) => pattern.test(cmd)),
}
