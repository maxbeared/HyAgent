/**
 * Worktree Management System
 *
 * Git worktree isolation for per-worktree agent instances.
 *
 * Features:
 * - Create/remove/list git worktrees
 * - Lock/unlock worktrees
 * - Per-worktree agent instance management
 * - Automatic cleanup of stale worktrees
 *
 * Reference: opencode/packages/opencode/src/worktree/
 */

import { execSync } from 'child_process'
import { existsSync, mkdirSync, rmSync } from 'fs'
import { join, dirname, relative } from 'path'
import { homedir } from 'os'

import { Effect, Layer, Context } from 'effect'
import { z } from 'zod'

// ============================================================================
// Types
// ============================================================================

import type {
  WorktreeEntry,
  WorktreeConfig,
  WorktreeManager,
  WorktreeAgentInstance,
  CreateWorktreeOptions,
  RemoveWorktreeOptions,
  LockWorktreeOptions,
  CleanupResult,
} from './types.js'

export {
  WorktreeEntry,
  WorktreeConfig,
  WorktreeManager,
  WorktreeAgentInstance,
  CreateWorktreeOptions,
  RemoveWorktreeOptions,
  LockWorktreeOptions,
  CleanupResult,
} from './types.js'

// ============================================================================
// Errors
// ============================================================================

export const WorktreeErrorSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('not_a_git_repo'),
    message: z.string(),
  }),
  z.object({
    type: z.literal('worktree_not_found'),
    path: z.string(),
  }),
  z.object({
    type: z.literal('worktree_exists'),
    path: z.string(),
  }),
  z.object({
    type: z.literal('branch_exists'),
    branch: z.string(),
  }),
  z.object({
    type: z.literal('create_failed'),
    reason: z.string(),
  }),
  z.object({
    type: z.literal('remove_failed'),
    reason: z.string(),
  }),
  z.object({
    type: z.literal('lock_failed'),
    reason: z.string(),
  }),
  z.object({
    type: z.literal('max_worktrees_exceeded'),
    max: z.number(),
  }),
])

export type WorktreeError = z.infer<typeof WorktreeErrorSchema>

// ============================================================================
// Git Operations
// ============================================================================

