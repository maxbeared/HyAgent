/**
 * Session compaction
 * When message history grows too large, compress it into a summary
 * to prevent hitting the context window limit.
 *
 * Inspired by both Claude Code's autoCompact and OpenCode's compaction logic.
 */

export interface Message {
  role: 'user' | 'assistant'
  content: any
}

interface CompactionConfig {
  baseUrl: string
  apiKey: string
  model: string
}

// Token budget threshold before triggering compaction (~80k tokens)
export const COMPACTION_TOKEN_THRESHOLD = 80_000

export function shouldCompact(totalTokens: number): boolean {
  return totalTokens >= COMPACTION_TOKEN_THRESHOLD
}

function formatMessagesForSummary(messages: Message[]): string {
  return messages
    .map(m => {
      const role = m.role.toUpperCase()
      const content = typeof m.content === 'string'
        ? m.content
        : Array.isArray(m.content)
          ? m.content
              .filter((b: any) => b.type === 'text')
              .map((b: any) => b.text)
              .join('\n')
          : JSON.stringify(m.content)
      return `[${role}]: ${content}`
    })
    .join('\n\n')
}

/**
 * Compact a message history by generating a summary via LLM,
 * then returning [summary_message, ...last_N_messages].
 *
 * Keeps the last 5 messages intact so the model has recent context.
 */
export async function compactMessages(
  messages: Message[],
  cfg: CompactionConfig,
): Promise<Message[]> {
  if (messages.length <= 5) return messages

  // Messages to summarize (everything except last 5)
  const toSummarize = messages.slice(0, -5)
  const recent = messages.slice(-5)

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
      content: `[CONTEXT SUMMARY - Previous conversation compacted]\n\n${summaryText}\n\n[END OF SUMMARY - Continuing conversation]`,
    }

    console.log(`[Compaction] Reduced ${messages.length} messages to 6 (summary + 5 recent)`)
    return [summaryMessage, ...recent]
  } catch (e: any) {
    console.error('[Compaction] Error:', e.message)
    return messages
  }
}
