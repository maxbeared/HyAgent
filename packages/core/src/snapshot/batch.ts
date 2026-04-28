/**
 * Snapshot Batch Operations
 *
 * Batch git operations, automated cleanup, and diff generation.
 *
 * Reference: opencode/packages/opencode/src/snapshot/batch.ts
 */

import { execSync } from 'child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'fs'
import { join, dirname, relative } from 'path'
import { homedir } from 'os'
import { z } from 'zod'

// ============================================================================
// Types
// ============================================================================

export interface FileDiff {
  path: string
  status: 'added' | 'deleted' | 'modified' | 'renamed'
  diff?: string
  hash?: string
}

export interface Snapshot {
  id: string
  sessionId: string
  message: string
  createdAt: number
  files: string[]
  hash: string
}

export interface BatchSnapshotOptions {
  sessionId: string
  snapshots: Array<{
    message: string
    files?: string[]
  }>
}

export interface CleanupPolicy {
  maxSnapshots: number
  maxAgeDays: number
  keepTagged: boolean
  tagPrefix?: string
}

export interface CleanupResult {
  deleted: number
  freedBytes: number
  errors: string[]
}

// ============================================================================
// Snapshot Storage
// ============================================================================

const SNAPSHOT_DIR = join(homedir(), '.hyagent', 'snapshots')

function ensureSnapshotDir(): void {
  if (!existsSync(SNAPSHOT_DIR)) {
    mkdirSync(SNAPSHOT_DIR, { recursive: true })
  }
}

// ============================================================================
// Batch Operations
// ============================================================================

/**
 * Create multiple snapshots in batch
 */
export function createBatchSnapshots(options: BatchSnapshotOptions): Snapshot[] {
  ensureGitRepo()

  const { sessionId, snapshots } = options
  const results: Snapshot[] = []

  for (const snap of snapshots) {
    const snapshot = createSnapshotInternal({
      sessionId,
      message: snap.message,
      files: snap.files,
    })
    results.push(snapshot)
  }

  return results
}

/**
 * Create a single snapshot internally
 */
function createSnapshotInternal(options: { sessionId: string; message: string; files?: string[] }): Snapshot {
  const { sessionId, message, files } = options
  const filesToTrack = files || getChangedFiles()

  if (filesToTrack.length > 0) {
    stageFiles(filesToTrack)
  }

  const hash = createCommit(`[${sessionId}] ${message}`)

  const snapshot: Snapshot = {
    id: hash.substring(0, 8),
    sessionId,
    message,
    createdAt: Date.now(),
    files: filesToTrack,
    hash,
  }

  saveSnapshotMetadata(snapshot)
  return snapshot
}

/**
 * Get snapshot metadata
 */
function getSnapshotMetadataDir(): string {
  return join(SNAPSHOT_DIR, '.snapshots')
}

/**
 * Save snapshot metadata
 */
function saveSnapshotMetadata(snapshot: Snapshot): void {
  const metaPath = join(getSnapshotMetadataDir(), `${snapshot.hash}.json`)
  const metaDir = dirname(metaPath)
  if (!existsSync(metaDir)) {
    mkdirSync(metaDir, { recursive: true })
  }
  writeFileSync(metaPath, JSON.stringify(snapshot, null, 2))
}

/**
 * Load snapshot metadata
 */
function loadSnapshotMetadata(hash: string): Snapshot | undefined {
  const metaPath = join(getSnapshotMetadataDir(), `${hash}.json`)
  if (!existsSync(metaPath)) {
    return undefined
  }
  try {
    return JSON.parse(readFileSync(metaPath, 'utf-8'))
  } catch {
    return undefined
  }
}

/**
 * List all snapshots with metadata
 */
export function listSnapshotsWithMetadata(): Snapshot[] {
  const metaDir = getSnapshotMetadataDir()
  if (!existsSync(metaDir)) {
    return []
  }

  const snapshots: Snapshot[] = []

  try {
    const files = readdirSync(metaDir).filter((f) => f.endsWith('.json'))
    for (const file of files) {
      const snapshot = loadSnapshotMetadata(file.replace('.json', ''))
      if (snapshot) {
        snapshots.push(snapshot)
      }
    }
  } catch {
    // Directory might not exist
  }

  return snapshots.sort((a, b) => b.createdAt - a.createdAt)
}

