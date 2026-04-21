/**
 * Agent core loop
 *
 * Implements the main agentic cycle:
 * 1. Call LLM with current message history + tools
 * 2. Parse response: text blocks + tool_use blocks
 * 3. If stop_reason == 'end_turn' → task complete
 * 4. If stop_reason == 'tool_use' → execute tools concurrently, append results, loop
 * 5. Doom loop detection: exact same tool+input repeated N times → abort
 * 6. Token budget tracking: trigger compaction before hitting context limit
 * 7. Max iterations guard
 *
 * Design inspired by:
 * - Claude Code: query.ts while(true) loop, StreamingToolExecutor
 * - OpenCode: doom loop detection (DOOM_LOOP_THRESHOLD=3), session compaction
 */

import { TOOL_DEFINITIONS, executeToolCallsConcurrently } from './tools.js'
import { compactMessages, shouldCompact, checkCompactionState, type Message } from './compaction.js'
import { detectDoomLoop, hasSubstantialText } from './doomDetect.js'
import { saveCheckpoint } from './checkpoint.js'
import { getHooksRegistry, type TurnEndContext, type TaskCompleteContext, type IterationContext } from './hooks.js'

// How many consecutive identical tool calls trigger doom loop detection
const DOOM_LOOP_THRESHOLD = 3

// Hard cap: abort if we've been in tool-only mode for this many turns straight
// (safety net for diverse-but-never-finishing tool call chains)
const DOOM_LOOP_MAX_TOOL_ONLY_TURNS = 10

const SYSTEM_PROMPT = `You are a highly capable AI coding assistant that can autonomously complete complex software development tasks.

You have access to tools to:
- Read and write files (read, write, edit)
- Run shell commands (bash) — including npm/pnpm, git, curl, etc.
- Search files (glob, grep)

## Tool Usage Guidelines
- Before using a tool, verify the operation is necessary and safe
- Use read-only tools (glob, grep, read) when exploring before making changes
- Prefer incremental verification: make changes, then test immediately
- When a tool fails, analyze the error message to understand the root cause
- Do not repeat the same operation expecting different results without analyzing why it failed
- If stuck in a loop (same tool + same input repeatedly), stop and reassess the approach

## Quality Standards
- Write self-documenting code with clear, descriptive naming
- Keep functions small and focused (single responsibility)
- Add comments only when the WHY is non-obvious
- Verify each step works before proceeding to the next
- When deploying, prefer local dev server (e.g., npm run dev) unless specifically asked for production deploy

## Error Handling
- Tool failure ≠ task failure. Diagnose the error, fix the root cause, then retry
- Common errors: wrong path (file doesn't exist), syntax error, dependency missing, permission denied
- If a command fails with "not found", check if the tool/package is installed first
- If repeatedly failing at the same step, consider a different approach

## Completion
- Report clearly when the task is complete with a summary of changes made
- If the task cannot be completed, explain what was tried and why it failed
- Suggest next steps when appropriate`

// ---- Stop Reason Types ----

export type StopReason =
  | 'completed'              // Task completed normally
  | 'end_turn'               // LLM ended turn without tool calls
  | 'max_turns'              // Reached max_turns limit
  | 'max_iterations'         // Reached max_iterations limit
  | 'doom_loop_detected'     // Exact same tool+input repeated N times
  | 'consecutive_tool_only'  // Too many consecutive tool-only turns
  | 'token_budget_exceeded'  // Token budget would exceed limit
  | 'tool_execution_error'   // Tool execution failed
  | 'api_error'              // API returned error
  | 'stopped_by_hook'        // Stopped by agent hook

export interface StopDetail {
  reason: StopReason
  maxTurns?: number
  actualTurns?: number
  maxIterations?: number
  actualIterations?: number
  doomFingerprint?: string
  toolName?: string
  lastError?: string
  totalTokens?: number
}

export interface AgentConfig {
  baseUrl: string
  apiKey: string
  model: string
}

export interface AgentStreamEvent {
  type: 'text' | 'tool_start' | 'tool_result' | 'compaction' | 'done' | 'error' | 'retry'
  content?: string
  toolName?: string
  toolId?: string
  toolInput?: any
  toolOutput?: string
  success?: boolean
  iterations?: number
  totalTokens?: number
  error?: string
  stopReason?: StopReason
  stopDetail?: StopDetail
}

export interface AgentResult {
  content: string
  iterations: number
  totalInputTokens: number
  totalOutputTokens: number
  toolsUsed: number
  success: boolean
  stopReason: StopReason
  stopDetail?: StopDetail
  error?: string
}

