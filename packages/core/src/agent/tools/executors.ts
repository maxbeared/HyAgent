/**
 * Tool Executors
 *
 * Contains all tool execution functions.
 * Separated from tools.ts to reduce file size.
 */

import { exec } from 'child_process'
import { promises as fs } from 'fs'
import { promisify } from 'util'
import { glob } from 'glob'
import { Effect } from 'effect'
import { checkCommandSafety, checkPathSafety } from '../../permission.js'
import { getPluginRegistry } from '../../plugin/index.js'
import type { ToolResult, ToolDefinition, AgentType } from './definitions.js'
import { TOOL_DEFINITIONS, AGENT_TOOL_FILTERS, CONCURRENT_SAFE_TOOLS } from './definitions.js'
import { getSkillService } from '../../skill/service.js'

const execAsync = promisify(exec)

// Max characters to retain from tool output (prevents context overflow from large files)
const MAX_TOOL_OUTPUT = 8_000

function truncateOutput(output: string): string {
  if (output.length <= MAX_TOOL_OUTPUT) return output
  return output.slice(0, MAX_TOOL_OUTPUT) +
    `\n... [truncated ${output.length - MAX_TOOL_OUTPUT} chars]`
}

// ============================================================================
// Tool Definitions Getters
// ============================================================================

export async function getToolDefinitions(agentType: AgentType = 'default'): Promise<ToolDefinition[]> {
  const registry = getPluginRegistry()
  let tools = TOOL_DEFINITIONS

  // Apply agent-specific filtering
  const allowedTools = AGENT_TOOL_FILTERS[agentType]
  if (allowedTools.length > 0) {
    tools = tools.filter((tool) => allowedTools.includes(tool.name))
  }

  return registry.processToolDefinitions(tools)
}

export function getAgentTypes(): AgentType[] {
  return ['default', 'research', 'coding', 'review', 'exploration']
}

export function isToolAvailableForAgent(toolName: string, agentType: AgentType): boolean {
  const allowedTools = AGENT_TOOL_FILTERS[agentType]
  if (allowedTools.length === 0) return true  // Empty means all allowed
  return allowedTools.includes(toolName)
}

// ============================================================================
// Tool Executors
// ============================================================================

async function executeBash(input: { command: string; cwd?: string; timeout?: number }, signal?: AbortSignal, permissionMode?: string): Promise<ToolResult> {
  // In permissive mode, skip all safety checks
  if (permissionMode !== 'permissive') {
    const safety = checkCommandSafety(input.command)
    if (!safety.isSafe) {
      // Critical safety issues (path traversal, protected paths, etc.) are always blocked
      const criticalReasons = ['Path traversal', 'Protected path', 'Shell config', 'Root delete']
      const isCritical = safety.reasons.some(r => criticalReasons.some(c => r.includes(c)))
      if (isCritical) {
        return {
          output: `Command blocked: ${safety.reasons.join(', ')}`,
          success: false,
          requiresPermission: false,
        }
      }
      return {
        output: `Command requires permission: ${safety.reasons.join(', ')}`,
        success: false,
        requiresPermission: true,
        permissionReasons: safety.reasons,
      }
    }
  }

  // Check path safety for cwd
  if (input.cwd && permissionMode !== 'permissive') {
    const pathSafety = checkPathSafety(input.cwd)
    if (!pathSafety.isSafe) {
      return {
        output: `Path blocked: ${pathSafety.reason ?? 'unsafe path'}`,
        success: false,
      }
    }
  }

  const timeout = input.timeout ?? 30000
  const startTime = Date.now()

  try {
    const result = await execAsync(input.command, {
      cwd: input.cwd,
      timeout,
      signal: signal as any,
    })

    return {
      output: truncateOutput(result.stdout + result.stderr),
      success: true,
    }
  } catch (error: any) {
    if (error.killed) {
      return {
        output: `Command timed out after ${timeout}ms`,
        success: false,
      }
    }
    return {
      output: truncateOutput(error.message),
      success: false,
    }
  }
}

async function executeRead(input: { path: string; offset?: number; limit?: number }, signal?: AbortSignal): Promise<ToolResult> {
  if (signal?.aborted) {
    return { output: 'Operation cancelled', success: false }
  }

  try {
    let content = await fs.readFile(input.path, 'utf-8')
    const lines = content.split('\n')

    // Apply offset and limit
    if (input.offset !== undefined || input.limit !== undefined) {
      const start = input.offset ?? 0
      const end = input.limit ? start + input.limit : undefined
      content = lines.slice(start, end).join('\n')
    }

    return {
      output: content || '(empty file)',
      success: true,
      truncated: content.length > MAX_TOOL_OUTPUT,
    }
  } catch (error: any) {
    return { output: `Read error: ${error.message}`, success: false }
  }
}

