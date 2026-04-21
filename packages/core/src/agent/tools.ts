/**
 * Tool definitions and execution
 * Provides the set of tools available to the Agent.
 *
 * Tool concurrency model (borrowed from Claude Code StreamingToolExecutor):
 * - concurrencySafe tools: read, glob, grep — can run in parallel
 * - non-safe tools: bash, edit, write — run sequentially to avoid conflicts
 *
 * Enhanced with Claude Code-style metadata:
 * - searchHint: keyword hints for ToolSearch
 * - isConcurrencySafe: whether tool can run in parallel
 * - isReadOnly: whether tool only reads data
 * - isDestructive: whether tool irreversibly modifies data
 * - isSearchOrReadCommand: UI collapse hints
 * - maxResultSizeChars: result size limit
 */

import { exec } from 'child_process'
import { promises as fs } from 'fs'
import { promisify } from 'util'
import { glob } from 'glob'
import { Effect } from 'effect'
import { checkCommandSafety, checkPathSafety } from '../permission.js'
import { getPluginRegistry } from '../plugin/index.js'

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

// ============================================================================
// Enhanced Tool Metadata (Claude Code style)
// ============================================================================

/**
 * Tool metadata for enhanced tool selection and UI rendering
 */
export interface ToolMetadata {
  /** Short keyword hint for ToolSearch (3-10 words) */
  searchHint?: string
  /** Whether this tool can run concurrently with others */
  isConcurrencySafe?: (input?: unknown) => boolean
  /** Whether this tool only reads data, never modifies */
  isReadOnly?: (input?: unknown) => boolean
  /** Whether this tool irreversibly modifies data */
  isDestructive?: (input?: unknown) => boolean
  /** UI hints for collapsing search/read operations */
  isSearchOrReadCommand?: (input?: unknown) => {
    isSearch: boolean
    isRead: boolean
    isList?: boolean
  }
  /** Max result size before truncation/persistence */
  maxResultSizeChars?: number
  /** User-facing name for this specific invocation */
  userFacingName?: (input?: unknown) => string
}

/**
 * Tool definition with full metadata
 */
export interface ToolDefinition {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
  metadata?: ToolMetadata
}

// Tool metadata registry
const TOOL_METADATA: Record<string, ToolMetadata> = {
  bash: {
    searchHint: 'run shell command npm git',
    isConcurrencySafe: () => false,
    isReadOnly: () => false,
    isDestructive: () => false,
    userFacingName: (input: unknown) => {
      const cmd = (input as { command?: string })?.command ?? ''
      const base = cmd.split(' ')[0] ?? 'bash'
      return base
    },
    maxResultSizeChars: 8_000,
  },
  read: {
    searchHint: 'read file contents view',
    isConcurrencySafe: () => true,
    isReadOnly: () => true,
    isSearchOrReadCommand: () => ({ isSearch: false, isRead: true }),
    maxResultSizeChars: 8_000,
  },
  write: {
    searchHint: 'create new file write content',
    isConcurrencySafe: () => false,
    isReadOnly: () => false,
    isDestructive: () => true,
    userFacingName: (input: unknown) => {
      const path = (input as { path?: string })?.path ?? 'file'
      return path.split('/').pop() ?? path
    },
    maxResultSizeChars: 500,
  },
  edit: {
    searchHint: 'modify file edit content',
    isConcurrencySafe: () => false,
    isReadOnly: () => false,
    isDestructive: () => false,
    userFacingName: (input: unknown) => {
      const path = (input as { path?: string })?.path ?? 'file'
      return path.split('/').pop() ?? path
    },
    maxResultSizeChars: 500,
  },
  glob: {
    searchHint: 'find files by pattern glob',
    isConcurrencySafe: () => true,
    isReadOnly: () => true,
    isSearchOrReadCommand: () => ({ isSearch: true, isRead: false, isList: true }),
    maxResultSizeChars: 8_000,
  },
  grep: {
    searchHint: 'search text in files grep',
    isConcurrencySafe: () => true,
    isReadOnly: () => true,
    isSearchOrReadCommand: () => ({ isSearch: true, isRead: false }),
    maxResultSizeChars: 8_000,
  },
  websearch: {
    searchHint: 'search web internet find',
    isConcurrencySafe: () => true,
    isReadOnly: () => true,
    isSearchOrReadCommand: () => ({ isSearch: true, isRead: false }),
    maxResultSizeChars: 8_000,
  },
  webfetch: {
    searchHint: 'fetch webpage URL content',
    isConcurrencySafe: () => true,
    isReadOnly: () => true,
    isSearchOrReadCommand: () => ({ isSearch: false, isRead: true }),
    maxResultSizeChars: 10_000,
  },
  task: {
    searchHint: 'background task async job',
    isConcurrencySafe: () => true,
    isReadOnly: () => false,
    maxResultSizeChars: 500,
  },
  task_result: {
    searchHint: 'get background task result',
    isConcurrencySafe: () => true,
    isReadOnly: () => true,
    maxResultSizeChars: 8_000,
  },
  task_list: {
    searchHint: 'list all tasks status',
    isConcurrencySafe: () => true,
    isReadOnly: () => true,
    isSearchOrReadCommand: () => ({ isSearch: false, isRead: false, isList: true }),
    maxResultSizeChars: 2_000,
  },
  notebook: {
    searchHint: 'jupyter notebook cell',
    isConcurrencySafe: () => false,
    isReadOnly: () => false,
    isDestructive: () => false,
    maxResultSizeChars: 8_000,
  },
  skill: {
    searchHint: 'invoke skill plugin',
    isConcurrencySafe: () => true,
    isReadOnly: () => false,
    maxResultSizeChars: 8_000,
  },
}

