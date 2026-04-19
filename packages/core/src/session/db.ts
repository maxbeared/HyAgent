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
      metadata TEXT DEFAULT '{}'
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
  `)

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
  }))
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