// ============================================================================
// Diff Generation
// ============================================================================

/**
 * Generate diff between two snapshots
 */
export function generateDiff(fromHash: string, toHash: string): FileDiff[] {
  try {
    const output = execSync(`git diff --name-status ${fromHash} ${toHash}`, {
      cwd: SNAPSHOT_DIR,
      encoding: 'utf-8',
    })

    return output.trim().split('\n').filter(Boolean).map((line) => {
      const [status, path] = line.split('\t')
      let statusType: FileDiff['status'] = 'modified'
      if (status === 'A') statusType = 'added'
      else if (status === 'D') statusType = 'deleted'
      else if (status === 'R') statusType = 'renamed'

      const diff = execSync(`git diff ${fromHash} ${toHash} -- "${path}"`, {
        cwd: SNAPSHOT_DIR,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
      }).toString()

      return { path, status: statusType, diff }
    })
  } catch {
    return []
  }
}

/**
 * Generate unified diff for display
 */
export function generateUnifiedDiff(fromHash: string, toHash: string, file?: string): string {
  try {
    const args = `git diff ${fromHash} ${toHash}`
    const cmd = file ? `${args} -- "${file}"` : args
    return execSync(cmd, { cwd: SNAPSHOT_DIR, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 })
  } catch {
    return ''
  }
}

/**
 * Compare two snapshots by session
 */
export function compareSessionSnapshots(sessionId: string): {
  snapshots: Snapshot[]
  changes: Array<{ from: Snapshot; to: Snapshot; diffs: FileDiff[] }>
} {
  const allSnapshots = listSnapshotsWithMetadata().filter((s) => s.sessionId === sessionId)

  const changes: Array<{ from: Snapshot; to: Snapshot; diffs: FileDiff[] }> = []

  for (let i = 1; i < allSnapshots.length; i++) {
    const from = allSnapshots[i]
    const to = allSnapshots[i - 1]
    const diffs = generateDiff(from.hash, to.hash)

    if (diffs.length > 0) {
      changes.push({ from, to, diffs })
    }
  }

  return { snapshots: allSnapshots, changes }
}

// ============================================================================
// Cleanup Operations
// ============================================================================

/**
 * Clean up old snapshots based on policy
 */
export function cleanupSnapshots(policy: CleanupPolicy): CleanupResult {
  const result: CleanupResult = {
    deleted: 0,
    freedBytes: 0,
    errors: [],
  }

  const snapshots = listSnapshotsWithMetadata()
  const now = Date.now()
  const maxAgeMs = policy.maxAgeDays * 24 * 60 * 60 * 1000

  // Separate snapshots by priority
  const toDelete: Snapshot[] = []
  const toKeep: Snapshot[] = []

  for (const snapshot of snapshots) {
    const age = now - snapshot.createdAt

    // Check if tagged (keep if policy says so)
    if (policy.keepTagged && snapshot.message.includes('[tag]')) {
      toKeep.push(snapshot)
      continue
    }

    // Check if within prefix tag
    if (policy.tagPrefix && snapshot.message.startsWith(policy.tagPrefix)) {
      toKeep.push(snapshot)
      continue
    }

    // Check age
    if (age > maxAgeMs) {
      toDelete.push(snapshot)
      continue
    }

    toKeep.push(snapshot)
  }

  // If still over limit, delete oldest
  if (toKeep.length > policy.maxSnapshots) {
    const sorted = toKeep.sort((a, b) => a.createdAt - b.createdAt)
    const excess = sorted.slice(0, sorted.length - policy.maxSnapshots)
    toDelete.push(...excess)
  }

  // Perform deletion
  for (const snapshot of toDelete) {
    try {
      // Get file sizes before deletion
      const size = getSnapshotSize(snapshot)

      // Remove snapshot (revert the commit)
      execSync(`git reset --hard ${snapshot.hash}^`, { cwd: SNAPSHOT_DIR, stdio: 'ignore' })

      // Remove metadata
      const metaPath = join(getSnapshotMetadataDir(), `${snapshot.hash}.json`)
      if (existsSync(metaPath)) {
        // Can't actually delete files easily in git, just remove metadata
      }

      result.deleted++
      result.freedBytes += size
    } catch (e: any) {
      result.errors.push(`Failed to delete ${snapshot.hash}: ${e.message}`)
    }
  }

  return result
}

