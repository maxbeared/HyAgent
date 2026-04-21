/**
 * Session Database - SQLite 持久化层
 *
 * 使用 better-sqlite3 实现 Session 和 Checkpoint 的持久化存储。
 * 设计参考 OpenCode 的 SQLite + Drizzle ORM 模式，但使用更轻量的直接 SQL 方式。
 */

import Database from 'better-sqlite3'
import { Effect, Layer, Context } from 'effect'
import { homedir } from 'os'
import { join } from 'path'
import { mkdirSync, existsSync } from 'fs'
import type { Session, Message } from './types.js'

// ============================================================================
// Database Schema
// ============================================================================

/**
 * Database file path
 */
const DB_PATH = join(homedir(), '.hybrid-agent', 'sessions.db')

/**
 * Initialize database directory and connection
 */
function initDatabase(): Database.Database {
  const dir = join(homedir(), '.hybrid-agent')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  const db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      messages TEXT NOT NULL DEFAULT '[]',
      model TEXT,
      provider TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      metadata TEXT DEFAULT '{}',
      parent_id TEXT,
      fork_count INTEGER DEFAULT 0,
      permission_mode TEXT DEFAULT 'default'
    );

    CREATE TABLE IF NOT EXISTS checkpoints (
      session_id TEXT PRIMARY KEY,
      task TEXT NOT NULL,
      messages TEXT NOT NULL,
      iterations INTEGER NOT NULL,
      total_input_tokens INTEGER NOT NULL DEFAULT 0,
      total_output_tokens INTEGER NOT NULL DEFAULT 0,
      consecutive_tool_only_turns INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at);
    CREATE INDEX IF NOT EXISTS idx_checkpoints_created ON checkpoints(created_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_id);
  `)

  // Migrate: add parent_id and fork_count columns if they don't exist (backward compatibility)
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN parent_id TEXT`)
  } catch {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN fork_count INTEGER DEFAULT 0`)
  } catch {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN permission_mode TEXT DEFAULT 'default'`)
  } catch {
    // Column already exists
  }

  return db
}

// ============================================================================
// Database Operations
// ============================================================================

let dbInstance: Database.Database | null = null

/**
 * Get database instance (singleton)
 */
export function getDatabase(): Database.Database {
  if (!dbInstance) {
    dbInstance = initDatabase()
  }
  return dbInstance
}

/**
 * Close database connection
 */
export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close()
    dbInstance = null
  }
}

// ============================================================================
// Session Operations
// ============================================================================

export interface DbSession {
  id: string
  messages: string // JSON string
  model: string | null
  provider: string | null
  created_at: number
  updated_at: number
  metadata: string // JSON string
  parent_id: string | null
  fork_count: number
  permission_mode: string | null
}

export interface DbCheckpoint {
  session_id: string
  task: string
  messages: string // JSON string
  iterations: number
  total_input_tokens: number
  total_output_tokens: number
  consecutive_tool_only_turns: number
  created_at: number
  updated_at: number
}

/**
 * Insert a new session
 */