function execGitCommand(args: string[], cwd?: string): string {
  return execSync(`git ${args.join(' ')}`, {
    cwd: cwd ?? process.cwd(),
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

function isGitRepo(path: string): boolean {
  try {
    execGitCommand(['rev-parse', '--git-dir'], path)
    return true
  } catch {
    return false
  }
}

function getWorktreeList(cwd?: string): WorktreeEntry[] {
  try {
    const output = execGitCommand(['worktree', 'list', '--porcelain'], cwd)
    const entries: WorktreeEntry[] = []

    for (const line of output.split('\n')) {
      if (line.startsWith('worktree ')) {
        const path = line.substring(9)
        entries.push({
          path,
          branch: '',
          head: '',
          state: 'active',
          locked: false,
        })
      } else if (line.startsWith('branch ')) {
        const branch = line.substring(7)
        if (entries.length > 0) {
          entries[entries.length - 1].branch = branch
        }
      } else if (line.startsWith('HEAD ')) {
        const head = line.substring(5)
        if (entries.length > 0) {
          entries[entries.length - 1].head = head
        }
      } else if (line.startsWith('locked ')) {
        const reason = line.substring(7)
        if (entries.length > 0) {
          entries[entries.length - 1].locked = true
          entries[entries.length - 1].lockReason = reason
          entries[entries.length - 1].state = 'locked'
        }
      }
    }

    return entries
  } catch {
    return []
  }
}

function getWorktreeState(path: string, entries: WorktreeEntry[]): WorktreeEntry['state'] {
  const entry = entries.find((e) => e.path === path)
  if (!entry) return 'missing'
  if (entry.locked) return 'locked'

  // Check if directory exists
  if (!existsSync(path)) return 'prunable'

  return 'active'
}

// ============================================================================
// Worktree Service
// ============================================================================

export class WorktreeService {
  private config: WorktreeConfig
  private agentInstances: Map<string, WorktreeAgentInstance> = new Map()

  constructor(config: Partial<WorktreeConfig> = {}) {
    this.config = {
      basePath: join(homedir(), '.hybrid-agent', 'worktrees'),
      defaultBranch: 'main',
      autoCleanup: true,
      maxWorktrees: 10,
      ...config,
    }

    // Ensure base path exists
    if (!existsSync(this.config.basePath)) {
      mkdirSync(this.config.basePath, { recursive: true })
    }
  }

  /**
   * Get current worktree list
   */
  list(cwd?: string): WorktreeEntry[] {
    const entries = getWorktreeList(cwd)
    return entries.map((entry) => ({
      ...entry,
      state: getWorktreeState(entry.path, entries),
    }))
  }

  /**
   * Create a new worktree
   */
  create(options: CreateWorktreeOptions, cwd?: string): WorktreeEntry {
    const { path, branch, startPoint, noCheckout } = options

    // Check max worktrees
    const current = this.list(cwd)
    if (current.length >= this.config.maxWorktrees) {
      throw {
        type: 'max_worktrees_exceeded' as const,
        max: this.config.maxWorktrees,
      }
    }

    // Check if worktree already exists
    if (existsSync(path)) {
      throw {
        type: 'worktree_exists' as const,
        path,
      }
    }

    // Ensure parent directory exists
    const parent = dirname(path)
    if (!existsSync(parent)) {
      mkdirSync(parent, { recursive: true })
    }

    // Build git command
    const args = ['worktree', 'add']
    if (noCheckout) args.push('--no-checkout')
    if (startPoint) args.push('-b', branch, path, startPoint)
    else if (branch !== this.config.defaultBranch) args.push('-b', branch, path)
    else args.push(path)

    try {
      execGitCommand(args, cwd)

      // Verify worktree was created
      const entries = getWorktreeList(cwd)
      const entry = entries.find((e) => e.path === path)

      if (!entry) {
        throw {
          type: 'create_failed' as const,
          reason: 'Worktree was not found after creation',
        }
      }

      return {
        ...entry,
        state: 'active',
        locked: false,
      }
    } catch (e: any) {
      // Clean up directory if it exists
      if (existsSync(path)) {
        try {
          rmSync(path, { recursive: true, force: true })
        } catch {}
      }

      if (e.type) throw e

      throw {
        type: 'create_failed' as const,
        reason: e.message || String(e),
      }
    }
  }

  /**
   * Remove a worktree
   */
  remove(options: RemoveWorktreeOptions, cwd?: string): void {
    const { path, force } = options

    // Check if worktree exists
    const entries = getWorktreeList(cwd)
    const entry = entries.find((e) => e.path === path)

    if (!entry) {
      throw {
        type: 'worktree_not_found' as const,
        path,
      }
    }

    // Check for active agent instance
    const instance = this.agentInstances.get(path)
    if (instance && instance.status === 'running') {
      throw {
        type: 'remove_failed' as const,
        reason: 'Cannot remove worktree with running agent instance',
      }
    }

    // Remove agent instance if exists
    this.agentInstances.delete(path)

    // Execute removal
    const args = ['worktree', 'remove', path]
    if (force) args.push('--force')

    try {
      execGitCommand(args, cwd)
    } catch (e: any) {
      throw {
        type: 'remove_failed' as const,
        reason: e.message || String(e),
      }
    }
  }

  /**
   * Lock a worktree
   */
  lock(options: LockWorktreeOptions, cwd?: string): void {
    const { path, reason } = options

    const args = ['worktree', 'lock', path]
    if (reason) args.push('--reason', reason)

    try {
      execGitCommand(args, cwd)
    } catch (e: any) {
      throw {
        type: 'lock_failed' as const,
        reason: e.message || String(e),
      }
    }
  }

  /**
   * Unlock a worktree
   */
  unlock(path: string, cwd?: string): void {
    try {
      execGitCommand(['worktree', 'unlock', path], cwd)
    } catch {
      // Ignore if not locked
    }
  }

  /**
   * Prune stale worktree references
   */
  prune(cwd?: string): number {
    try {
      execGitCommand(['worktree', 'prune'], cwd)
      return 1
    } catch {
      return 0
    }
  }

  /**
   * Full cleanup: prune and remove missing worktrees
   */
  cleanup(cwd?: string): CleanupResult {
    const result: CleanupResult = {
      pruned: 0,
      removed: 0,
      errors: [],
    }

    try {
      result.pruned = this.prune(cwd)
    } catch (e: any) {
      result.errors.push(`Prune failed: ${e.message}`)
    }

    // Find and remove missing worktrees
    const entries = this.list(cwd)
    for (const entry of entries) {
      if (entry.state === 'missing') {
        try {
          this.remove({ path: entry.path, force: true }, cwd)
          result.removed++
        } catch (e: any) {
          result.errors.push(`Remove ${entry.path} failed: ${e.message}`)
        }
      }
    }

    return result
  }

  // ============================================================================
  // Agent Instance Management (per-worktree)
  // ============================================================================

  /**
   * Register an agent instance for a worktree
   */
  registerAgent(worktreePath: string, agentId: string, sessionId?: string): WorktreeAgentInstance {
    const instance: WorktreeAgentInstance = {
      worktreePath,
      agentId,
      sessionId,
      status: 'idle',
      startedAt: Date.now(),
    }

    this.agentInstances.set(worktreePath, instance)
    return instance
  }

  /**
   * Get agent instance for a worktree
   */
  getAgent(worktreePath: string): WorktreeAgentInstance | undefined {
    return this.agentInstances.get(worktreePath)
  }

  /**
   * List all agent instances
   */
  listAgents(): WorktreeAgentInstance[] {
    return Array.from(this.agentInstances.values())
  }

  /**
   * Unregister agent instance
   */
  unregisterAgent(worktreePath: string): void {
    this.agentInstances.delete(worktreePath)
  }

  /**
   * Update agent status
   */
  updateAgentStatus(worktreePath: string, status: WorktreeAgentInstance['status']): void {
    const instance = this.agentInstances.get(worktreePath)
    if (instance) {
      instance.status = status
    }
  }

  /**
   * Get or create worktree for agent
   */
  getWorktreeForAgent(agentId: string, cwd?: string): WorktreeEntry {
    // Check if agent already has a worktree
    for (const instance of this.agentInstances.values()) {
      if (instance.agentId === agentId) {
        const entries = this.list(cwd)
        const entry = entries.find((e) => e.path === instance.worktreePath)
        if (entry) return entry
      }
    }

    // Create new worktree for agent
    const worktreePath = join(this.config.basePath, `agent-${agentId}`)
    const entry = this.create(
      {
        path: worktreePath,
        branch: `agent/${agentId}`,
      },
      cwd
    )

    // Register agent
    this.registerAgent(worktreePath, agentId)

    return entry
  }
}

// ============================================================================
// Effect-based Service
// ============================================================================

export const WorktreeConfigContext = Context.GenericTag<WorktreeConfig>('WorktreeConfig')

export const WorktreeServiceContext = Context.GenericTag<WorktreeService>('WorktreeService')

export const WorktreeLayer = Layer.effect(
  WorktreeServiceContext,
  Effect.map(WorktreeConfigContext, (config) => new WorktreeService(config))
)

// ============================================================================
// Convenience Functions
// ============================================================================

let defaultService: WorktreeService | null = null

export function getWorktreeService(): WorktreeService {
  if (!defaultService) {
    defaultService = new WorktreeService()
  }
  return defaultService
}

export function createWorktree(options: CreateWorktreeOptions, cwd?: string): WorktreeEntry {
  return getWorktreeService().create(options, cwd)
}

export function listWorktrees(cwd?: string): WorktreeEntry[] {
  return getWorktreeService().list(cwd)
}

export function removeWorktree(options: RemoveWorktreeOptions, cwd?: string): void {
  return getWorktreeService().remove(options, cwd)
}

export function lockWorktree(options: LockWorktreeOptions, cwd?: string): void {
  return getWorktreeService().lock(options, cwd)
}

export function unlockWorktree(path: string, cwd?: string): void {
  return getWorktreeService().unlock(path, cwd)
}

export function pruneWorktrees(cwd?: string): number {
  return getWorktreeService().prune(cwd)
}

export function cleanupWorktrees(cwd?: string): CleanupResult {
  return getWorktreeService().cleanup(cwd)
}

// ============================================================================
// Event Types
// ============================================================================

export interface WorktreeEvents {
  worktreeCreated: WorktreeEntry
  worktreeRemoved: { path: string }
  worktreeLocked: { path: string; reason?: string }
  worktreeUnlocked: { path: string }
  agentRegistered: WorktreeAgentInstance
  agentUnregistered: { worktreePath: string }
}