async function executeWrite(input: { path: string; content: string }, signal?: AbortSignal, permissionMode?: string): Promise<ToolResult> {
  if (signal?.aborted) {
    return { output: 'Operation cancelled', success: false }
  }

  if (permissionMode !== 'permissive') {
    const safety = checkPathSafety(input.path)
    if (!safety.isSafe) {
      return {
        output: `Path blocked: ${safety.reason ?? 'unsafe path'}`,
        success: false,
        requiresPermission: true,
        permissionReasons: safety.reason ? [safety.reason] : undefined,
      }
    }
  }

  try {
    await fs.writeFile(input.path, input.content, 'utf-8')
    return {
      output: `Written ${input.content.length} characters to ${input.path}`,
      success: true,
    }
  } catch (error: any) {
    return { output: `Write error: ${error.message}`, success: false }
  }
}

async function executeEdit(input: { path: string; old_string: string; new_string: string }, signal?: AbortSignal, permissionMode?: string): Promise<ToolResult> {
  if (signal?.aborted) {
    return { output: 'Operation cancelled', success: false }
  }

  if (permissionMode !== 'permissive') {
    const safety = checkPathSafety(input.path)
    if (!safety.isSafe) {
      return {
        output: `Path blocked: ${safety.reason ?? 'unsafe path'}`,
        success: false,
        requiresPermission: true,
        permissionReasons: safety.reason ? [safety.reason] : undefined,
      }
    }
  }

  try {
    let content = await fs.readFile(input.path, 'utf-8')
    const oldIndex = content.indexOf(input.old_string)
    if (oldIndex === -1) {
      return { output: `String not found: ${input.old_string}`, success: false }
    }
    content = content.replace(input.old_string, input.new_string)
    await fs.writeFile(input.path, content, 'utf-8')
    return {
      output: `Edited ${input.path}`,
      success: true,
    }
  } catch (error: any) {
    return { output: `Edit error: ${error.message}`, success: false }
  }
}

async function executeGlob(input: { pattern: string; cwd?: string }, signal?: AbortSignal): Promise<ToolResult> {
  if (signal?.aborted) {
    return { output: 'Operation cancelled', success: false }
  }

  try {
    const matches = await glob(input.pattern, { cwd: input.cwd })
    return {
      output: matches.join('\n') || '(no matches)',
      success: true,
    }
  } catch (error: any) {
    return { output: `Glob error: ${error.message}`, success: false }
  }
}

async function executeGrep(input: { pattern: string; path?: string; include?: string }, signal?: AbortSignal): Promise<ToolResult> {
  if (signal?.aborted) {
    return { output: 'Operation cancelled', success: false }
  }

  try {
    const args = ['grep', '-n', input.pattern]
    if (input.include) {
      args.push('--include=' + input.include)
    }
    args.push(input.path || '.')

    const result = await execAsync(args.join(' '))
    return {
      output: result.stdout || '(no matches)',
      success: true,
      truncated: result.stdout.length > MAX_TOOL_OUTPUT,
    }
  } catch (error: any) {
    if (error.code === 1) {
      return { output: '(no matches)', success: true }
    }
    return { output: `Grep error: ${error.message}`, success: false }
  }
}

async function executeWebSearch(input: { query: string; limit?: number }, signal?: AbortSignal): Promise<ToolResult> {
  if (signal?.aborted) {
    return { output: 'Operation cancelled', success: false }
  }

  // Placeholder - web search would use Tavily or similar
  return {
    output: `Web search not implemented: ${input.query}`,
    success: false,
  }
}

async function executeWebFetch(input: { url: string; maxLength?: number }, signal?: AbortSignal): Promise<ToolResult> {
  if (signal?.aborted) {
    return { output: 'Operation cancelled', success: false }
  }

  try {
    const response = await fetch(input.url)
    const text = await response.text()
    const maxLength = input.maxLength ?? 10000
    return {
      output: text.slice(0, maxLength) + (text.length > maxLength ? '\n...[truncated]' : ''),
      success: true,
    }
  } catch (error: any) {
    return { output: `Fetch error: ${error.message}`, success: false }
  }
}

async function executeTask(input: { task: string; description?: string }, signal?: AbortSignal): Promise<ToolResult> {
  if (signal?.aborted) {
    return { output: 'Operation cancelled', success: false }
  }

  // Placeholder - task system would create background task
  const taskId = `task_${Date.now()}`
  return {
    output: `Task created: ${taskId}`,
    success: true,
  }
}

async function executeTaskResult(input: { taskId: string }, signal?: AbortSignal): Promise<ToolResult> {
  if (signal?.aborted) {
    return { output: 'Operation cancelled', success: false }
  }

  // Placeholder - task result lookup
  return {
    output: `Task result not available: ${input.taskId}`,
    success: false,
  }
}

