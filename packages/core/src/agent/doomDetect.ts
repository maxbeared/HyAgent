/**
 * Enhanced Doom Loop Detection
 *
 * Inspired by OpenCode's processor.ts (DOOM_LOOP_THRESHOLD=3) and Claude Code:
 * - Exact loop: same tool, same input, repeated N times
 * - Pattern loop: similar tool calls with same pattern, no progress
 * - Output loop: tool results indicate repeated failure patterns
 *
 * This combines exact matching with additional heuristics to catch
 * more subtle forms of looping behavior.
 */

export interface DoomDetectResult {
  isDoomLoop: boolean
  fingerprint?: string  // For logging/debugging: "toolName:inputHash"
  toolName?: string
  input?: unknown
  consecutiveCount?: number
  type?: 'exact' | 'pattern' | 'output' | 'stalled'
  reason?: string
}

/**
 * Check if the recent messages indicate a doom loop.
 *
 * Algorithm:
 * 1. Exact loop (from OpenCode): same tool + same input repeated N times
 * 2. Pattern loop: similar tool calls (same tool name) with no output progress
 * 3. Output loop: tool results show repeated error patterns
 *
 * @param recentMessages - Last N messages from the conversation
 * @param threshold - Number of consecutive identical tool calls to flag (default 3)
 * @returns DoomDetectResult with isDoomLoop=true if detected
 */
export function detectDoomLoop(
  recentMessages: Array<{ role: string; content: any }>,
  threshold = 3,
): DoomDetectResult {
  if (recentMessages.length < threshold) {
    return { isDoomLoop: false }
  }

  // Check 1: Exact loop (OpenCode-style)
  const exactResult = detectExactLoop(recentMessages, threshold)
  if (exactResult.isDoomLoop) {
    return { ...exactResult, type: 'exact' }
  }

  // Check 2: Pattern loop - same tool, similar inputs, no progress
  const patternResult = detectPatternLoop(recentMessages, threshold)
  if (patternResult.isDoomLoop) {
    return { ...patternResult, type: 'pattern' }
  }

  // Check 3: Output-based loop - tool results show repeated failure
  const outputResult = detectOutputLoop(recentMessages, threshold)
  if (outputResult.isDoomLoop) {
    return { ...outputResult, type: 'output' }
  }

  return { isDoomLoop: false }
}

/**
 * Check 1: Exact loop detection (original OpenCode algorithm)
 */
function detectExactLoop(
  recentMessages: Array<{ role: string; content: any }>,
  threshold: number,
): DoomDetectResult {
  const candidates = recentMessages.slice(-threshold)

  if (!candidates.every(m => m.role === 'assistant')) {
    return { isDoomLoop: false }
  }

  const toolParts = candidates.map(m => {
    if (Array.isArray(m.content)) {
      return m.content.filter((b: any) => b.type === 'tool_use')
    }
    return []
  })

  if (!toolParts.every(parts => parts.length === 1)) {
    return { isDoomLoop: false }
  }

  const firstTool = toolParts[0][0]
  const allSameTool = toolParts.every(
    parts => parts[0].name === firstTool.name,
  )
  if (!allSameTool) {
    return { isDoomLoop: false }
  }

  const firstInput = firstTool.input ?? {}
  const allSameInput = toolParts.every(parts =>
    JSON.stringify(parts[0].input ?? {}) === JSON.stringify(firstInput),
  )
  if (!allSameInput) {
    return { isDoomLoop: false }
  }

  const fingerprint = `${firstTool.name}:${JSON.stringify(firstInput)}`
  return {
    isDoomLoop: true,
    fingerprint,
    toolName: firstTool.name,
    input: firstTool.input,
    consecutiveCount: threshold,
    reason: `Exact same tool+input repeated ${threshold} times`,
  }
}

/**
 * Check 2: Pattern loop - same tool name with similar inputs,
 * but inputs may have slight variations (e.g., different line numbers)
 */
function detectPatternLoop(
  recentMessages: Array<{ role: string; content: any }>,
  threshold: number,
): DoomDetectResult {
  const candidates = recentMessages.slice(-threshold)

  if (!candidates.every(m => m.role === 'assistant')) {
    return { isDoomLoop: false }
  }

  const toolParts = candidates.map(m => {
    if (Array.isArray(m.content)) {
      return m.content.filter((b: any) => b.type === 'tool_use')
    }
    return []
  })

  if (!toolParts.every(parts => parts.length === 1)) {
    return { isDoomLoop: false }
  }

  // All must be the same tool
  const firstTool = toolParts[0][0]
  const allSameTool = toolParts.every(
    parts => parts[0].name === firstTool.name,
  )
  if (!allSameTool) {
    return { isDoomLoop: false }
  }

  // For read/edit tools, inputs are "similar" if they differ only in offset/limit
  const toolName = firstTool.name
  if (!['read', 'edit'].includes(toolName)) {
    return { isDoomLoop: false }
  }

  // Check if inputs are similar (same path, different range params)
  const firstInput = firstTool.input ?? {}
  const allSimilar = toolParts.every(parts => {
    const input = parts[0].input ?? {}
    // Same path/file
    if (input.path !== firstInput.path && input.file !== firstInput.file) {
      return false
    }
    // Only difference is in offset/limit
    const keysA = Object.keys(input).sort()
    const keysB = Object.keys(firstInput).sort()
    if (JSON.stringify(keysA) !== JSON.stringify(keysB)) {
      return false
    }
    // Check all non-numeric values are identical
    for (const key of Object.keys(input)) {
      if (typeof input[key] !== 'number' && input[key] !== firstInput[key]) {
        return false
      }
    }
    return true
  })

  if (!allSimilar) {
    return { isDoomLoop: false }
  }

  return {
    isDoomLoop: true,
    toolName,
    input: firstInput,
    consecutiveCount: threshold,
    reason: `Same tool (${toolName}) with similar inputs repeated ${threshold} times - possible file scanning loop`,
  }
}