/**
 * Get metadata for a tool by name
 */
export function getToolMetadata(toolName: string): ToolMetadata | undefined {
  return TOOL_METADATA[toolName]
}

/**
 * Check if a tool is concurrency safe
 */
export function isConcurrencySafeTool(toolName: string, input?: unknown): boolean {
  const meta = TOOL_METADATA[toolName]
  if (!meta?.isConcurrencySafe) return false
  return meta.isConcurrencySafe(input)
}

/**
 * Check if a tool is read-only
 */
export function isReadOnlyTool(toolName: string, input?: unknown): boolean {
  const meta = TOOL_METADATA[toolName]
  if (!meta?.isReadOnly) return false
  return meta.isReadOnly(input)
}

/**
 * Check if a tool is destructive
 */
export function isDestructiveTool(toolName: string, input?: unknown): boolean {
  const meta = TOOL_METADATA[toolName]
  if (!meta?.isDestructive) return false
  return meta.isDestructive(input)
}

/**
 * Get search/read hints for a tool
 */
export function getSearchReadHints(toolName: string, input?: unknown): { isSearch: boolean; isRead: boolean; isList?: boolean } | undefined {
  const meta = TOOL_METADATA[toolName]
  if (!meta?.isSearchOrReadCommand) return undefined
  return meta.isSearchOrReadCommand(input)
}

/**
 * Get user-facing name for a tool invocation
 */
export function getUserFacingName(toolName: string, input?: unknown): string {
  const meta = TOOL_METADATA[toolName]
  if (!meta?.userFacingName) return toolName
  return meta.userFacingName(input)
}

// ============================================================================
// Tool Definitions (Enhanced)
// ============================================================================

