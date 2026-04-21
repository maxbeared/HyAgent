/**
 * Session Service - 会话管理与压缩
 *
 * 功能:
 * - 会话创建、读取、更新、删除
 * - 消息管理
 * - 会话压缩 (Compaction) - 来自Claude Code的tokenBudget概念
 *
 * 持久化: 使用 SQLite (better-sqlite3)
 *
 * 参考来源:
 * - opencode/packages/opencode/src/server/session/
 * - Anthropic-Leaked-Source-Code/query/tokenBudget.ts
 */

import { Effect, Layer } from 'effect'
import type { Session, Message, CompactionConfig, CompactionResult, SessionService } from './types.js'
import { shouldCompact, SessionServiceTag } from './types.js'
import {
  dbInsertSession,
  dbGetSession,
  dbUpdateSession,
  dbUpdateSessionMetadata,
  dbUpdateSessionPermissionMode,
  dbDeleteSession,
  dbListSessions,
  dbForkSession,
  dbGetChildSessions,
} from './db.js'

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
  const lastMessages = messages.slice(-10)
  const preview = lastMessages
    .map((m) => `[${m.role}]: ${m.parts.filter((p) => p.type === 'text').map((p) => (p as { type: 'text'; content: string }).content).join('')}`)
    .join('\n')

  return `[Summary of ${messages.length} messages]\n\nRecent conversation:\n${preview.slice(0, 500)}...`
}

// ============================================================================
// Session Service Implementation (SQLite-backed)
// ============================================================================

/**
 * Create Session Service layer with SQLite persistence
 */
export const SessionServiceLayer = Layer.effect(
  SessionServiceTag,
  Effect.gen(function* () {
    // Message counters stored separately (not persisted across restarts)
    const counters = new Map<string, number>()

    return SessionServiceTag.of({
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

          // Persist to SQLite
          yield* Effect.sync(() => dbInsertSession(session))

          // Initialize counter for this session
          counters.set(sessionID, 0)

          return session
        })
      },

      get(sessionID) {
        return Effect.gen(function* () {
          const session = yield* Effect.sync(() => dbGetSession(sessionID))
          return session
        })
      },

      addMessage(sessionID, messageInput) {
        return Effect.gen(function* () {
          const session = yield* Effect.sync(() => dbGetSession(sessionID))

          if (!session) {
            return yield* Effect.fail(new Error(`Session not found: ${sessionID}`))
          }

          const counter = counters.get(sessionID) ?? 0
          const message: Message = {
            ...messageInput,
            id: generateId(`msg_${counter}`),
            timestamp: Date.now(),
          }

          // Update session in SQLite
          session.messages.push(message)
          session.updatedAt = Date.now()

          yield* Effect.sync(() => dbUpdateSession(sessionID, session.messages, session.updatedAt))

          // Increment counter
          counters.set(sessionID, counter + 1)

          return message
        })
      },

      getMessages(sessionID) {
        return Effect.gen(function* () {
          const session = yield* Effect.sync(() => dbGetSession(sessionID))
          return session?.messages ?? []
        })
      },

      updateMetadata(sessionID, metadata) {
        return Effect.gen(function* () {
          const session = yield* Effect.sync(() => dbGetSession(sessionID))
          if (!session) {
            return yield* Effect.fail(new Error(`Session not found: ${sessionID}`))
          }

          session.metadata = { ...session.metadata, ...metadata }
          session.updatedAt = Date.now()

          yield* Effect.sync(() => dbUpdateSessionMetadata(sessionID, session.metadata, session.updatedAt))
        })
      },

      delete(sessionID) {
        return Effect.gen(function* () {
          yield* Effect.sync(() => dbDeleteSession(sessionID))
          counters.delete(sessionID)
        })
      },

      compact(sessionID, config) {
        return Effect.gen(function* () {
          const session = yield* Effect.sync(() => dbGetSession(sessionID))

          if (!session) {
            return yield* Effect.fail(new Error(`Session not found: ${sessionID}`))
          }

          const messages = session.messages
          const needs = shouldCompact(messages, config)

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

          // Update in SQLite
          const now = Date.now()
          yield* Effect.sync(() => dbUpdateSession(sessionID, compactedMessages, now))

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
          return yield* Effect.sync(() => dbListSessions())
        })
      },

      fork(sessionID, messageID) {
        return Effect.gen(function* () {
          const session = yield* Effect.sync(() => dbGetSession(sessionID))

          if (!session) {
            return yield* Effect.fail(new Error(`Session not found: ${sessionID}`))
          }

          // Get messages up to messageID if specified
          const messagesToFork = messageID
            ? session.messages.slice(0, session.messages.findIndex((m) => m.id === messageID) + 1)
            : session.messages

          // Create fork
          const { session: forkedSession } = yield* Effect.sync(() =>
            dbForkSession(sessionID, messagesToFork, messageID)
          )

          return forkedSession
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

// Re-export SessionServiceTag for external use
export { SessionServiceTag } from './types.js'