/**
 * Check 3: Output-based loop - detect if tool results are identical
 * (indicating no progress despite different attempts)
 */
function detectOutputLoop(
  recentMessages: Array<{ role: string; content: any }>,
  threshold: number,
): DoomDetectResult {
  // Look at tool_use blocks AND their corresponding results
  // This requires checking the user messages that contain tool results
  const candidates = recentMessages.slice(-threshold * 2)

  const toolResults: string[] = []
  for (const msg of candidates) {
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'tool_result') {
          // Normalize output for comparison
          const normalized = normalizeOutput(block.content)
          if (normalized) {
            toolResults.push(normalized)
          }
        }
      }
    }
  }

  // If we have enough results, check for repetition
  if (toolResults.length < threshold) {
    return { isDoomLoop: false }
  }

  // Check last N results
  const recentResults = toolResults.slice(-threshold)

  // All results must be identical
  const firstResult = recentResults[0]
  const allIdentical = recentResults.every(r => r === firstResult)

  if (!allIdentical) {
    return { isDoomLoop: false }
  }

  // Find the corresponding tool
  let toolName = 'unknown'
  for (let i = recentMessages.length - 1; i >= 0 && toolResults.length > 0; i--) {
    const msg = recentMessages[i]
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'tool_use') {
          toolName = block.name
          break
        }
      }
      if (toolName !== 'unknown') break
    }
  }

  return {
    isDoomLoop: true,
    toolName,
    consecutiveCount: threshold,
    reason: `Same tool output repeated ${threshold} times - no progress being made`,
  }
}

/**
 * Normalize tool output for comparison - remove timestamps,
 * dynamic values, and other non-deterministic content
 */
function normalizeOutput(content: string): string | null {
  if (!content || typeof content !== 'string') {
    return null
  }
  // Remove timestamps (e.g., "Run at 2024-01-01 12:00:00")
  let normalized = content.replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/g, '<TIMESTAMP>')
  // Remove UUIDs
  normalized = normalized.replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, '<UUID>')
  // Remove memory addresses
  normalized = normalized.replace(/0x[a-f0-9]+/gi, '<ADDR>')
  // Collapse whitespace
  normalized = normalized.replace(/\s+/g, ' ').trim()
  // Return null for very short outputs (likely "success" messages)
  if (normalized.length < 20) {
    return null
  }
  return normalized
}

/**
 * Check if a message has "substantial" text content.
 * Used alongside doom loop detection to reset the consecutive counter.
 * Lowered from 30 to 10 chars: even short meaningful phrases
 * like "好的", "继续", "明白了" should reset the counter.
 *
 * @returns true if message has > 10 chars of non-empty text
 */
export function hasSubstantialText(content: any): boolean {
  if (typeof content === 'string') {
    return content.trim().length > 10
  }
  if (Array.isArray(content)) {
    return content.some((b: any) => {
      if (b.type === 'text' && b.text) {
        return b.text.trim().length > 10
      }
      return false
    })
  }
  return false
}

/**
 * Track accumulated tool calls for progress detection.
 * Used to detect "stalled" loops where different tools are called
 * but no meaningful progress is being made.
 */
export interface ProgressTracker {
  toolCalls: Array<{ tool: string; input: string; timestamp: number; success: boolean }>
  totalOutputLength: number
}

export function createProgressTracker(): ProgressTracker {
  return {
    toolCalls: [],
    totalOutputLength: 0,
  }
}

export function trackToolCall(
  tracker: ProgressTracker,
  tool: string,
  input: unknown,
  success: boolean,
  outputLength = 0,
): void {
  tracker.toolCalls.push({
    tool,
    input: JSON.stringify(input),
    timestamp: Date.now(),
    success,
  })
  tracker.totalOutputLength += outputLength
}

/**
 * Check if progress is stalling - called many tools but output not growing.
 * This indicates the agent is doing work but not making forward progress.
 */
export function isProgressStalling(tracker: ProgressTracker, windowSize = 10): boolean {
  if (tracker.toolCalls.length < windowSize) {
    return false
  }

  const recent = tracker.toolCalls.slice(-windowSize)

  // All recent calls succeeded but no output growth
  const allSucceeded = recent.every(c => c.success)
  const outputGrowing = tracker.totalOutputLength > 0

  // If all tools succeeded but we're not producing more output,
  // we might be in a "working but going nowhere" loop
  if (allSucceeded && !outputGrowing) {
    // Check if we're repeatedly calling the same tool
    const toolCounts = new Map<string, number>()
    for (const call of recent) {
      toolCounts.set(call.tool, (toolCounts.get(call.tool) || 0) + 1)
    }
    // If any tool is called more than half the time, flag as potential stall
    for (const count of toolCounts.values()) {
      if (count > windowSize / 2) {
        return true
      }
    }
  }

  return false
}