// Tools that are safe to run concurrently (read-only operations)
export const CONCURRENT_SAFE_TOOLS = new Set(['read', 'glob', 'grep', 'websearch', 'webfetch', 'task', 'task_result', 'task_list', 'notebook', 'skill'])

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
  {
    name: 'websearch',
    description: 'Search the web for information. Use this when you need to find current information, look up facts, or research topics that require internet access.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Maximum number of results (default: 5)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'webfetch',
    description: 'Fetch the content of a web page. Use this to get detailed information from a specific URL.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to fetch' },
        maxLength: { type: 'number', description: 'Maximum content length (default: 10000)' },
      },
      required: ['url'],
    },
  },
  {
    name: 'task',
    description: 'Create a background task. Returns a task ID for retrieving results later.',
    input_schema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'The task to execute' },
        description: { type: 'string', description: 'Optional description' },
      },
      required: ['task'],
    },
  },
  {
    name: 'task_result',
    description: 'Get the result of a background task.',
    input_schema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'The task ID from task creation' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'task_list',
    description: 'List all tasks and their statuses.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'notebook',
    description: 'Read or edit Jupyter notebooks (.ipynb). Supports reading notebooks, adding/updating/deleting cells.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the notebook file' },
        operation: { type: 'string', description: 'Operation: read, add_cell, update_cell, delete_cell' },
        cell_index: { type: 'number', description: 'Cell index for update/delete' },
        cell_type: { type: 'string', description: 'Cell type: code, markdown, raw' },
        source: { type: 'string', description: 'Cell source content' },
      },
      required: ['path', 'operation'],
    },
  },
  {
    name: 'skill',
    description: 'Invoke a reusable skill by name. Skills are pre-defined prompt templates stored in skills directories.',
    input_schema: {
      type: 'object',
      properties: {
        skill: { type: 'string', description: 'The skill name to invoke' },
        args: { type: 'string', description: 'Optional arguments for the skill' },
      },
      required: ['skill'],
    },
  },
]

/**
 * Agent types for tool filtering
 */
export type AgentType = 'default' | 'research' | 'coding' | 'review' | 'exploration'

/**
 * Tool filter configuration by agent type
 */
const AGENT_TOOL_FILTERS: Record<AgentType, string[]> = {
  // Default agent has all tools
  default: [],
  // Research agent has limited tools (no file modification)
  research: ['read', 'glob', 'grep', 'websearch', 'webfetch'],
  // Coding agent has all tools
  coding: [],
  // Review agent has read-only + task tools
  review: ['read', 'glob', 'grep', 'task', 'task_result', 'task_list'],
  // Exploration agent has web + read tools
  exploration: ['read', 'glob', 'grep', 'websearch', 'webfetch', 'task', 'task_result', 'task_list'],
}

/**
 * Get tool definitions, processed through plugin hooks.
 * Optionally filter by agent type.
 *
 * @param agentType - Filter tools by agent type
 */
export async function getToolDefinitions(agentType: AgentType = 'default'): Promise<typeof TOOL_DEFINITIONS[number][]> {
  const registry = getPluginRegistry()
  let tools = TOOL_DEFINITIONS

  // Apply agent-specific filtering
  const allowedTools = AGENT_TOOL_FILTERS[agentType]
  if (allowedTools.length > 0) {
    tools = tools.filter((tool) => allowedTools.includes(tool.name))
  }

  return registry.processToolDefinitions(tools)
}

/**
 * Get available agent types
 */
export function getAgentTypes(): AgentType[] {
  return ['default', 'research', 'coding', 'review', 'exploration']
}

/**
 * Check if a tool is available for an agent type
 */
export function isToolAvailableForAgent(toolName: string, agentType: AgentType): boolean {
  const allowedTools = AGENT_TOOL_FILTERS[agentType]
  if (allowedTools.length === 0) return true  // Empty means all allowed
  return allowedTools.includes(toolName)
}

