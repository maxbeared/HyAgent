/**
 * Worktree Types
 *
 * Git worktree management for isolated agent instances.
 *
 * Reference: opencode/packages/opencode/src/worktree/
 */

import { z } from 'zod'
import { Effect } from 'effect'
import { homedir } from 'os'
import { join } from 'path'

// ============================================================================
// Worktree State
// ============================================================================

export const WorktreeStateSchema = z.enum(['active', 'locked', 'prunable', 'missing'])
export type WorktreeState = z.infer<typeof WorktreeStateSchema>

// ============================================================================
// Cleanup Result
// ============================================================================

export interface CleanupResult {
  pruned: number
  removed: number
  errors: string[]
}

// ============================================================================
// Worktree Entry
// ============================================================================

export const WorktreeEntrySchema = z.object({
  path: z.string().describe('Worktree directory path'),
  branch: z.string().describe('Associated branch name'),
  head: z.string().describe('HEAD commit hash'),
  state: WorktreeStateSchema.describe('Worktree state'),
  locked: z.boolean().optional().describe('Whether worktree is locked'),
  lockReason: z.string().optional().describe('Reason for locking'),
})

export type WorktreeEntry = z.infer<typeof WorktreeEntrySchema>

// ============================================================================
// Worktree Config
// ============================================================================

export interface WorktreeConfig {
  basePath: string  // Base directory for worktrees
  defaultBranch: string  // Default branch for new worktrees
  autoCleanup: boolean  // Auto-prune stale worktrees
  maxWorktrees: number  // Maximum number of worktrees
}

export const WorktreeConfigSchema = z.object({
  basePath: z.string().default(() => join(homedir(), '.hyagent', 'worktrees')),
  defaultBranch: z.string().default('main'),
  autoCleanup: z.boolean().default(true),
  maxWorktrees: z.number().default(10),
})

// ============================================================================
// Worktree Options
// ============================================================================

export const CreateWorktreeOptionsSchema = z.object({
  path: z.string().describe('Worktree directory path'),
  branch: z.string().describe('Branch name'),
  startPoint: z.string().optional().describe('Starting commit/branch'),
  noCheckout: z.boolean().optional().describe('Create worktree without checking out files'),
})

export type CreateWorktreeOptions = z.infer<typeof CreateWorktreeOptionsSchema>

export const RemoveWorktreeOptionsSchema = z.object({
  path: z.string().describe('Worktree directory path'),
  force: z.boolean().optional().describe('Force removal even with uncommitted changes'),
})

export type RemoveWorktreeOptions = z.infer<typeof RemoveWorktreeOptionsSchema>

export const LockWorktreeOptionsSchema = z.object({
  path: z.string().describe('Worktree directory path'),
  reason: z.string().optional().describe('Reason for locking'),
})

export type LockWorktreeOptions = z.infer<typeof LockWorktreeOptionsSchema>

// ============================================================================
// Worktree Manager
// ============================================================================

export interface WorktreeManager {
  config: WorktreeConfig

  list(): Effect.Effect<WorktreeEntry[]>
  create(options: CreateWorktreeOptions): Effect.Effect<WorktreeEntry>
  remove(options: RemoveWorktreeOptions): Effect.Effect<void>
  lock(options: LockWorktreeOptions): Effect.Effect<void>
  unlock(path: string): Effect.Effect<void>
  prune(): Effect.Effect<number>
  cleanup(): Effect.Effect<CleanupResult>
}

// ============================================================================
// Agent Instance Per Worktree
// ============================================================================

export interface WorktreeAgentInstance {
  worktreePath: string
  agentId: string
  sessionId?: string
  status: 'idle' | 'running' | 'stopping'
  startedAt: number
}