// Retryable HTTP status codes (transient server-side errors)
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 529])
const MAX_RETRIES = 5

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Format error from API response for display. Handles multiple provider formats:
 * - OpenAI:        { error: { message, type, code? } }
 * - Anthropic:    { type: "error", error: { type, message, request_id? } }
 * - MiniMax:       { type: "error", error: { type, message }, request_id }
 * - Generic:      { message } or plain text
 */
function formatAPIError(status: number, rawBody: string): { message: string; retryable: boolean; requestId?: string } {
  let body: any
  try {
    body = rawBody ? JSON.parse(rawBody) : {}
  } catch {
    return { message: rawBody || `HTTP ${status}`, retryable: RETRYABLE_STATUS.has(status), requestId: undefined }
  }

  const retryable = RETRYABLE_STATUS.has(status)
  const requestId = body.request_id || body.error?.request_id || undefined

  // OpenAI format: { error: { message, type?, code? } }
  if (body.error?.message) {
    const e = body.error
    const type = e.type || 'error'
    const code = e.code ? ` [${e.code}]` : ''
    return { message: `${type}${code}: ${e.message}`, retryable, requestId }
  }

  // Anthropic/MiniMax nested format: { type, error: { type, message }, request_id? }
  if (body.error?.type && body.error?.message) {
    const e = body.error
    const req = requestId ? ` (${requestId})` : ''
    return { message: `${e.type}${req}: ${e.message}`, retryable, requestId }
  }

  // Top-level { type, message }
  if (body.type && body.message) {
    const req = requestId ? ` (${requestId})` : ''
    return { message: `${body.type}${req}: ${body.message}`, retryable, requestId }
  }

  // Fallback: use raw body or status
  return {
    message: body.message || rawBody || `HTTP ${status}`,
    retryable,
    requestId,
  }
}

/**
 * Make a single LLM API call. Returns { data, headers } on success, throws on non-retryable error.
 * Does NOT handle retry logic — caller handles that via the AsyncGenerator yield.
 *
 * The error object may include:
 * - retryable: boolean indicating if the request can be retried
 * - retryAfterMs: number | undefined - server-suggested wait time
 * - status: HTTP status code
 * - rawError: original error object
 */
