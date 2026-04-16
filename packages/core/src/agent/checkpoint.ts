/**
 * Task Checkpoint System
 *
 * Provides session recovery: saves agent state after each turn so that
 * long-running tasks can be resumed after failure without starting over.
 *
 * Checkpoint is saved automatically after each iteration in the agent loop.
 * Recovery happens via POST /api/sessions/:id/resume.
 */

import type { Message } from './compaction.js'

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

// In-memory checkpoint store (can be replaced with persistent storage)
const checkpoints = new Map<string, TaskCheckpoint>()

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
  const checkpoint: TaskCheckpoint = {
    sessionId,
    task,
    messages: JSON.parse(JSON.stringify(messages)), // deep clone
    iterations,
    totalInputTokens,
    totalOutputTokens,
    consecutiveToolOnlyTurns,
    createdAt: checkpoints.get(sessionId)?.createdAt ?? now,
    updatedAt: now,
  }
  checkpoints.set(sessionId, checkpoint)
  return checkpoint
}

/**
 * Get a checkpoint for a session, if it exists.
 */
export function getCheckpoint(sessionId: string): TaskCheckpoint | undefined {
  return checkpoints.get(sessionId)
}

/**
 * Delete a checkpoint (after successful completion or user request).
 */
export function deleteCheckpoint(sessionId: string): void {
  checkpoints.delete(sessionId)
}

/**
 * List all active checkpoints.
 */
export function listCheckpoints(): TaskCheckpoint[] {
  return Array.from(checkpoints.values())
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
  const checkpoint = checkpoints.get(sessionId)
  if (!checkpoint) {
    return { canResume: false, error: 'No checkpoint found for this session' }
  }
  return { canResume: true, checkpoint }
}