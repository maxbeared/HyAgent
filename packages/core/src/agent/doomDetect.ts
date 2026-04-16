/**
 * Exact Doom Loop Detection
 *
 * Inspired by OpenCode's processor.ts (DOOM_LOOP_THRESHOLD=3):
 * Detects when the agent is stuck in an exact loop — same tool, same input,
 * repeated N times consecutively without producing substantial text output.
 *
 * This is MORE PRECISE than the old "set of tools" fingerprint approach,
 * which could falsely flag different tool calls with the same names.
 */

export interface DoomDetectResult {
  isDoomLoop: boolean
  fingerprint?: string  // For logging/debugging: "toolName:inputHash"
  toolName?: string
  input?: unknown
  consecutiveCount?: number
}

/**
 * Check if the recent messages indicate a doom loop.
 *
 * Algorithm (from OpenCode):
 * 1. Look at the last N (=threshold) consecutive assistant messages
 * 2. ALL must be tool_use type (no text, no reasoning)
 * 3. ALL must be the SAME tool (tool name identical)
 * 4. ALL must have the SAME input (JSON.stringify(input) identical)
 * → If all conditions met, it's a doom loop
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

  // Take the last `threshold` messages
  const candidates = recentMessages.slice(-threshold)

  // All must be assistant messages
  if (!candidates.every(m => m.role === 'assistant')) {
    return { isDoomLoop: false }
  }

  // Extract tool_use blocks from each message
  const toolParts = candidates.map(m => {
    if (Array.isArray(m.content)) {
      return m.content.filter((b: any) => b.type === 'tool_use')
    }
    return []
  })

  // Each message must have exactly 1 tool_use block
  if (!toolParts.every(parts => parts.length === 1)) {
    return { isDoomLoop: false }
  }

  // All must be the same tool name
  const firstTool = toolParts[0][0]
  const allSameTool = toolParts.every(
    parts => parts[0].name === firstTool.name,
  )
  if (!allSameTool) {
    return { isDoomLoop: false }
  }

  // All must have identical input
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
  }
}

/**
 * Check if a message has "substantial" text content.
 * Used alongside doom loop detection to reset the consecutive counter.
 *
 * @returns true if message has > 30 chars of non-empty text
 */
export function hasSubstantialText(content: any): boolean {
  if (typeof content === 'string') {
    return content.trim().length > 30
  }
  if (Array.isArray(content)) {
    return content.some((b: any) => {
      if (b.type === 'text' && b.text) {
        return b.text.trim().length > 30
      }
      return false
    })
  }
  return false
}