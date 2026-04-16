/**
 * Tool definitions and execution
 * Provides the set of tools available to the Agent.
 *
 * Tool concurrency model (borrowed from Claude Code StreamingToolExecutor):
 * - concurrencySafe tools: read, glob, grep — can run in parallel
 * - non-safe tools: bash, edit, write — run sequentially to avoid conflicts
 */

import { exec } from 'child_process'
import { promises as fs } from 'fs'
import { promisify } from 'util'
import { glob } from 'glob'
import { checkCommandSafety, checkPathSafety } from '../permission.js'

const execAsync = promisify(exec)

// Max characters to retain from tool output (prevents context overflow from large files)
const MAX_TOOL_OUTPUT = 8_000

export interface ToolResult {
  output: string
  success: boolean
  truncated?: boolean
}

function truncateOutput(output: string): string {
  if (output.length <= MAX_TOOL_OUTPUT) return output
  return output.slice(0, MAX_TOOL_OUTPUT) +
    `\n... [truncated ${output.length - MAX_TOOL_OUTPUT} chars]`
}

// Tools that are safe to run concurrently (read-only operations)
export const CONCURRENT_SAFE_TOOLS = new Set(['read', 'glob', 'grep'])

// Anthropic tool_use schema definitions
export const TOOL_DEFINITIONS = [
  {
    name: 'bash',
    description: 'Execute shell commands. Use for running scripts, installing packages, starting servers, and other system operations.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute' },
        cwd: { type: 'string', description: 'Working directory for the command' },
        timeout: { type: 'number', description: 'Timeout in milliseconds (default: 30000)' },
      },
      required: ['command'],
    },
  },
  {
    name: 'read',
    description: 'Read the contents of a file. Returns the file content as text.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or relative path to the file' },
        offset: { type: 'number', description: 'Line number to start reading from (0-indexed)' },
        limit: { type: 'number', description: 'Maximum number of lines to read' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write',
    description: 'Write content to a file. Creates the file if it does not exist, overwrites if it does.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path of the file to write' },
        content: { type: 'string', description: 'Content to write to the file' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit',
    description: 'Edit a file by replacing a specific string with a new string. The old_string must match exactly.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path of the file to edit' },
        old_string: { type: 'string', description: 'The exact string to find and replace' },
        new_string: { type: 'string', description: 'The replacement string' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'glob',
    description: 'Find files matching a glob pattern. Returns a list of matching file paths.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern (e.g. "**/*.ts", "src/**/*.json")' },
        cwd: { type: 'string', description: 'Directory to search in (default: current directory)' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'grep',
    description: 'Search for a pattern in files. Returns matching lines with file paths and line numbers.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regular expression or string to search for' },
        path: { type: 'string', description: 'File or directory to search in' },
        include: { type: 'string', description: 'File pattern to include (e.g. "*.ts")' },
      },
      required: ['pattern'],
    },
  },
]

async function executeBash(input: { command: string; cwd?: string; timeout?: number }): Promise<ToolResult> {
  const safety = checkCommandSafety(input.command)
  if (!safety.isSafe) {
    return { output: `Command blocked: ${safety.reasons.join('; ')}`, success: false }
  }
  try {
    const { stdout, stderr } = await execAsync(input.command, {
      cwd: input.cwd || process.cwd(),
      timeout: input.timeout ?? 30000,
      maxBuffer: 10 * 1024 * 1024, // 10MB
    })
    const output = [stdout, stderr].filter(Boolean).join('\n').trim()
    const truncated = output.length > MAX_TOOL_OUTPUT
    return { output: truncateOutput(output), success: true, truncated }
  } catch (e: any) {
    // execAsync throws with { code, stdout, stderr } on non-zero exit
    const exitCode = e.code ?? 'unknown'
    const stderrOutput = e.stderr?.trim() || ''
    const stdoutOutput = e.stdout?.trim() || ''
    const cmdOutput = stderrOutput || stdoutOutput || ''
    const errorDetail = cmdOutput ? `\nSTDERR: ${stderrOutput}\nSTDOUT: ${stdoutOutput}` : ''
    const output = `Error (exit code ${exitCode})${errorDetail}`.trim()
    return { output, success: false, truncated: output.length > MAX_TOOL_OUTPUT }
  }
}

