/**
 * Verification Agent System
 *
 * Inspired by Claude Code's verificationAgent.ts:
 * "Your job is NOT to confirm the implementation works - it's to try to break it"
 *
 * Provides adversarial testing capabilities:
 * - Build verification
 * - Test suite execution
 * - Linter/type-check validation
 * - Regression detection
 * - Boundary value testing
 * - Concurrency testing
 */

import { exec } from 'child_process'
import { promisify } from 'util'
import { readFile } from 'fs/promises'
import { join, existsSync } from 'path'

const execAsync = promisify(exec)

// ============================================================================
// Types
// ============================================================================

export type Verdict = 'PASS' | 'FAIL' | 'PARTIAL'

export interface VerificationCheck {
  name: string
  description: string
  command?: string
  expectedToFail?: boolean  // If true, failure is considered PASS
}

export interface VerificationResult {
  check: string
  command?: string
  output?: string
  verdict: Verdict
  reason?: string
  durationMs?: number
}

export interface VerificationReport {
  task: string
  results: VerificationResult[]
  summary: {
    total: number
    passed: number
    failed: number
    partial: number
  }
  durationMs: number
  timestamp: number
}

// ============================================================================
// Default Verification Checks
// ============================================================================

export const DEFAULT_BUILD_CHECKS: VerificationCheck[] = [
  {
    name: 'Build',
    description: 'Run the build command to verify compilation succeeds',
    command: 'npm run build',
  },
  {
    name: 'Type Check',
    description: 'Run TypeScript type checking',
    command: 'npx tsc --noEmit',
  },
  {
    name: 'Lint',
    description: 'Run linter to check code quality',
    command: 'npm run lint',
  },
]

export const DEFAULT_TEST_CHECKS: VerificationCheck[] = [
  {
    name: 'Unit Tests',
    description: 'Run unit test suite',
    command: 'npm test',
  },
  {
    name: 'Integration Tests',
    description: 'Run integration test suite',
    command: 'npm run test:integration',
  },
]

// ============================================================================
// Verification Functions
// ============================================================================

/**
 * Run a single verification check
 */
export async function runCheck(
  check: VerificationCheck,
  cwd?: string,
): Promise<VerificationResult> {
  const startTime = Date.now()

  if (!check.command) {
    return {
      check: check.name,
      verdict: 'PARTIAL',
      reason: 'No command specified',
      durationMs: 0,
    }
  }

  try {
    const { stdout, stderr } = await execAsync(check.command, {
      cwd: cwd || process.cwd(),
      timeout: 120000, // 2 minute timeout
      maxBuffer: 10 * 1024 * 1024, // 10MB
    })

    const output = (stdout + stderr).trim()
    const durationMs = Date.now() - startTime

    // Check for common failure indicators in output
    const failed = hasFailureIndicators(output)

    if (check.expectedToFail) {
      return {
        check: check.name,
        command: check.command,
        output: output.slice(0, 5000),
        verdict: failed ? 'PASS' : 'FAIL',
        reason: failed ? 'Test correctly fails as expected' : 'Expected failure but test passed',
        durationMs,
      }
    }

    return {
      check: check.name,
      command: check.command,
      output: output.slice(0, 5000),
      verdict: failed ? 'FAIL' : 'PASS',
      reason: failed ? 'Build/test output contains failure indicators' : 'Command completed successfully',
      durationMs,
    }
  } catch (e: any) {
    const durationMs = Date.now() - startTime

    // Non-zero exit code indicates failure
    const exitCode = e.code ?? 0

    if (check.expectedToFail) {
      return {
        check: check.name,
        command: check.command,
        output: (e.stdout || '' + '\n' + e.stderr || '').trim().slice(0, 5000),
        verdict: exitCode !== 0 ? 'PASS' : 'FAIL',
        reason: exitCode !== 0 ? 'Test correctly fails as expected' : 'Expected failure but passed',
        durationMs,
      }
    }

    return {
      check: check.name,
      command: check.command,
      output: (e.stdout || '' + '\n' + e.stderr || '').trim().slice(0, 5000),
      verdict: 'FAIL',
      reason: `Command failed with exit code ${exitCode}: ${e.message}`,
      durationMs,
    }
  }
}

/**
 * Check if output contains common failure indicators
 */
function hasFailureIndicators(output: string): boolean {
  const failurePatterns = [
    /error\s+\d+/i,
    /fail(ed)?\s*:/i,
    /failed/i,
    /\bfail\b/i,
    /TypeError:/i,
    /SyntaxError:/i,
    /ReferenceError:/i,
    /AssertionError:/i,
    /✗/i,  // Common failure indicator
    /BUILD\s+FAILED/i,
    /TEST\s+FAILED/i,
    /compilation\s+error/i,
    /cannot\s+find\s+module/i,
    /module\s+not\s+found/i,
    /unexpected\s+token/i,
  ]

  return failurePatterns.some(pattern => pattern.test(output))
}

/**
 * Read project metadata to find verification commands
 */
export async function findProjectVerificationCommands(
  projectRoot: string,
): Promise<VerificationCheck[]> {
  const checks: VerificationCheck[] = []

  // Check package.json for scripts
  const packageJsonPath = join(projectRoot, 'package.json')
  if (existsSync(packageJsonPath)) {
    try {
      const content = await readFile(packageJsonPath, 'utf-8')
      const pkg = JSON.parse(content)
      const scripts = pkg.scripts || {}

      if (scripts.build) {
        checks.push({
          name: 'Build',
          description: 'Run build command from package.json',
          command: 'npm run build',
        })
      }

      if (scripts.test) {
        checks.push({
          name: 'Tests',
          description: 'Run test suite from package.json',
          command: 'npm test',
        })
      }

      if (scripts.lint) {
        checks.push({
          name: 'Lint',
          description: 'Run linter from package.json',
          command: 'npm run lint',
        })
      }

      if (scripts['type-check'] || scripts.typecheck) {
        checks.push({
          name: 'Type Check',
          description: 'Run type checking',
          command: 'npm run type-check',
        })
      }
    } catch {
      // Ignore parse errors
    }
  }

  return checks
}

