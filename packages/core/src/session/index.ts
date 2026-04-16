/**
 * Session Service - 会话管理与压缩
 *
 * 功能:
 * - 会话创建、读取、更新、删除
 * - 消息管理
 * - 会话压缩 (Compaction) - 来自Claude Code的tokenBudget概念
 *
 * 参考来源:
 * - opencode/packages/opencode/src/server/session/
 * - Anthropic-Leaked-Source-Code/query/tokenBudget.ts
 */

import { Effect, Layer, Ref, Context } from 'effect'
import type { Session, Message, MessagePart, CompactionConfig, CompactionResult } from './types.js'
import { shouldCompact } from './types.js'

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate unique ID
 */
function generateId(prefix: string): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return `${prefix}_${Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}`
}

/**
 * Estimate token count for a message (very rough approximation)
 */
function estimateTokens(message: Message): number {
  return message.parts.reduce((sum, part) => {
    const str = JSON.stringify(part)
    return sum + Math.ceil(str.length / 4)
  }, 0)
}

/**
 * Estimate token count for all messages
 */
function estimateTotalTokens(messages: Message[]): number {
  return messages.reduce((sum, msg) => sum + estimateTokens(msg), 0)
}

/**
 * Generate summary for messages using LLM
 * Placeholder - in real implementation, call LLM API
 */
async function generateSummary(messages: Message[]): Promise<string> {
  // In a real implementation, this would call the LLM to generate a summary
  // For now, return a placeholder
  const lastMessages = messages.slice(-10)
  const preview = lastMessages
    .map((m) => `[${m.role}]: ${m.parts.filter((p) => p.type === 'text').map((p) => (p as { type: 'text'; content: string }).content).join('')}`)
    .join('\n')

  return `[Summary of ${messages.length} messages]\n\nRecent conversation:\n${preview.slice(0, 500)}...`
}

// ============================================================================
// Session Store (in-memory implementation)
// ============================================================================

interface SessionStore {
  sessions: Map<string, Session>
  messageCounters: Map<string, number>
}

/**
 * Create in-memory session store
 */
function createSessionStore(): SessionStore {
  return {
    sessions: new Map(),
    messageCounters: new Map(),
  }
}

// ============================================================================
// Session Service Implementation
// ============================================================================

/**
 * Create Session Service layer
 */
export const SessionServiceLayer = Layer.effect(
  SessionServiceTag,
  Effect.gen(function* () {
    const store = yield* Ref.make<SessionStore>(createSessionStore())

    return SessionService.of({
      create(options) {
        return Effect.gen(function* () {
          const sessionID = generateId('session')
          const now = Date.now()

          const session: Session = {
            id: sessionID,
            messages: [],
            model: options?.model,
            provider: options?.provider,
            createdAt: now,
            updatedAt: now,
            metadata: options?.metadata,
          }

          yield* Ref.update(store, (s) => {
            s.sessions.set(sessionID, session)
            s.messageCounters.set(sessionID, 0)
            return s
          })

          return session
        })
      },

      get(sessionID) {
        return Effect.gen(function* () {
          const s = yield* Ref.get(store)
          return s.sessions.get(sessionID)
        })
      },

      addMessage(sessionID, messageInput) {
        return Effect.gen(function* () {
          const s = yield* Ref.get(store)
          const session = s.sessions.get(sessionID)

          if (!session) {
            return yield* Effect.fail(new Error(`Session not found: ${sessionID}`))
          }

          const counter = s.messageCounters.get(sessionID) ?? 0
          const message: Message = {
            ...messageInput,
            id: generateId(`msg_${counter}`),
            timestamp: Date.now(),
          }

          // Update session
          yield* Ref.update(store, (s) => {
            const session = s.sessions.get(sessionID)!
            session.messages.push(message)
            session.updatedAt = Date.now()
            s.messageCounters.set(sessionID, counter + 1)
            return s
          })

          return message
        })
      },

      getMessages(sessionID) {
        return Effect.gen(function* () {
          const s = yield* Ref.get(store)
          const session = s.sessions.get(sessionID)
          return session?.messages ?? []
        })
      },

      updateMetadata(sessionID, metadata) {
        return Effect.gen(function* () {
          yield* Ref.update(store, (s) => {
            const session = s.sessions.get(sessionID)
            if (session) {
              session.metadata = { ...session.metadata, ...metadata }
              session.updatedAt = Date.now()
            }
            return s
          })
        })
      },

      delete(sessionID) {
        return Effect.gen(function* () {
          yield* Ref.update(store, (s) => {
            s.sessions.delete(sessionID)
            s.messageCounters.delete(sessionID)
            return s
          })
        })
      },

      compact(sessionID, config) {
        return Effect.gen(function* () {
          const s = yield* Ref.get(store)
          const session = s.sessions.get(sessionID)

          if (!session) {
            return yield* Effect.fail(new Error(`Session not found: ${sessionID}`))
          }

          const messages = session.messages
          const { shouldCompact: needs } = shouldCompact(messages, config)

          if (!needs.shouldCompact) {
            return {
              summary: 'No compaction needed',
              originalMessageCount: messages.length,
              compactedMessageCount: messages.length,
              tokensSaved: 0,
            }
          }

          // Generate summary
          const summary = yield* Effect.promise(() => generateSummary(messages))

          // Compact: keep summary + recent messages
          const recentMessages = messages.slice(-config.minTurnsBetweenCompaction)
          const summaryMessage: Message = {
            id: generateId('summary'),
            role: 'system',
            parts: [{ type: 'text', content: `[Previous conversation summary]\n\n${summary}` }],
            timestamp: Date.now(),
          }

          const compactedMessages = [summaryMessage, ...recentMessages]

          // Update session
          yield* Ref.update(store, (s) => {
            const session = s.sessions.get(sessionID)!
            session.messages = compactedMessages
            session.updatedAt = Date.now()
            return s
          })

          const originalTokens = estimateTotalTokens(messages)
          const compactedTokens = estimateTotalTokens(compactedMessages)

          return {
            summary,
            originalMessageCount: messages.length,
            compactedMessageCount: compactedMessages.length,
            tokensSaved: originalTokens - compactedTokens,
          }
        })
      },

      list() {
        return Effect.gen(function* () {
          const s = yield* Ref.get(store)
          return Array.from(s.sessions.values())
        })
      },
    })
  })
)

// ============================================================================
// Predefined Configurations
// ============================================================================

/**
 * Default compaction config for long sessions
 */
export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  targetTokens: 100000, // ~400k chars
  maxMessages: 1000,
  minTurnsBetweenCompaction: 10,
}

/**
 * Aggressive compaction for very long sessions
 */
export const AGGRESSIVE_COMPACTION_CONFIG: CompactionConfig = {
  targetTokens: 50000, // ~200k chars
  maxMessages: 500,
  minTurnsBetweenCompaction: 20,
}