async function executeRead(input: { path: string; offset?: number; limit?: number }): Promise<ToolResult> {
  // Expand ~ to user home directory
  const resolvedPath = input.path.startsWith('~/')
    ? input.path.replace(/^~\//, (process.env.USERPROFILE || process.env.HOME || '').replace(/\\/g, '/') + '/')
    : input.path
  const safety = checkPathSafety(resolvedPath)
  if (!safety.isSafe) {
    return { output: `Path blocked: ${safety.reason}`, success: false }
  }
  try {
    const content = await fs.readFile(resolvedPath, 'utf-8')
    const lines = content.split('\n')
    const offset = input.offset ?? 0
    const limit = input.limit ?? lines.length
    const selected = lines.slice(offset, offset + limit)
    const output = selected.join('\n')
    const truncated = output.length > MAX_TOOL_OUTPUT
    return { output: truncateOutput(output), success: true, truncated }
  } catch (e: any) {
    return { output: e.message, success: false }
  }
}

async function executeWrite(input: { path: string; content: string }): Promise<ToolResult> {
  // Expand ~ to user home directory
  const resolvedPath = input.path.startsWith('~/')
    ? input.path.replace(/^~\//, (process.env.USERPROFILE || process.env.HOME || '').replace(/\\/g, '/') + '/')
    : input.path
  const safety = checkPathSafety(resolvedPath)
  if (!safety.isSafe) {
    return { output: `Path blocked: ${safety.reason}`, success: false }
  }
  try {
    const dir = resolvedPath.split('/').slice(0, -1).join('/')
    if (dir) await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(resolvedPath, input.content, 'utf-8')
    return { output: `Written to ${resolvedPath}`, success: true }
  } catch (e: any) {
    return { output: e.message, success: false }
  }
}

async function executeEdit(input: { path: string; old_string: string; new_string: string }): Promise<ToolResult> {
  // Expand ~ to user home directory
  const resolvedPath = input.path.startsWith('~/')
    ? input.path.replace(/^~\//, (process.env.USERPROFILE || process.env.HOME || '').replace(/\\/g, '/') + '/')
    : input.path
  const safety = checkPathSafety(resolvedPath)
  if (!safety.isSafe) {
    return { output: `Path blocked: ${safety.reason}`, success: false }
  }
  try {
    const content = await fs.readFile(resolvedPath, 'utf-8')
    if (!content.includes(input.old_string)) {
      return { output: `old_string not found in ${resolvedPath}`, success: false }
    }
    const updated = content.replace(input.old_string, input.new_string)
    await fs.writeFile(resolvedPath, updated, 'utf-8')
    return { output: `Edited ${input.path}`, success: true }
  } catch (e: any) {
    return { output: e.message, success: false }
  }
}

async function executeGlob(input: { pattern: string; cwd?: string }): Promise<ToolResult> {
  try {
    const matches = await glob(input.pattern, {
      cwd: input.cwd || process.cwd(),
      absolute: false,
    })
    if (matches.length === 0) return { output: 'No files found', success: true }
    const output = matches.join('\n')
    const truncated = output.length > MAX_TOOL_OUTPUT
    return { output: truncateOutput(output), success: true, truncated }
  } catch (e: any) {
    return { output: e.message, success: false }
  }
}

async function executeGrep(input: { pattern: string; path?: string; include?: string }): Promise<ToolResult> {
  const searchPath = input.path || '.'
  const safety = checkPathSafety(searchPath)
  if (!safety.isSafe) {
    return { output: `Path blocked: ${safety.reason}`, success: false }
  }

  try {
    const includeFlag = input.include ? `--include="${input.include}"` : ''
    const cmd = `grep -rn ${includeFlag} "${input.pattern.replace(/"/g, '\\"')}" "${searchPath}" 2>/dev/null || true`
    const { stdout } = await execAsync(cmd, { timeout: 10000, maxBuffer: 5 * 1024 * 1024 })
    const output = stdout.trim() || 'No matches found'
    const truncated = output.length > MAX_TOOL_OUTPUT
    return { output: truncateOutput(output), success: true, truncated }
  } catch (e: any) {
    return { output: e.message, success: false }
  }
}

export async function executeTool(name: string, input: any): Promise<ToolResult> {
  switch (name) {
    case 'bash': return executeBash(input)
    case 'read': return executeRead(input)
    case 'write': return executeWrite(input)
    case 'edit': return executeEdit(input)
    case 'glob': return executeGlob(input)
    case 'grep': return executeGrep(input)
    default: return { output: `Unknown tool: ${name}`, success: false }
  }
}

/**
 * Execute tool calls with concurrency:
 * - concurrencySafe tools run in parallel (Promise.all)
 * - non-safe tools run sequentially within their group
 * Returns results in the same order as input tool calls.
 *
 * Strategy: partition into concurrent and sequential groups,
 * run concurrent group fully in parallel, then sequential one by one.
 */
export async function executeToolCallsConcurrently(
  toolCalls: Array<{ id: string; name: string; input: any }>,
): Promise<Array<{ id: string; name: string; result: ToolResult }>> {
  const concurrent: typeof toolCalls = []
  const sequential: typeof toolCalls = []

  for (const tc of toolCalls) {
    if (CONCURRENT_SAFE_TOOLS.has(tc.name)) {
      concurrent.push(tc)
    } else {
      sequential.push(tc)
    }
  }

  // Run concurrent tools in parallel
  const concurrentResults = await Promise.all(
    concurrent.map(async tc => ({
      id: tc.id,
      name: tc.name,
      result: await executeTool(tc.name, tc.input),
    }))
  )

  // Run sequential tools one by one
  const sequentialResults: typeof concurrentResults = []
  for (const tc of sequential) {
    sequentialResults.push({
      id: tc.id,
      name: tc.name,
      result: await executeTool(tc.name, tc.input),
    })
  }

  // Merge and preserve original order
  const allResults = [...concurrentResults, ...sequentialResults]
  return toolCalls.map(tc => allResults.find(r => r.id === tc.id)!)
}
