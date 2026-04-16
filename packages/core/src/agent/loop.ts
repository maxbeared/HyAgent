/**
 * Agent core loop
 *
 * Implements the main agentic cycle:
 * 1. Call LLM with current message history + tools
 * 2. Parse response: text blocks + tool_use blocks
 * 3. If stop_reason == 'end_turn' → task complete
 * 4. If stop_reason == 'tool_use' → execute tools concurrently, append results, loop
 * 5. Doom loop detection: if tool-only iterations exceed threshold → abort
 * 6. Token budget tracking: trigger compaction before hitting context limit
 * 7. Max iterations guard
 *
 * Design inspired by:
 * - Claude Code: query.ts while(true) loop, StreamingToolExecutor
 * - OpenCode: doom loop detection (DOOM_LOOP_THRESHOLD=3), session compaction
 */

import { TOOL_DEFINITIONS, executeToolCallsConcurrently } from './tools.js'
import { compactMessages, shouldCompact, type Message } from './compaction.js'

// How many times a DUPLICATE tool call fingerprint must appear before we abort.
// Duplicate = same tool name + same key input args, appearing back-to-back.
const DOOM_LOOP_DUPLICATE_THRESHOLD = 2
// Hard cap: abort if we've been in tool-only mode for this many turns straight
// (guards against long chains of diverse-but-never-finishing tool calls).
const DOOM_LOOP_MAX_TOOL_ONLY_TURNS = 10
const SYSTEM_PROMPT = `You are a highly capable AI coding assistant that can autonomously complete complex software development tasks.

You have access to tools to:
- Read and write files (read, write, edit)
- Run shell commands (bash) — including npm/pnpm, git, curl, etc.
- Search files (glob, grep)

Guidelines:
- Plan your approach before diving in
- Use bash to install dependencies, run builds, start servers
- Create files incrementally, verifying each step works
- When deploying, prefer local dev server (e.g., npm run dev) unless specifically asked for production deploy
- Report clearly when the task is complete with a summary of what was done
- If a step fails, diagnose and fix before moving on`

export interface AgentConfig {
  baseUrl: string
  apiKey: string
  model: string
}

export interface AgentStreamEvent {
  type: 'text' | 'tool_start' | 'tool_result' | 'compaction' | 'done' | 'error'
  content?: string
  toolName?: string
  toolId?: string
  toolInput?: any
  toolOutput?: string
  success?: boolean
  iterations?: number
  totalTokens?: number
  error?: string
}

export interface AgentResult {
  content: string
  iterations: number
  totalInputTokens: number
  totalOutputTokens: number
  success: boolean
  error?: string
  stopReason?: string
}

// Retryable HTTP status codes (transient server-side errors)
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 529])
const MAX_RETRIES = 5

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function callLLM(
  messages: Message[],
  cfg: AgentConfig,
  maxTokens = 4096,
): Promise<any> {
  const baseUrl = cfg.baseUrl.replace(/\/v1$/, '')
  const body = JSON.stringify({
    model: cfg.model,
    max_tokens: maxTokens,
    system: SYSTEM_PROMPT,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    tools: TOOL_DEFINITIONS,
    tool_choice: { type: 'auto' },
  })

  let lastError: Error | null = null
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      // Exponential backoff: 1s, 2s, 4s, 8s, 16s
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 16000)
      console.log(`[Agent] Retrying LLM call (attempt ${attempt}/${MAX_RETRIES}) after ${delay}ms...`)
      await sleep(delay)
    }

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
      return response.json()
    }

    const errorText = await response.text()
    lastError = new Error(`LLM API error ${response.status}: ${errorText}`)

    if (!RETRYABLE_STATUS.has(response.status)) {
      // Non-retryable error (4xx auth errors, bad request, etc.)
      throw lastError
    }

    console.log(`[Agent] Transient error ${response.status}, will retry...`)
  }

  throw lastError ?? new Error('LLM call failed after max retries')
}

