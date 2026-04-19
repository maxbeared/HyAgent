/**
 * Session compaction
 * When message history grows too large, compress it into a summary
 * to prevent hitting the context window limit.
 *
 * Features:
 * - Basic compaction at token threshold
 * - Selective pruning (protect recent tool results)
 * - Protected tools list
 * - Reactive mid-turn compaction warnings
 * - Token usage tracking
 */

export interface Message {
  role: 'user' | 'assistant'
  content: any
  // OpenCode-style metadata
  time?: {
    created?: number
    compacted?: boolean
  }
}

interface CompactionConfig {
  baseUrl: string
  apiKey: string
  model: string
}

// Token budget threshold before triggering compaction (~80k tokens)
export const COMPACTION_TOKEN_THRESHOLD = 80_000

// Warning threshold - emit warning at this percentage of budget (~70%)
export const COMPACTION_WARNING_THRESHOLD = 0.7

// Protect recent tool results within this token window (from OpenCode)
export const PRUNE_PROTECT_TOKENS = 40_000

// Tools whose outputs should never be pruned
export const PRUNE_PROTECTED_TOOLS = ['skill', 'read', 'glob', 'grep']

// Minimum messages to keep even if they exceed token budget
export const MIN_RECENT_MESSAGES = 5

export interface CompactionState {
  totalTokens: number
  inputTokens: number
  outputTokens: number
  warningIssued: boolean
  shouldCompactNow: boolean
  reason?: string
}

/**
 * Check compaction state based on current token usage
 */
export function checkCompactionState(
  totalTokens: number,
  warningThreshold = COMPACTION_WARNING_THRESHOLD
): CompactionState {
  const ratio = totalTokens / COMPACTION_TOKEN_THRESHOLD

  if (ratio >= 1.0) {
    return {
      totalTokens,
      inputTokens: 0,
      outputTokens: 0,
      warningIssued: ratio >= 1.0,
      shouldCompactNow: true,
      reason: `Token budget exceeded (${Math.round(ratio * 100)}%)`,
    }
  }

  if (ratio >= warningThreshold) {
    return {
      totalTokens,
      inputTokens: 0,
      outputTokens: 0,
      warningIssued: true,
      shouldCompactNow: false,
      reason: `Token budget warning (${Math.round(ratio * 100)}% of threshold)`,
    }
  }

  return {
    totalTokens,
    inputTokens: 0,
    outputTokens: 0,
    warningIssued: false,
    shouldCompactNow: false,
  }
}

export function shouldCompact(totalTokens: number): boolean {
  return totalTokens >= COMPACTION_TOKEN_THRESHOLD
}

/**
 * Calculate if we need reactive compaction mid-turn
 */
export function shouldCompactMidTurn(
  currentTokens: number,
  estimatedResponseTokens: number,
  bufferTokens = 2000
): boolean {
  return currentTokens + estimatedResponseTokens + bufferTokens >= COMPACTION_TOKEN_THRESHOLD
}

/**
 * Get compaction recommendation with urgency level
 */
export function getCompactionUrgency(
  totalTokens: number
): 'none' | 'low' | 'medium' | 'high' | 'critical' {
  const ratio = totalTokens / COMPACTION_TOKEN_THRESHOLD

  if (ratio < 0.5) return 'none'
  if (ratio < 0.7) return 'low'
  if (ratio < 0.85) return 'medium'
  if (ratio < 1.0) return 'high'
  return 'critical'
}

/**
 * Check if a message should be protected from compaction
 */
function isProtectedMessage(message: Message): boolean {
  // Protect recent messages within token budget
  return true // We'll handle this in the main compaction logic
}

/**
 * Check if a message is from a protected tool
 */
function isProtectedToolMessage(message: Message): boolean {
  if (message.role !== 'assistant') return false
  if (typeof message.content !== 'object' || !Array.isArray(message.content)) return false

  for (const block of message.content) {
    if (block.type === 'tool_use') {
      return PRUNE_PROTECTED_TOOLS.includes(block.name)
    }
  }
  return false
}