async function callLLM(
  messages: Message[],
  cfg: AgentConfig,
  maxTokens = 4096,
): Promise<{ data: any; headers?: Headers }> {
  const baseUrl = cfg.baseUrl.replace(/\/v1$/, '')
  const body = JSON.stringify({
    model: cfg.model,
    max_tokens: maxTokens,
    system: SYSTEM_PROMPT,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    tools: TOOL_DEFINITIONS,
    tool_choice: { type: 'auto' },
  })

  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cfg.apiKey}`,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body,
  })

  if (response.ok) {
    const data: any = await response.json()
    if (data && data.error) {
      const errorText = JSON.stringify(data)
      const { message, retryable } = formatAPIError(response.status, errorText)
      const err = new Error(message)
      ;(err as any).retryable = retryable
      ;(err as any).rawError = data
      ;(err as any).status = response.status
      ;(err as any).headers = response.headers
      throw err
    }
    return { data, headers: response.headers }
  }

  const errorText = await response.text()
  const { message, retryable } = formatAPIError(response.status, errorText)
  const err = new Error(`HTTP ${response.status}: ${message}`)
  ;(err as any).status = response.status
  ;(err as any).retryable = retryable
  ;(err as any).rawError = message
  ;(err as any).headers = response.headers
  throw err
}

/**
 * Parse retry-after information from response headers.
 * Supports:
 * - retry-after-ms: direct milliseconds to wait (OpenAI/MiniMax style)
 * - retry-after: seconds (standard HTTP header, also handles "Thu, 01 Jan 2025..." format)
 */
function parseRetryAfter(headers: Headers | undefined): number | undefined {
  if (!headers) return undefined

  // Try retry-after-ms first (OpenAI/MiniMax custom header)
  const retryAfterMs = headers.get('retry-after-ms')
  if (retryAfterMs) {
    const ms = parseInt(retryAfterMs, 10)
    if (!isNaN(ms) && ms > 0) return ms
  }

  // Try standard retry-after header (seconds or HTTP date)
  const retryAfter = headers.get('retry-after')
  if (retryAfter) {
    // Try parsing as seconds first
    const seconds = parseInt(retryAfter, 10)
    if (!isNaN(seconds) && seconds > 0) return seconds * 1000

    // Try parsing as HTTP date
    const date = new Date(retryAfter)
    if (!isNaN(date.getTime())) {
      const msUntilRetry = date.getTime() - Date.now()
      if (msUntilRetry > 0) return msUntilRetry
    }
  }

  return undefined
}

/**
 * Calculate exponential backoff delay, respecting server suggestion.
 * Falls back to exponential backoff if no server suggestion.
 */
function calculateRetryDelay(attempt: number, serverSuggestedMs?: number): number {
  if (serverSuggestedMs !== undefined && serverSuggestedMs > 0) {
    // Cap server suggestion at 30 seconds to avoid extremely long waits
    return Math.min(serverSuggestedMs, 30000)
  }

  // Exponential backoff: 1s, 2s, 4s, 8s, 16s
  return Math.min(1000 * Math.pow(2, attempt), 16000)
}

/**
 * Run the agent loop and return events via AsyncGenerator (for SSE streaming).
 * Each iteration yields events that describe what the agent is doing.
 *
 * @param task         - The new user message / task to process
 * @param cfg          - Agent config (baseUrl, apiKey, model)
 * @param maxIterations - Max loop iterations (default 30)
 * @param initialMessages - Existing conversation history (for continuing a chat session)
 * @param maxTurns     - Optional max turns (for stop_reason reporting)
 */
export async function* runAgentLoopStream(
  task: string,
  cfg: AgentConfig,
  maxIterations = 30,
  initialMessages?: Message[],
  maxTurns?: number,
  sessionId?: string,
): AsyncGenerator<AgentStreamEvent> {
  // Start with existing history if provided, otherwise start fresh
  const messages: Message[] = initialMessages
    ? [...initialMessages, { role: 'user' as const, content: task }]
    : [{ role: 'user' as const, content: task }]

  let iterations = 0
  let totalInputTokens = 0
  let totalOutputTokens = 0
  let consecutiveToolOnlyTurns = 0   // Hard cap counter (safety net)
  let toolsUsed = 0

  // Get hooks registry once at the start
  const hooks = getHooksRegistry()

  while (iterations < maxIterations) {
    iterations++

    // ---- Execute onIterationStart hooks ----
    await hooks.executeIterationStart({
      sessionId,
      task,
      iteration: iterations,
      messages,
    })

    // ---- Call LLM (with retry loop — yields retry events immediately after failure) ----
    let data: any
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        data = await callLLM(messages, cfg)
        // Success — done with LLM calls
        break
      } catch (e: any) {
        if (attempt === MAX_RETRIES) {
          // Exhausted all retries
          yield {
            type: 'error',
            error: `LLM API failed after ${MAX_RETRIES} retries: ${e.message}`,
            iterations,
            stopReason: 'api_error',
            stopDetail: { reason: 'api_error', lastError: e.message },
          }

          // ---- Execute onError hooks ----
          await hooks.executeError({
            sessionId,
            task,
            iterations,
            messages,
            error: e.message,
            iteration: iterations,
            fatal: true,
          })

          // ---- Execute onTaskComplete hooks ----
          await hooks.executeTaskComplete({
            sessionId,
            task,
            iterations,
            messages,
            result: 'failed',
            stopReason: 'api_error',
            error: e.message,
          })

          return
        }

        if (e.retryable) {
          // Parse retry-after from headers
          const retryAfterMs = parseRetryAfter(e.headers)
          const delay = calculateRetryDelay(attempt, retryAfterMs)
          const source = retryAfterMs ? 'server' : 'exponential'
          yield {
            type: 'retry',
            content: `Retry ${attempt + 1}/${MAX_RETRIES} (${source}) — ${e.message} — waiting ${delay}ms...`,
          }
          await sleep(delay)
          // Continue to next retry
        } else {
          // Non-retryable error — abort immediately
          yield {
            type: 'error',
            error: e.message,
            iterations,
            stopReason: 'api_error',
            stopDetail: { reason: 'api_error', lastError: e.message },
          }
          return
        }
      }
    }

    // ---- Track token usage ----
    totalInputTokens += data.usage?.input_tokens ?? 0
    totalOutputTokens += data.usage?.output_tokens ?? 0
    const totalTokens = totalInputTokens + totalOutputTokens

    // ---- Parse response blocks ----
    const blocks: any[] = data.content ?? []
    const textBlocks = blocks.filter((b: any) => b.type === 'text')
    const toolUseBlocks = blocks.filter((b: any) => b.type === 'tool_use')

    // Yield any text content
    for (const block of textBlocks) {
      if (block.text?.trim()) {
        yield { type: 'text', content: block.text }
      }
    }

    // ---- Check stop reason ----
    // Note: stop_reason === 'tool_use' is unreliable — it's not always set correctly.
    // We use our own logic based on whether tool_use blocks exist.
    const stopReason: string = data.stop_reason ?? 'end_turn'

    if (stopReason === 'end_turn' || toolUseBlocks.length === 0) {
      // Task complete
      const finalText = textBlocks.map((b: any) => b.text).join('\n').trim()
      const actualMaxTurns = maxTurns ?? maxIterations
      yield {
        type: 'done',
        content: finalText,
        iterations,
        totalTokens,
        success: true,
        stopReason: 'completed',
        stopDetail: {
          reason: 'completed',
          actualTurns: iterations,
          maxTurns: actualMaxTurns,
        },
      }

      // ---- Execute onTaskComplete hooks ----
      await hooks.executeTaskComplete({
        sessionId,
        task,
        iterations,
        messages,
        result: 'success',
        stopReason: 'completed',
        output: finalText,
      })
      return
    }

    // ---- Doom loop detection (OpenCode-style exact match) ----
    // Check last DOOM_LOOP_THRESHOLD messages for exact same tool+input
    const doomResult = detectDoomLoop(messages, DOOM_LOOP_THRESHOLD)

    if (doomResult.isDoomLoop) {
      yield {
        type: 'error',
        error: `Doom loop detected: ${doomResult.toolName} called with identical input ${DOOM_LOOP_THRESHOLD} times. Aborting.`,
        iterations,
        stopReason: 'doom_loop_detected',
        stopDetail: {
          reason: 'doom_loop_detected',
          doomFingerprint: doomResult.fingerprint,
          toolName: doomResult.toolName,
          actualIterations: iterations,
        },
      }
      return
    }

    // Safety net: hard cap on consecutive tool-only turns
    const messageHasSubstantialText = hasSubstantialText(
      blocks.some((b: any) => b.type === 'text') ? blocks : null,
    )
    if (messageHasSubstantialText) {
      consecutiveToolOnlyTurns = 0
    } else {
      consecutiveToolOnlyTurns++
    }

    if (consecutiveToolOnlyTurns >= DOOM_LOOP_MAX_TOOL_ONLY_TURNS) {
      yield {
        type: 'error',
        error: `Doom loop: ${DOOM_LOOP_MAX_TOOL_ONLY_TURNS} consecutive tool-only iterations without substantial progress.`,
        iterations,
        stopReason: 'consecutive_tool_only',
        stopDetail: {
          reason: 'consecutive_tool_only',
          actualIterations: consecutiveToolOnlyTurns,
          maxIterations: DOOM_LOOP_MAX_TOOL_ONLY_TURNS,
        },
      }
      return
    }

    // ---- Append full assistant message (text + tool_use) ----
    // IMPORTANT: preserve ALL content blocks (text + tool_use), not just tool_use.
    // Sending only tool_use blocks causes API validation errors.
    messages.push({ role: 'assistant', content: blocks })

    // ---- Execute onTurnEnd hooks ----
    const textBlock = blocks.find((b: any) => b.type === 'text')
    const turnEndResult = await hooks.executeTurnEnd({
      sessionId,
      task,
      iterations,
      messages,
      turnNumber: iterations,
      stopReason: stopReason || undefined,
      toolCalls: toolUseBlocks.map((b: any) => ({
        name: b.name,
        input: b.input,
      })),
      text: textBlock?.text,
    })

    // If hook indicates we should stop, respect that
    if (turnEndResult && typeof turnEndResult === 'object' && turnEndResult.stop) {
      yield {
        type: 'done',
        content: turnEndResult.message || 'Stopped by hook',
        iterations,
        stopReason: (turnEndResult.stopReason || 'stopped_by_hook') as StopReason,
      }
      // Execute task complete hooks
      await hooks.executeTaskComplete({
        sessionId,
        task,
        iterations,
        messages,
        result: 'stopped',
        stopReason: turnEndResult.stopReason || 'stopped_by_hook',
      })
      return
    }

    // ---- Execute tool calls concurrently ----
    const toolCalls = toolUseBlocks.map((b: any) => ({
      id: b.id,
      name: b.name,
      input: b.input ?? {},
    }))

    // Yield tool start events
    for (const tc of toolCalls) {
      yield { type: 'tool_start', toolName: tc.name, toolId: tc.id, toolInput: tc.input }
      console.log(`[Agent] Tool: ${tc.name} ${JSON.stringify(tc.input).slice(0, 100)}`)
    }

    const results = await executeToolCallsConcurrently(toolCalls)
    toolsUsed += results.length

    // Check for tool execution errors
    const hasErrors = results.some(r => !r.result.success)

    // Build tool_result user message
    const toolResultContent = results.map(r => ({
      type: 'tool_result' as const,
      tool_use_id: r.id,
      content: r.result.output,
      is_error: !r.result.success,
    }))

    messages.push({ role: 'user', content: toolResultContent })

    // Yield tool result events
    for (const r of results) {
      yield {
        type: 'tool_result',
        toolName: r.name,
        toolId: r.id,
        toolOutput: r.result.output.slice(0, 500), // truncate for event
        success: r.result.success,
      }
    }

    // If all tools failed, yield error but DON'T abort — let LLM see the failure
    // and decide what to do next (retry, try different approach, give up, etc.)
    if (hasErrors && results.length > 0) {
      yield {
        type: 'error',
        error: `Tool execution failed: ${results.filter(r => !r.result.success).map(r => r.name).join(', ')}`,
        iterations,
        stopReason: 'tool_execution_error',
        stopDetail: {
          reason: 'tool_execution_error',
          lastError: results.find(r => !r.result.success)?.result.output,
          actualIterations: iterations,
        },
      }
      // Don't return — continue the loop so LLM can handle the failure
    }

    // ---- Reactive Session compaction ----
    // Check compaction state including mid-turn warning
    const compactionState = checkCompactionState(totalTokens)

    // Emit warning if approaching limit but not yet at limit
    if (compactionState.warningIssued && !compactionState.shouldCompactNow) {
      yield {
        type: 'compaction',
        content: compactionState.reason || `Token budget warning (${totalTokens} tokens used)...`,
        totalTokens,
      }
    }

    if (shouldCompact(totalTokens)) {
      yield {
        type: 'compaction',
        content: `Compacting session (${totalTokens} tokens used)...`,
        totalTokens,
        stopReason: 'token_budget_exceeded',
        stopDetail: {
          reason: 'token_budget_exceeded',
        },
      }
      const compacted = await compactMessages(messages, cfg)
      messages.length = 0
      messages.push(...compacted)
      totalInputTokens = 0
      totalOutputTokens = 0
      consecutiveToolOnlyTurns = 0
    }

    // ---- Save checkpoint for session recovery ----
    saveCheckpoint(
      sessionId ?? `task_${Date.now()}`,
      task,
      messages,
      iterations,
      totalInputTokens,
      totalOutputTokens,
      consecutiveToolOnlyTurns,
    )

    // ---- Execute onIterationEnd hooks ----
    await hooks.executeIterationEnd({
      sessionId,
      task,
      iterations,
      messages,
      iteration: iterations,
      hasErrors,
    })
  }

  // Max iterations reached
  yield {
    type: 'error',
    error: `Max iterations (${maxIterations}) reached without completing the task.`,
    iterations,
    stopReason: 'max_iterations',
    stopDetail: {
      reason: 'max_iterations',
      actualIterations: iterations,
      maxIterations,
    },
  }

  // ---- Execute onTaskComplete hooks ----
  await hooks.executeTaskComplete({
    sessionId,
    task,
    iterations,
    messages,
    result: 'failed',
    stopReason: 'max_iterations',
  })
}

/**
 * Non-streaming version: runs the loop and collects all events into a result.
 * Suitable for simple API endpoints that don't need real-time streaming.
 */
export async function runAgentLoop(
  task: string,
  cfg: AgentConfig,
  maxIterations = 30,
  initialMessages?: Message[],
  maxTurns?: number,
  sessionId?: string,
): Promise<AgentResult> {
  const textParts: string[] = []
  let lastEvent: AgentStreamEvent | null = null

  for await (const event of runAgentLoopStream(task, cfg, maxIterations, initialMessages, maxTurns, sessionId)) {
    lastEvent = event
    if (event.type === 'text' && event.content) {
      textParts.push(event.content)
    }
    if (event.type === 'tool_start') {
      console.log(`[Agent] → ${event.toolName}: ${JSON.stringify(event.toolInput).slice(0, 80)}`)
    }
    if (event.type === 'tool_result') {
      const status = event.success ? '✓' : '✗'
      console.log(`[Agent] ${status} ${event.toolName}: ${(event.toolOutput ?? '').slice(0, 100)}`)
    }
    if (event.type === 'compaction') {
      console.log('[Agent] Compacting session...')
    }
    if (event.type === 'done' || event.type === 'error') break
  }

  const isDone = lastEvent?.type === 'done'
  return {
    content: lastEvent?.content ?? textParts.join('\n'),
    iterations: lastEvent?.iterations ?? 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    toolsUsed: 0,
    success: isDone,
    stopReason: lastEvent?.stopReason ?? (isDone ? 'completed' : 'max_iterations'),
    stopDetail: lastEvent?.stopDetail,
    error: isDone ? undefined : lastEvent?.error,
  }
}