export function dbInsertSession(session: Session): void {
  const db = getDatabase()
  const stmt = db.prepare(`
    INSERT INTO sessions (id, messages, model, provider, created_at, updated_at, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  stmt.run(
    session.id,
    JSON.stringify(session.messages),
    session.model ?? null,
    session.provider ?? null,
    session.createdAt,
    session.updatedAt,
    JSON.stringify(session.metadata ?? {})
  )
}

/**
 * Get a session by ID
 */
export function dbGetSession(id: string): Session | undefined {
  const db = getDatabase()
  const stmt = db.prepare('SELECT * FROM sessions WHERE id = ?')
  const row = stmt.get(id) as DbSession | undefined

  if (!row) return undefined

  return {
    id: row.id,
    messages: JSON.parse(row.messages) as Message[],
    model: row.model ?? undefined,
    provider: row.provider ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    parentId: row.parent_id ?? undefined,
    forkCount: row.fork_count,
    permissionMode: (row.permission_mode ?? 'default') as Session['permissionMode'],
  }
}

/**
 * Update session messages and timestamp
 */
export function dbUpdateSession(
  id: string,
  messages: Message[],
  updatedAt: number
): void {
  const db = getDatabase()
  const stmt = db.prepare(`
    UPDATE sessions SET messages = ?, updated_at = ? WHERE id = ?
  `)
  stmt.run(JSON.stringify(messages), updatedAt, id)
}

/**
 * Update session permission mode
 */
export function dbUpdateSessionPermissionMode(
  id: string,
  permissionMode: string,
  updatedAt: number
): void {
  const db = getDatabase()
  const stmt = db.prepare(`
    UPDATE sessions SET permission_mode = ?, updated_at = ? WHERE id = ?
  `)
  stmt.run(permissionMode, updatedAt, id)
}

/**
 * Update session metadata
 */
export function dbUpdateSessionMetadata(
  id: string,
  metadata: Record<string, unknown>,
  updatedAt: number
): void {
  const db = getDatabase()
  const stmt = db.prepare(`
    UPDATE sessions SET metadata = ?, updated_at = ? WHERE id = ?
  `)
  stmt.run(JSON.stringify(metadata), updatedAt, id)
}

/**
 * Update session messages only (for server.ts compatibility)
 */
export function dbUpdateSessionMessages(
  id: string,
  messages: unknown[],
  updatedAt: number
): void {
  const db = getDatabase()
  const stmt = db.prepare(`
    UPDATE sessions SET messages = ?, updated_at = ? WHERE id = ?
  `)
  stmt.run(JSON.stringify(messages), updatedAt, id)
}

/**
 * Delete a session
 */
export function dbDeleteSession(id: string): void {
  const db = getDatabase()
  const stmt = db.prepare('DELETE FROM sessions WHERE id = ?')
  stmt.run(id)
}

/**
 * List all sessions (ordered by updated_at desc)
 */
export function dbListSessions(): Session[] {
  const db = getDatabase()
  const stmt = db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC')
  const rows = stmt.all() as DbSession[]

  return rows.map((row) => ({
    id: row.id,
    messages: JSON.parse(row.messages) as Message[],
    model: row.model ?? undefined,
    provider: row.provider ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    parentId: row.parent_id ?? undefined,
    forkCount: row.fork_count,
    permissionMode: (row.permission_mode ?? 'default') as Session['permissionMode'],
  }))
}

// ============================================================================
// Fork Operations
// ============================================================================

/**
 * Fork a session - create a new session with messages copied up to messageID
 * Returns the new session and ID mapping for messages
 */
export function dbForkSession(
  parentId: string,
  messages: Message[],
  messageID?: string
): { session: Session; idMapping: Map<string, string> } {
  const db = getDatabase()

  // Get parent session to copy metadata
  const parent = dbGetSession(parentId)
  if (!parent) {
    throw new Error(`Parent session not found: ${parentId}`)
  }

  // Calculate fork count
  const forkCount = (parent.forkCount ?? 0) + 1

  // Generate new session ID
  const newId = `session_${Array.from({ length: 8 }, () =>
    Math.floor(Math.random() * 256).toString(16).padStart(2, '0')
  ).join('')}`

  // Clone messages and create ID mapping
  const idMapping = new Map<string, string>()
  const clonedMessages: Message[] = []

  for (const msg of messages) {
    // Stop at messageID if specified
    if (messageID && msg.id === messageID) {
      clonedMessages.push({ ...msg })
      const newMsgId = `msg_${clonedMessages.length - 1}`
      idMapping.set(msg.id, newMsgId)
      break
    }

    // Clone message with new ID
    const newMsgId = `msg_${clonedMessages.length}`
    idMapping.set(msg.id, newMsgId)
    clonedMessages.push({ ...msg })
  }

  const now = Date.now()
  const newSession: Session = {
    id: newId,
    messages: clonedMessages,
    model: parent.model,
    provider: parent.provider,
    createdAt: now,
    updatedAt: now,
    metadata: { ...parent.metadata },
    parentId: parentId,
    forkCount: 0, // New fork has 0 forks itself
  }

  // Insert new session
  const stmt = db.prepare(`
    INSERT INTO sessions (id, messages, model, provider, created_at, updated_at, metadata, parent_id, fork_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  stmt.run(
    newSession.id,
    JSON.stringify(newSession.messages),
    newSession.model ?? null,
    newSession.provider ?? null,
    newSession.createdAt,
    newSession.updatedAt,
    JSON.stringify(newSession.metadata),
    newSession.parentId ?? null,
    newSession.forkCount
  )

  // Increment parent's fork count
  dbIncrementForkCount(parentId, forkCount)

  return { session: newSession, idMapping }
}

/**
 * Increment the fork count of a session
 */
function dbIncrementForkCount(sessionId: string, count: number): void {
  const db = getDatabase()
  const stmt = db.prepare('UPDATE sessions SET fork_count = ?, updated_at = ? WHERE id = ?')
  stmt.run(count, Date.now(), sessionId)
}

/**
 * Get all child sessions (forks) of a session
 */
export function dbGetChildSessions(parentId: string): Session[] {
  const db = getDatabase()
  const stmt = db.prepare('SELECT * FROM sessions WHERE parent_id = ? ORDER BY created_at DESC')
  const rows = stmt.all(parentId) as DbSession[]

  return rows.map((row) => ({
    id: row.id,
    messages: JSON.parse(row.messages) as Message[],
    model: row.model ?? undefined,
    provider: row.provider ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    parentId: row.parent_id ?? undefined,
    forkCount: row.fork_count,
    permissionMode: (row.permission_mode ?? 'default') as Session['permissionMode'],
  }))
}

/**
 * Get session fork info (parent and children)
 */
export function dbGetForkInfo(sessionId: string): { parent?: Session; children: Session[] } {
  const session = dbGetSession(sessionId)
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`)
  }

  return {
    parent: session.parentId ? dbGetSession(session.parentId) : undefined,
    children: dbGetChildSessions(sessionId),
  }
}

// ============================================================================
// Checkpoint Operations
// ============================================================================

import type { TaskCheckpoint } from '../agent/checkpoint.js'

/**
 * Insert or replace a checkpoint
 */
export function dbUpsertCheckpoint(checkpoint: TaskCheckpoint): void {
  const db = getDatabase()
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO checkpoints
    (session_id, task, messages, iterations, total_input_tokens, total_output_tokens,
     consecutive_tool_only_turns, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  stmt.run(
    checkpoint.sessionId,
    checkpoint.task,
    JSON.stringify(checkpoint.messages),
    checkpoint.iterations,
    checkpoint.totalInputTokens,
    checkpoint.totalOutputTokens,
    checkpoint.consecutiveToolOnlyTurns,
    checkpoint.createdAt,
    checkpoint.updatedAt
  )
}

/**
 * Get a checkpoint by session ID
 */
export function dbGetCheckpoint(sessionId: string): TaskCheckpoint | undefined {
  const db = getDatabase()
  const stmt = db.prepare('SELECT * FROM checkpoints WHERE session_id = ?')
  const row = stmt.get(sessionId) as DbCheckpoint | undefined

  if (!row) return undefined

  return {
    sessionId: row.session_id,
    task: row.task,
    messages: JSON.parse(row.messages) as Message[],
    iterations: row.iterations,
    totalInputTokens: row.total_input_tokens,
    totalOutputTokens: row.total_output_tokens,
    consecutiveToolOnlyTurns: row.consecutive_tool_only_turns,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Delete a checkpoint
 */
export function dbDeleteCheckpoint(sessionId: string): void {
  const db = getDatabase()
  const stmt = db.prepare('DELETE FROM checkpoints WHERE session_id = ?')
  stmt.run(sessionId)
}

/**
 * List all checkpoints
 */
export function dbListCheckpoints(): TaskCheckpoint[] {
  const db = getDatabase()
  const stmt = db.prepare('SELECT * FROM checkpoints ORDER BY updated_at DESC')
  const rows = stmt.all() as DbCheckpoint[]

  return rows.map((row) => ({
    sessionId: row.session_id,
    task: row.task,
    messages: JSON.parse(row.messages) as Message[],
    iterations: row.iterations,
    totalInputTokens: row.total_input_tokens,
    totalOutputTokens: row.total_output_tokens,
    consecutiveToolOnlyTurns: row.consecutive_tool_only_turns,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
}

// ============================================================================
// Effect-wrapped Database Layer
// ============================================================================

/**
 * Effect tag for Database
 */
export const DatabaseTag = Context.GenericTag<Database.Database>('@hybrid-agent/database')

/**
 * Layer that provides the database instance
 */
export const DatabaseLayer = Layer.effect(
  DatabaseTag,
  Effect.sync(() => getDatabase())
)