function formatMessagesForSummary(messages: Message[]): string {
  return messages
    .map(m => {
      const role = m.role.toUpperCase()
      let content: string

      if (typeof m.content === 'string') {
        content = m.content
      } else if (Array.isArray(m.content)) {
        content = m.content
            .filter((b: any) => b.type === 'text')
            .map((b: any) => b.text)
            .join('\n')
      } else {
        content = JSON.stringify(m.content)
      }

      // Mark if this was compacted
      const compacted = m.time?.compacted ? '[COMPACTED] ' : ''
      return `[${role}]: ${compacted}${content}`
    })
    .join('\n\n')
}

/**
 * Estimate token count for a message (rough approximation)
 */
function estimateMessageTokens(message: Message): number {
  const str = JSON.stringify(message)
  return Math.ceil(str.length / 4)
}

/**
 * Compact a message history with selective pruning.
 *
 * Keeps:
 * 1. Summary of older messages
 * 2. Recent tool results within PRUNE_PROTECT_TOKENS
 * 3. Protected tool outputs (skill, read, glob, grep)
 * 4. Last MIN_RECENT_MESSAGES messages
 */
export async function compactMessages(
  messages: Message[],
  cfg: CompactionConfig,
): Promise<Message[]> {
  if (messages.length <= MIN_RECENT_MESSAGES) return messages

  // Classify messages into protected and non-protected
  const protectedMessages: Message[] = []
  const toSummarize: Message[] = []
  let runningTokenCount = 0

  // Process from newest to oldest
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    const tokens = estimateMessageTokens(msg)

    // Always keep recent messages
    if (i >= messages.length - MIN_RECENT_MESSAGES) {
      protectedMessages.unshift(msg)
      runningTokenCount += tokens
      continue
    }

    // Keep protected tool outputs
    if (isProtectedToolMessage(msg)) {
      protectedMessages.unshift(msg)
      runningTokenCount += tokens
      continue
    }

    // Keep recent tool results within token budget
    if (runningTokenCount < PRUNE_PROTECT_TOKENS) {
      protectedMessages.unshift(msg)
      runningTokenCount += tokens
      continue
    }

    // Mark older messages for summarization
    toSummarize.unshift({
      ...msg,
      time: { ...msg.time, compacted: true },
    })
  }

  // If we have few messages to summarize, just keep them all
  if (toSummarize.length === 0) {
    return messages
  }

  // If protected messages are already too many, skip compaction
  if (protectedMessages.length >= messages.length - 2) {
    return messages
  }

  const formatted = formatMessagesForSummary(toSummarize)
  const baseUrl = cfg.baseUrl.replace(/\/v1$/, '')

  try {
    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.apiKey}`,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: 2048,
        messages: [
          {
            role: 'user',
            content: `Please provide a concise summary of this conversation that captures:
1. The main task or goal
2. What has been accomplished so far
3. Key files created or modified
4. Current state and next steps

Conversation to summarize:
${formatted}

Provide a clear, structured summary that will allow the conversation to continue effectively.`,
          },
        ],
      }),
    })

    if (!response.ok) {
      console.error('[Compaction] Failed to generate summary, keeping original messages')
      return messages
    }

    const data = await response.json() as any
    const summaryText = data.content?.find((b: any) => b.type === 'text')?.text ?? 'Conversation history compacted.'

    const summaryMessage: Message = {
      role: 'user',
      content: `[CONTEXT SUMMARY - Previous conversation compacted]\n\n${summaryText}\n\n[END OF SUMMARY - ${toSummarize.length} messages compacted - recent tool results preserved]`,
      time: { created: Date.now() },
    }

    console.log(`[Compaction] Reduced ${messages.length} messages: ${toSummarize.length} summarized, ${protectedMessages.length} preserved`)
    return [summaryMessage, ...protectedMessages]
  } catch (e: any) {
    console.error('[Compaction] Error:', e.message)
    return messages
  }
}
