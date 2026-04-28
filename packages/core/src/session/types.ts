/**
 * Session Types - 会话类型定义
 *
 * 参考来源:
 * - opencode/packages/opencode/src/server/session/
 * - Anthropic-Leaked-Source-Code/query/tokenBudget.ts
 */

import { Context, Effect } from 'effect'

// ============================================================================
// Message Types
// ============================================================================

/**
 * Message part types
 */
export type MessagePart =
  | { type: 'text'; content: string }
  | { type: 'reasoning'; content: string }
  | { type: 'tool_use'; tool: string; input: unknown; callID: string }
  | { type: 'tool_result'; callID: string; content: string }
  | { type: 'file'; name: string; content: string; mimeType?: string }
  | { type: 'image'; url: string; alt?: string }

/**
 * Message in a session
 */
export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  parts: MessagePart[]
  timestamp: number
}

/**
 * Permission modes for session security (simplified to 4 modes)
 */
export type PermissionMode =
  | 'permissive'    // Allow all operations (dangerous, use with caution)
  | 'default'       // Allow safe ops, ask for dangerous
  | 'askAll'        // Ask for all operations
  | 'plan'          // Planning mode, can create plans but not modify files

/**
 * Session state
 */
export interface Session {
  id: string
  messages: Message[]
  model?: string
  provider?: string
  createdAt: number
  updatedAt: number
  metadata?: Record<string, unknown>
  parentId?: string // Fork source session ID
  forkCount?: number // Number of times this session has been forked
  permissionMode?: PermissionMode // Permission mode for this session
}

// ============================================================================
// Compaction Types
// ============================================================================

/**
 * Compaction configuration
 */
export interface CompactionConfig {
  targetTokens: number
  maxMessages: number
  minTurnsBetweenCompaction: number
}

/**
 * Compaction result
 */
export interface CompactionResult {
  summary: string
  originalMessageCount: number
  compactedMessageCount: number
  tokensSaved: number
}

// ============================================================================
// Session Service Types
// ============================================================================

/**
 * Session service interface
 */
export interface SessionService {
  /**
   * Create a new session
   */
  create(options?: {
    model?: string
    provider?: string
    metadata?: Record<string, unknown>
  }): Effect.Effect<Session, Error>

  /**
   * Get session by ID
   */
  get(sessionID: string): Effect.Effect<Session | undefined, Error>

  /**
   * Add message to session
   */
  addMessage(sessionID: string, message: Omit<Message, 'id' | 'timestamp'>): Effect.Effect<Message, Error>

  /**
   * Get messages for session
   */
  getMessages(sessionID: string): Effect.Effect<Message[], Error>

  /**
   * Update session metadata
   */
  updateMetadata(sessionID: string, metadata: Record<string, unknown>): Effect.Effect<void, Error>

  /**
   * Delete session
   */
  delete(sessionID: string): Effect.Effect<void, Error>

  /**
   * Compact session to reduce token usage
   */
  compact(sessionID: string, config: CompactionConfig): Effect.Effect<CompactionResult, Error>

  /**
   * List all sessions
   */
  list(): Effect.Effect<Session[], Error>

  /**
   * Fork a session from a specific message point
   */
  fork(sessionID: string, messageID?: string): Effect.Effect<Session, Error>
}

/**
 * Fork result contains the new session and ID mapping
 */
export interface ForkResult {
  session: Session
  idMapping: Map<string, string> // original message ID -> new message ID
}

/**
 * Session service tag for Effect context
 */
export const SessionServiceTag = Context.GenericTag<SessionService>('@hyagent/session')

// ============================================================================
// Token Budget Types (来自Claude Code)
// ============================================================================

/**
 * Token budget for session
 */
export interface TokenBudget {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  maxTokens: number
  warningThreshold: number
}

/**
 * Check if compaction is needed
 */
export function shouldCompact(
  messages: Message[],
  config: CompactionConfig
): { shouldCompact: boolean; reason?: string } {
  // Estimate token count (rough approximation: 4 chars per token)
  const estimatedTokens = messages.reduce(
    (sum, msg) => sum + msg.parts.reduce((pSum, part) => pSum + JSON.stringify(part).length / 4, 0),
    0
  )

  if (estimatedTokens >= config.targetTokens) {
    return {
      shouldCompact: true,
      reason: `Token count (${Math.round(estimatedTokens)}) exceeds target (${config.targetTokens})`,
    }
  }

  return { shouldCompact: false }
}