async function executeBash(input: { command: string; cwd?: string; timeout?: number }, signal?: AbortSignal): Promise<ToolResult> {
  const safety = checkCommandSafety(input.command)
  if (!safety.isSafe) {
    return { output: `Command blocked: ${safety.reasons.join('; ')}`, success: false }
  }

  // Check abort before starting
  if (signal?.aborted) {
    return { output: 'Execution cancelled', success: false }
  }

  try {
    // Create a promise that wraps execAsync with abort support
    const { stdout, stderr } = await Promise.race([
      execAsync(input.command, {
        cwd: input.cwd || process.cwd(),
        timeout: input.timeout ?? 30000,
        maxBuffer: 10 * 1024 * 1024, // 10MB
      }),
      new Promise<never>((_, reject) => {
        signal?.addEventListener('abort', () => {
          reject(new Error('Execution cancelled'))
        })
      }),
    ])
    const output = [stdout, stderr].filter(Boolean).join('\n').trim()
    const truncated = output.length > MAX_TOOL_OUTPUT
    return { output: truncateOutput(output), success: true, truncated }
  } catch (e: any) {
    if (e.message === 'Execution cancelled') {
      return { output: 'Execution cancelled', success: false }
    }
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

async function executeRead(input: { path: string; offset?: number; limit?: number }, signal?: AbortSignal): Promise<ToolResult> {
  // Check abort before starting
  if (signal?.aborted) {
    return { output: 'Execution cancelled', success: false }
  }

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

async function executeWrite(input: { path: string; content: string }, signal?: AbortSignal): Promise<ToolResult> {
  // Check abort before starting
  if (signal?.aborted) {
    return { output: 'Execution cancelled', success: false }
  }

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

async function executeEdit(input: { path: string; old_string: string; new_string: string }, signal?: AbortSignal): Promise<ToolResult> {
  // Check abort before starting
  if (signal?.aborted) {
    return { output: 'Execution cancelled', success: false }
  }

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

async function executeGlob(input: { pattern: string; cwd?: string }, signal?: AbortSignal): Promise<ToolResult> {
  // Check abort before starting
  if (signal?.aborted) {
    return { output: 'Execution cancelled', success: false }
  }

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

async function executeGrep(input: { pattern: string; path?: string; include?: string }, signal?: AbortSignal): Promise<ToolResult> {
  // Check abort before starting
  if (signal?.aborted) {
    return { output: 'Execution cancelled', success: false }
  }
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

async function executeWebSearch(input: { query: string; limit?: number }, signal?: AbortSignal): Promise<ToolResult> {
  // Check abort before starting
  if (signal?.aborted) {
    return { output: 'Execution cancelled', success: false }
  }

  const { duckduckgoSearch } = await import('../tool/websearch.js')
  try {
    const results = await duckduckgoSearch(input.query, input.limit ?? 5)
    const output = results
      .map((r, i) => `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.snippet}`)
      .join('\n\n')
    return { output: output || 'No results found.', success: true }
  } catch (e: any) {
    return { output: `Search error: ${e.message}`, success: false }
  }
}

async function executeWebFetch(input: { url: string; maxLength?: number }, signal?: AbortSignal): Promise<ToolResult> {
  // Check abort before starting
  if (signal?.aborted) {
    return { output: 'Execution cancelled', success: false }
  }

  const { defaultWebFetch } = await import('../tool/webfetch.js')
  try {
    const result = await defaultWebFetch(input.url, input.maxLength ?? 10000)
    return {
      output: `Title: ${result.title || 'N/A'}\n\n${result.content}`,
      success: true,
    }
  } catch (e: any) {
    return { output: `Fetch error: ${e.message}`, success: false }
  }
}

async function executeTask(input: { task: string; description?: string }, signal?: AbortSignal): Promise<ToolResult> {
  const { getTaskStore } = await import('../tool/task.js')
  try {
    const store = getTaskStore()
    const task = store.create(input.task, input.description)
    return {
      output: `Task created successfully.\nTask ID: ${task.id}\nTask: ${input.task}\n\nUse task_result to get the result when ready.`,
      success: true,
    }
  } catch (e: any) {
    return { output: `Task error: ${e.message}`, success: false }
  }
}

async function executeTaskResult(input: { taskId: string }, signal?: AbortSignal): Promise<ToolResult> {
  // Check abort before starting
  if (signal?.aborted) {
    return { output: 'Execution cancelled', success: false }
  }

  const { getTaskStore } = await import('../tool/task.js')
  try {
    const store = getTaskStore()
    const task = store.get(input.taskId)

    if (!task) {
      return { output: `Task not found: ${input.taskId}`, success: false }
    }

    let output = `Task ID: ${task.id}\nStatus: ${task.status}\n`

    if (task.status === 'completed' && task.result) {
      output += `\nResult:\n${task.result}`
    } else if (task.status === 'failed' && task.error) {
      output += `\nError:\n${task.error}`
    } else if (task.status === 'running') {
      output += '\nTask is still running...'
    } else if (task.status === 'pending') {
      output += '\nTask is pending...'
    }

    return { output, success: true }
  } catch (e: any) {
    return { output: `Task error: ${e.message}`, success: false }
  }
}

async function executeTaskList(_input: Record<string, never>, signal?: AbortSignal): Promise<ToolResult> {
  // Check abort before starting
  if (signal?.aborted) {
    return { output: 'Execution cancelled', success: false }
  }
  const { getTaskStore } = await import('../tool/task.js')
  try {
    const store = getTaskStore()
    const tasks = store.list()

    if (tasks.length === 0) {
      return { output: 'No tasks.', success: true }
    }

    const lines = tasks.map(
      (t) => `${t.id}: ${t.status} - ${t.task.slice(0, 50)}${t.task.length > 50 ? '...' : ''}`
    )

    return { output: `Tasks:\n${lines.join('\n')}`, success: true }
  } catch (e: any) {
    return { output: `Task error: ${e.message}`, success: false }
  }
}

async function executeNotebook(input: { path: string; operation: string; cell_index?: number; cell_type?: string; source?: string }, signal?: AbortSignal): Promise<ToolResult> {
  // Check abort before starting
  if (signal?.aborted) {
    return { output: 'Execution cancelled', success: false }
  }

  const { parseNotebook, writeNotebook, createEmptyNotebook } = await import('../tool/notebook.js')
  const { existsSync } = await import('fs')

  try {
    let notebook: any
    if (existsSync(input.path)) {
      const content = await import('fs/promises').then(fs => fs.readFile(input.path, 'utf-8'))
      notebook = JSON.parse(content)
    } else if (input.operation === 'read') {
      return { output: `Notebook not found: ${input.path}`, success: false }
    } else {
      notebook = createEmptyNotebook()
    }

    switch (input.operation) {
      case 'read': {
        const cells = notebook.cells.map((cell: any, i: number) => {
          const source = Array.isArray(cell.source) ? cell.source.join('') : cell.source
          return `[Cell ${i}] ${cell.cell_type}:\n${source.slice(0, 200)}${source.length > 200 ? '...' : ''}`
        })
        return { output: `Notebook: ${input.path}\nCells: ${notebook.cells.length}\n\n${cells.join('\n\n')}`, success: true }
      }

      case 'add_cell': {
        if (!input.source) {
          return { output: 'source is required for add_cell', success: false }
        }
        notebook.cells.push({
          cell_type: input.cell_type || 'code',
          metadata: {},
          source: input.source,
          execution_count: null,
          outputs: [],
        })
        await writeNotebook(input.path, notebook)
        return { output: `Cell added at index ${notebook.cells.length - 1}`, success: true }
      }

      case 'update_cell': {
        if (input.cell_index === undefined) {
          return { output: 'cell_index is required', success: false }
        }
        if (input.cell_index < 0 || input.cell_index >= notebook.cells.length) {
          return { output: `Cell index out of range: ${input.cell_index}`, success: false }
        }
        const cell = notebook.cells[input.cell_index]
        if (input.source) cell.source = input.source
        if (input.cell_type) cell.cell_type = input.cell_type
        await writeNotebook(input.path, notebook)
        return { output: `Cell ${input.cell_index} updated`, success: true }
      }

      case 'delete_cell': {
        if (input.cell_index === undefined) {
          return { output: 'cell_index is required', success: false }
        }
        if (input.cell_index < 0 || input.cell_index >= notebook.cells.length) {
          return { output: `Cell index out of range: ${input.cell_index}`, success: false }
        }
        notebook.cells.splice(input.cell_index, 1)
        await writeNotebook(input.path, notebook)
        return { output: `Cell ${input.cell_index} deleted`, success: true }
      }

      default:
        return { output: `Unknown operation: ${input.operation}`, success: false }
    }
  } catch (e: any) {
    return { output: `Notebook error: ${e.message}`, success: false }
  }
}

async function executeSkill(input: { skill: string; args?: string }, signal?: AbortSignal): Promise<ToolResult> {
  // Check abort before starting
  if (signal?.aborted) {
    return { output: 'Execution cancelled', success: false }
  }

  const { getSkillService } = await import('../skill/service.js')
  try {
    const service = getSkillService()
    const result = await service.invokeSkill(input.skill, input.args).pipe(
      Effect.either,
      Effect.map((either) => {
        if (either._tag === 'Left') {
          return { output: `Skill error: ${either.left.message}`, success: false }
        }
        const { content } = either.right
        return { output: content, success: true }
      }),
      Effect.runPromise
    )
    return result
  } catch (e: any) {
    return { output: `Skill error: ${e.message}`, success: false }
  }
}

export async function executeTool(name: string, input: any, signal?: AbortSignal): Promise<ToolResult> {
  switch (name) {
    case 'bash': return executeBash(input, signal)
    case 'read': return executeRead(input, signal)
    case 'write': return executeWrite(input, signal)
    case 'edit': return executeEdit(input, signal)
    case 'glob': return executeGlob(input, signal)
    case 'grep': return executeGrep(input, signal)
    case 'websearch': return executeWebSearch(input, signal)
    case 'webfetch': return executeWebFetch(input, signal)
    case 'task': return executeTask(input, signal)
    case 'task_result': return executeTaskResult(input, signal)
    case 'task_list': return executeTaskList(input, signal)
    case 'notebook': return executeNotebook(input, signal)
    case 'skill': return executeSkill(input, signal)
    default: return { output: `Unknown tool: ${name}`, success: false }
  }
}

/**
 * Execute tool calls with concurrency:
 * - concurrencySafe tools run in parallel (Promise.all)
 * - non-safe tools run sequentially within their group
 * Returns results in the same order as input tool calls.
 *
 * Supports AbortSignal for cancellation.
 *
 * Strategy: partition into concurrent and sequential groups,
 * run concurrent group fully in parallel, then sequential one by one.
 */
export async function executeToolCallsConcurrently(
  toolCalls: Array<{ id: string; name: string; input: any }>,
  signal?: AbortSignal,
): Promise<Array<{ id: string; name: string; result: ToolResult }>> {
  // Check if already aborted
  if (signal?.aborted) {
    return toolCalls.map(tc => ({
      id: tc.id,
      name: tc.name,
      result: { output: 'Execution cancelled', success: false } as ToolResult,
    }))
  }

  // Create abort listener
  const abortHandler = () => {
    // Tools should check signal.aborted during execution
  }
  signal?.addEventListener('abort', abortHandler)

  try {
    const concurrent: typeof toolCalls = []
    const sequential: typeof toolCalls = []

    for (const tc of toolCalls) {
      if (CONCURRENT_SAFE_TOOLS.has(tc.name)) {
        concurrent.push(tc)
      } else {
        sequential.push(tc)
      }
    }

    // Helper to check abort
    const checkAbort = () => {
      if (signal?.aborted) {
        throw new Error('Execution cancelled')
      }
    }

    // Run concurrent tools in parallel
    const concurrentResults = await Promise.all(
      concurrent.map(async tc => {
        checkAbort()
        return {
          id: tc.id,
          name: tc.name,
          result: await executeTool(tc.name, tc.input, signal),
        }
      })
    )

    // Run sequential tools one by one
    const sequentialResults: typeof concurrentResults = []
    for (const tc of sequential) {
      checkAbort()
      sequentialResults.push({
        id: tc.id,
        name: tc.name,
        result: await executeTool(tc.name, tc.input, signal),
      })
    }

    // Merge and preserve original order
    const allResults = [...concurrentResults, ...sequentialResults]
    return toolCalls.map(tc => allResults.find(r => r.id === tc.id)!)
  } finally {
    signal?.removeEventListener('abort', abortHandler)
  }
}
