/**
 * Task Checkpoint System
 *
 * Provides session recovery: saves agent state after each turn so that
 * long-running tasks can be resumed after failure without starting over.
 *
 * Checkpoint is saved automatically after each iteration in the agent loop.
 * Recovery happens via POST /api/sessions/:id/resume.
 *
 * 持久化: 使用 SQLite (better-sqlite3)
 */

import type { Message } from '../session/types.js'
import {
  dbUpsertCheckpoint,
  dbGetCheckpoint,
  dbDeleteCheckpoint,
  dbListCheckpoints,
} from '../session/db.js'

export interface TaskCheckpoint {
  sessionId: string
  task: string              // Original task description
  messages: Message[]       // Current message history
  iterations: number        // How many iterations have run
  totalInputTokens: number
  totalOutputTokens: number
  consecutiveToolOnlyTurns: number  // Doom loop safety counter
  createdAt: number
  updatedAt: number
}

/**
 * Save a checkpoint for a session.
 */
export function saveCheckpoint(
  sessionId: string,
  task: string,
  messages: Message[],
  iterations: number,
  totalInputTokens: number,
  totalOutputTokens: number,
  consecutiveToolOnlyTurns: number,
): TaskCheckpoint {
  const now = Date.now()
  const existing = dbGetCheckpoint(sessionId)
  const checkpoint: TaskCheckpoint = {
    sessionId,
    task,
    messages: JSON.parse(JSON.stringify(messages)), // deep clone
    iterations,
    totalInputTokens,
    totalOutputTokens,
    consecutiveToolOnlyTurns,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  dbUpsertCheckpoint(checkpoint)
  return checkpoint
}

/**
 * Get a checkpoint for a session, if it exists.
 */
export function getCheckpoint(sessionId: string): TaskCheckpoint | undefined {
  return dbGetCheckpoint(sessionId)
}

/**
 * Delete a checkpoint (after successful completion or user request).
 */
export function deleteCheckpoint(sessionId: string): void {
  dbDeleteCheckpoint(sessionId)
}

/**
 * List all active checkpoints.
 */
export function listCheckpoints(): TaskCheckpoint[] {
  return dbListCheckpoints()
}

/**
 * Resume info returned to the client.
 */
export interface ResumeInfo {
  canResume: boolean
  checkpoint?: TaskCheckpoint
  error?: string
}

/**
 * Attempt to get resume info for a session.
 */
export function getResumeInfo(sessionId: string): ResumeInfo {
  const checkpoint = dbGetCheckpoint(sessionId)
  if (!checkpoint) {
    return { canResume: false, error: 'No checkpoint found for this session' }
  }
  return { canResume: true, checkpoint }
}