/**
 * Run the agent loop and return events via AsyncGenerator (for SSE streaming).
 * Each iteration yields events that describe what the agent is doing.
 *
 * @param task         - The new user message / task to process
 * @param cfg          - Agent config (baseUrl, apiKey, model)
 * @param maxIterations - Max loop iterations (default 30)
 * @param initialMessages - Existing conversation history (for continuing a chat session)
 */
export async function* runAgentLoopStream(
  task: string,
  cfg: AgentConfig,
  maxIterations = 30,
  initialMessages?: Message[],
): AsyncGenerator<AgentStreamEvent> {
  // Start with existing history if provided, otherwise start fresh
  const messages: Message[] = initialMessages
    ? [...initialMessages, { role: 'user' as const, content: task }]
    : [{ role: 'user' as const, content: task }]

  let iterations = 0
  let totalInputTokens = 0
  let totalOutputTokens = 0
  let consecutiveToolOnlyTurns = 0   // Hard cap counter
  let lastToolFingerprint = ''        // Fingerprint of last tool call set

  while (iterations < maxIterations) {
    iterations++

    // ---- Call LLM ----
    let data: any
    try {
      data = await callLLM(messages, cfg)
    } catch (e: any) {
      yield { type: 'error', error: e.message, iterations }
      return
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
    const stopReason: string = data.stop_reason ?? 'end_turn'

    if (stopReason === 'end_turn' || toolUseBlocks.length === 0) {
      // Task complete
      const finalText = textBlocks.map((b: any) => b.text).join('\n').trim()
      yield {
        type: 'done',
        content: finalText,
        iterations,
        totalTokens,
        success: true,
      }
      return
    }

    // ---- Doom loop detection ----
    // Strategy 1: detect duplicate tool call fingerprints (agent repeating itself)
    // Strategy 2: hard cap on consecutive tool-only turns (safety net)
    const fingerprint = toolUseBlocks
      .map((b: any) => `${b.name}:${JSON.stringify(b.input ?? {})}`)
      .sort()
      .join('|')

    const isDuplicate = fingerprint === lastToolFingerprint
    lastToolFingerprint = fingerprint

    const hasSubstantialText = textBlocks.some((b: any) => b.text?.trim().length > 30)
    if (hasSubstantialText) {
      consecutiveToolOnlyTurns = 0
    } else {
      consecutiveToolOnlyTurns++
    }

    if (isDuplicate) {
      yield {
        type: 'error',
        error: `Doom loop: agent is repeating the same tool calls (${fingerprint.slice(0, 100)}). Aborting.`,
        iterations,
      }
      return
    }

    if (consecutiveToolOnlyTurns >= DOOM_LOOP_MAX_TOOL_ONLY_TURNS) {
      yield {
        type: 'error',
        error: `Doom loop: ${DOOM_LOOP_MAX_TOOL_ONLY_TURNS} consecutive tool-only iterations without progress.`,
        iterations,
      }
      return
    }

    // ---- Append full assistant message (text + tool_use) ----
    // IMPORTANT: preserve ALL content blocks (text + tool_use), not just tool_use.
    // Sending only tool_use blocks causes API validation errors.
    messages.push({ role: 'assistant', content: blocks })

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

    // ---- Session compaction ----
    if (shouldCompact(totalTokens)) {
      yield { type: 'compaction', content: `Compacting session (${totalTokens} tokens used)...` }
      const compacted = await compactMessages(messages, cfg)
      messages.length = 0
      messages.push(...compacted)
      totalInputTokens = 0
      totalOutputTokens = 0
      consecutiveToolOnlyTurns = 0
      lastToolFingerprint = ''
    }
  }

  yield {
    type: 'error',
    error: `Max iterations (${maxIterations}) reached without completing the task.`,
    iterations,
  }
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
): Promise<AgentResult> {
  const textParts: string[] = []
  let lastEvent: AgentStreamEvent | null = null

  for await (const event of runAgentLoopStream(task, cfg, maxIterations, initialMessages)) {
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
    success: isDone,
    error: isDone ? undefined : lastEvent?.error,
  }
}