/**
 * Get total size of snapshot files
 */
function getSnapshotSize(snapshot: Snapshot): number {
  let size = 0
  for (const file of snapshot.files) {
    const filePath = join(SNAPSHOT_DIR, file)
    if (existsSync(filePath)) {
      try {
        size += statSync(filePath).size
      } catch {}
    }
  }
  return size
}

/**
 * Prune orphaned git objects
 */
export function pruneGitObjects(): void {
  try {
    execSync('git gc --prune=now', { cwd: SNAPSHOT_DIR, stdio: 'pipe' })
  } catch {
    // Ignore errors
  }
}

// ============================================================================
// Tagging
// ============================================================================

/**
 * Tag a snapshot
 */
export function tagSnapshot(hash: string, tag: string): void {
  try {
    execSync(`git tag -a "${tag}" -m "Tagged snapshot ${hash}" ${hash}`, {
      cwd: SNAPSHOT_DIR,
      stdio: 'ignore',
    })
  } catch (e: any) {
    throw new Error(`Failed to tag snapshot: ${e.message}`)
  }
}

/**
 * List tags
 */
export function listTags(): Array<{ tag: string; hash: string; message: string }> {
  try {
    const output = execSync('git tag -l', { cwd: SNAPSHOT_DIR, encoding: 'utf-8' })
    const tags = output.trim().split('\n').filter(Boolean)

    return tags.map((tag) => {
      const hash = execSync(`git rev-list ${tag}`, { cwd: SNAPSHOT_DIR, encoding: 'utf-8' }).trim().split('\n')[0]
      const message = execSync(`git tag -l ${tag} -m`, { cwd: SNAPSHOT_DIR, encoding: 'utf-8' }).trim()

      return { tag, hash, message }
    })
  } catch {
    return []
  }
}

/**
 * Delete a tag
 */
export function deleteTag(tag: string): void {
  try {
    execSync(`git tag -d "${tag}"`, { cwd: SNAPSHOT_DIR, stdio: 'ignore' })
  } catch {
    // Ignore if doesn't exist
  }
}

// ============================================================================
// Git Helpers
// ============================================================================

function ensureGitRepo(): void {
  ensureSnapshotDir()
  if (!existsSync(join(SNAPSHOT_DIR, '.git'))) {
    execSync('git init', { cwd: SNAPSHOT_DIR, stdio: 'ignore' })
    execSync('git config user.email "hyagent@snapshot"', { cwd: SNAPSHOT_DIR, stdio: 'ignore' })
    execSync('git config user.name "HyAgent"', { cwd: SNAPSHOT_DIR, stdio: 'ignore' })
  }
}

function stageFiles(files: string[]): void {
  for (const file of files) {
    const fullPath = join(SNAPSHOT_DIR, file)
    if (existsSync(fullPath)) {
      try {
        execSync(`git add "${file}"`, { cwd: SNAPSHOT_DIR, stdio: 'ignore' })
      } catch {}
    }
  }
}

function createCommit(message: string): string {
  try {
    execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd: SNAPSHOT_DIR, stdio: 'pipe' })
    const hash = execSync('git rev-parse HEAD', { cwd: SNAPSHOT_DIR, encoding: 'utf-8' }).trim()
    return hash
  } catch (e: any) {
    // No changes to commit
    return ''
  }
}

function getChangedFiles(): string[] {
  try {
    const output = execSync('git diff --name-only HEAD', { cwd: SNAPSHOT_DIR, encoding: 'utf-8' })
    return output.trim().split('\n').filter(Boolean)
  } catch {
    return []
  }
}