async function executeTaskList(_input: Record<string, never>, signal?: AbortSignal): Promise<ToolResult> {
  if (signal?.aborted) {
    return { output: 'Operation cancelled', success: false }
  }

  return {
    output: '(no active tasks)',
    success: true,
  }
}

async function executeNotebook(input: { path: string; operation: string; cell_index?: number; cell_type?: string; source?: string }, signal?: AbortSignal): Promise<ToolResult> {
  if (signal?.aborted) {
    return { output: 'Operation cancelled', success: false }
  }

  return {
    output: `Notebook operation not implemented: ${input.operation}`,
    success: false,
  }
}

async function executeSkill(input: { skill: string; args?: string }, signal?: AbortSignal): Promise<ToolResult> {
  if (signal?.aborted) {
    return { output: 'Execution cancelled', success: false }
  }

  const { getSkillService } = await import('../../skill/service.js')
  try {
    const service = getSkillService()
    const result = await service.invokeSkill(input.skill, input.args).pipe(
      Effect.runPromise
    )
    return { output: result.content, success: true }
  } catch (e: any) {
    return { output: `Skill error: ${e.message}`, success: false }
  }
}

async function executePlanExit(input: { approve: boolean; reason?: string }, signal?: AbortSignal): Promise<ToolResult> {
  if (signal?.aborted) {
    return { output: 'Execution cancelled', success: false }
  }

  const { processPlanExit } = await import('../planMode.js')
  const result = await processPlanExit(input.approve, input.reason)

  if (!result.approved) {
    return {
      output: `Plan exit failed: ${result.reason ?? 'unknown'}`,
      success: false,
    }
  }

  return {
    output: `Plan ${input.approve ? 'approved' : 'rejected'}${result.reason ? `: ${result.reason}` : ''}.\n\n` +
      'Please revise the plan based on feedback and run plan_exit again when ready.',
    success: true,
  }
}

// ============================================================================
// Main Entry Points
// ============================================================================

export async function executeTool(name: string, input: any, signal?: AbortSignal, permissionMode?: string): Promise<ToolResult> {
  switch (name) {
    case 'bash': return executeBash(input, signal, permissionMode)
    case 'read': return executeRead(input, signal)
    case 'write': return executeWrite(input, signal, permissionMode)
    case 'edit': return executeEdit(input, signal, permissionMode)
    case 'glob': return executeGlob(input, signal)
    case 'grep': return executeGrep(input, signal)
    case 'websearch': return executeWebSearch(input, signal)
    case 'webfetch': return executeWebFetch(input, signal)
    case 'task': return executeTask(input, signal)
    case 'task_result': return executeTaskResult(input, signal)
    case 'task_list': return executeTaskList(input, signal)
    case 'notebook': return executeNotebook(input, signal)
    case 'skill': return executeSkill(input, signal)
    case 'plan_exit': return executePlanExit(input, signal)
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
 */
export async function executeToolCallsConcurrently(
  toolCalls: Array<{ id: string; name: string; input: unknown }>,
  signal?: AbortSignal,
  permissionMode?: string
): Promise<Array<{ id: string; name: string; result: ToolResult }>> {
  if (!toolCalls.length) return []

  // Check abort before starting
  if (signal?.aborted) {
    return toolCalls.map(tc => ({
      id: tc.id,
      name: tc.name,
      result: { output: 'Execution cancelled', success: false },
    }))
  }

  // Set up abort handler
  const abortHandler = () => {
    signal?.removeEventListener('abort', abortHandler)
  }
  signal?.addEventListener('abort', abortHandler)

  try {
    // Separate concurrent and sequential tools
    const concurrent = toolCalls.filter(tc => CONCURRENT_SAFE_TOOLS.has(tc.name))
    const sequential = toolCalls.filter(tc => !CONCURRENT_SAFE_TOOLS.has(tc.name))

    // Helper to check abort between sequential operations
    const checkAbort = () => {
      if (signal?.aborted) throw new Error('Aborted')
    }

    // Run concurrent tools in parallel
    const concurrentResults = await Promise.all(
      concurrent.map(async tc => {
        checkAbort()
        return {
          id: tc.id,
          name: tc.name,
          result: await executeTool(tc.name, tc.input, signal, permissionMode),
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
        result: await executeTool(tc.name, tc.input, signal, permissionMode),
      })
    }

    // Merge and preserve original order
    const allResults = [...concurrentResults, ...sequentialResults]
    return toolCalls.map(tc => allResults.find(r => r.id === tc.id)!)
  } finally {
    signal?.removeEventListener('abort', abortHandler)
  }
}