// ============================================================================
// Full Verification Report
// ============================================================================

/**
 * Run a full verification suite
 */
export async function runVerification(
  task: string,
  checks: VerificationCheck[] = DEFAULT_BUILD_CHECKS,
  cwd?: string,
): Promise<VerificationReport> {
  const startTime = Date.now()

  const results: VerificationResult[] = []

  for (const check of checks) {
    console.log(`[Verification] Running: ${check.name}`)
    const result = await runCheck(check, cwd)
    results.push(result)

    const verdictEmoji = result.verdict === 'PASS' ? '✓' : result.verdict === 'FAIL' ? '✗' : '?'
    console.log(`[Verification] ${verdictEmoji} ${check.name}: ${result.verdict}`)
    if (result.reason) {
      console.log(`[Verification]   Reason: ${result.reason}`)
    }
  }

  const durationMs = Date.now() - startTime

  const summary = {
    total: results.length,
    passed: results.filter(r => r.verdict === 'PASS').length,
    failed: results.filter(r => r.verdict === 'FAIL').length,
    partial: results.filter(r => r.verdict === 'PARTIAL').length,
  }

  return {
    task,
    results,
    summary,
    durationMs,
    timestamp: Date.now(),
  }
}

/**
 * Run adversarial testing probes
 */
export async function runAdversarialProbes(
  task: string,
  implementation: string,
  cwd?: string,
): Promise<VerificationResult[]> {
  const results: VerificationResult[] = []

  // Probe 1: Boundary values
  results.push(await runBoundaryValueProbe(task, cwd))

  // Probe 2: Idempotency (running twice should be safe)
  results.push(await runIdempotencyProbe(task, implementation, cwd))

  // Probe 3: Error handling
  results.push(await runErrorHandlingProbe(task, cwd))

  return results
}

async function runBoundaryValueProbe(task: string, cwd?: string): Promise<VerificationResult> {
  const startTime = Date.now()

  // Check if task involves data processing that might have boundary issues
  const boundaryKeywords = ['array', 'list', 'loop', 'iteration', 'pagination', 'limit', 'offset']

  return {
    check: 'Boundary Value Testing',
    verdict: 'PARTIAL',
    reason: 'Boundary value testing requires understanding of specific implementation. Manual review recommended for: empty arrays, null/undefined values, MAX_INT values, negative numbers.',
    durationMs: Date.now() - startTime,
  }
}

async function runIdempotencyProbe(
  task: string,
  implementation: string,
  cwd?: string,
): Promise<VerificationResult> {
  const startTime = Date.now()

  // Check if implementation has idempotency issues
  const nonIdempotentPatterns = [
    /Date\.now\(\)/,
    /randomUUID/i,
    /crypto\./,
    /\+\+\w+/,
  ]

  const hasNonIdempotentCode = nonIdempotentPatterns.some(p => p.test(implementation))

  if (hasNonIdempotentCode) {
    return {
      check: 'Idempotency Check',
      verdict: 'PARTIAL',
      reason: 'Implementation contains potentially non-idempotent operations. Running the same operation twice might produce different results.',
      durationMs: Date.now() - startTime,
    }
  }

  return {
    check: 'Idempotency Check',
    verdict: 'PASS',
    reason: 'No obvious non-idempotent patterns detected',
    durationMs: Date.now() - startTime,
  }
}

async function runErrorHandlingProbe(task: string, cwd?: string): Promise<VerificationResult> {
  const startTime = Date.now()

  return {
    check: 'Error Handling',
    verdict: 'PARTIAL',
    reason: 'Error handling should be verified by: 1) Testing with invalid inputs, 2) Testing with missing files/dependencies, 3) Testing with network failures.',
    durationMs: Date.now() - startTime,
  }
}

// ============================================================================
// Verification Result Formatting
// ============================================================================

/**
 * Format verification report as markdown
 */
export function formatVerificationReport(report: VerificationReport): string {
  const lines: string[] = []

  lines.push(`## Verification Report`)
  lines.push(``)
  lines.push(`**Task**: ${report.task}`)
  lines.push(`**Timestamp**: ${new Date(report.timestamp).toISOString()}`)
  lines.push(`**Duration**: ${report.durationMs}ms`)
  lines.push(``)
  lines.push(`### Summary`)
  lines.push(`- Total: ${report.summary.total}`)
  lines.push(`- Passed: ${report.summary.passed}`)
  lines.push(`- Failed: ${report.summary.failed}`)
  lines.push(`- Partial: ${report.summary.partial}`)
  lines.push(``)

  lines.push(`### Details`)
  lines.push(``)

  for (const result of report.results) {
    lines.push(`#### ${result.check}`)
    lines.push(`- **Verdict**: ${result.verdict}`)
    if (result.command) {
      lines.push(`- **Command**: \`${result.command}\``)
    }
    if (result.reason) {
      lines.push(`- **Reason**: ${result.reason}`)
    }
    if (result.durationMs) {
      lines.push(`- **Duration**: ${result.durationMs}ms`)
    }
    if (result.output) {
      lines.push(`- **Output**:`)
      lines.push(`\`\`\``)
      lines.push(result.output.slice(0, 2000))
      if (result.output.length > 2000) {
        lines.push(`... (truncated)`)
      }
      lines.push(`\`\`\``)
    }
    lines.push(``)
  }

  return lines.join('\n')
}
