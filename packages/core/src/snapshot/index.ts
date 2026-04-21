/**
 * Snapshot System - Git-based file tracking and revert
 *
 * Provides:
 * - Git-based snapshot creation for session files
 * - File diff tracking
 * - Restore from snapshot
 * - Incremental patch tracking per step (Claude Code-style)
 *
 * Reference: opencode/packages/opencode/src/snapshot/index.ts
 */

import { execSync } from 'child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname, relative } from 'path'
import { homedir } from 'os'

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

export interface SnapshotOptions {
  sessionId: string
  message?: string
  files?: string[]  // Specific files to track, or all if not specified
}

// ============================================================================
// Incremental Patch Tracking (Claude Code-style)
// ============================================================================

/**
 * Represents a single step's file changes
 */
export interface StepPatch {
  stepId: string
  sessionId: string
  createdAt: number
  files: PatchFile[]
}

/**
 * A single file change in a step
 */
export interface PatchFile {
  path: string
  status: 'added' | 'deleted' | 'modified'
  sizeBytes: number
  contentHash?: string
  diffSummary?: string
}

interface PatchState {
  patches: StepPatch[]
  currentStep: number
  baseHash: string
}

let patchState: PatchState = {
  patches: [],
  currentStep: 0,
  baseHash: '',
}

/**
 * Start tracking a new step
 */
export function startStep(sessionId: string): string {
  const stepId = `${sessionId}_step_${++patchState.currentStep}`
  return stepId
}

/**
 * Track file changes for the current step
 */
export function trackStepChanges(stepId: string, files: PatchFile[]): void {
  const existingIndex = patchState.patches.findIndex(p => p.stepId === stepId)
  const patch: StepPatch = {
    stepId,
    sessionId: stepId.split('_step_')[0],
    createdAt: Date.now(),
    files,
  }

  if (existingIndex >= 0) {
    patchState.patches[existingIndex] = patch
  } else {
    patchState.patches.push(patch)
  }
}

/**
 * Get all patches for the session
 */
export function getSessionPatches(sessionId: string): StepPatch[] {
  return patchState.patches.filter(p => p.sessionId === sessionId)
}

/**
 * Get the cumulative patch for a session
 */
export function getCumulativePatch(sessionId: string): PatchFile[] {
  const patches = getSessionPatches(sessionId)
  const fileMap = new Map<string, PatchFile>()

  for (const patch of patches) {
    for (const file of patch.files) {
      if (file.status === 'deleted') {
        fileMap.delete(file.path)
      } else {
        fileMap.set(file.path, file)
      }
    }
  }

  return Array.from(fileMap.values())
}

/**
 * Calculate patch summary for compact display
 */
export function getPatchSummary(sessionId: string): {
  totalFiles: number
  added: number
  modified: number
  deleted: number
  steps: number
} {
  const cumulative = getCumulativePatch(sessionId)
  const patches = getSessionPatches(sessionId)

  return {
    totalFiles: cumulative.length,
    added: cumulative.filter(f => f.status === 'added').length,
    modified: cumulative.filter(f => f.status === 'modified').length,
    deleted: cumulative.filter(f => f.status === 'deleted').length,
    steps: patches.length,
  }
}

/**
 * Reset patch state for a new session
 */
export function resetPatchState(): void {
  patchState = {
    patches: [],
    currentStep: 0,
    baseHash: '',
  }
}

// ============================================================================
// Snapshot Storage
// ============================================================================

const SNAPSHOT_DIR = join(homedir(), '.hybrid-agent', 'snapshots')

function ensureSnapshotDir(): void {
  if (!existsSync(SNAPSHOT_DIR)) {
    mkdirSync(SNAPSHOT_DIR, { recursive: true })
  }
}

// ============================================================================
// Git Operations
// ============================================================================

/**
 * Initialize a git repo for snapshots if not already initialized
 */
function ensureGitRepo(): void {
  ensureSnapshotDir()
  if (!existsSync(join(SNAPSHOT_DIR, '.git'))) {
    execSync('git init', { cwd: SNAPSHOT_DIR, stdio: 'ignore' })
    execSync('git config user.email "hybrid-agent@snapshot"', { cwd: SNAPSHOT_DIR, stdio: 'ignore' })
    execSync('git config user.name "Hybrid Agent"', { cwd: SNAPSHOT_DIR, stdio: 'ignore' })
  }
}

/**
 * Get the git working directory for snapshots
 */
function getGitDir(): string {
  return SNAPSHOT_DIR
}

/**
 * Stage files for commit
 */
function stageFiles(files: string[]): void {
  for (const file of files) {
    const fullPath = join(SNAPSHOT_DIR, file)
    if (existsSync(fullPath)) {
      execSync(`git add "${file}"`, { cwd: SNAPSHOT_DIR, stdio: 'ignore' })
    }
  }
}

/**
 * Create a commit with the given message
 */
function createCommit(message: string): string {
  try {
    execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd: SNAPSHOT_DIR, stdio: 'pipe' })
    const hash = execSync('git rev-parse HEAD', { cwd: SNAPSHOT_DIR, encoding: 'utf-8' }).trim()
    return hash
  } catch {
    return ''
  }
}

/**
 * Get the list of changed files since last commit
 */
function getChangedFiles(): string[] {
  try {
    const output = execSync('git diff --name-only HEAD', { cwd: SNAPSHOT_DIR, encoding: 'utf-8' })
    return output.trim().split('\n').filter(Boolean)
  } catch {
    return []
  }
}

/**
 * Get file status (added, modified, deleted)
 */
function getFileStatus(file: string): 'added' | 'modified' | 'deleted' | 'untracked' {
  try {
    const output = execSync(`git status --porcelain "${file}"`, { cwd: SNAPSHOT_DIR, encoding: 'utf-8' }).trim()
    if (!output) return 'modified'

    const status = output.substring(0, 2)
    if (status.includes('A') || status.includes('?')) return 'added'
    if (status.includes('D')) return 'deleted'
    return 'modified'
  } catch {
    return 'untracked'
  }
}

/**
 * Get diff for a specific file
 */
function getFileDiff(file: string): string {
  try {
    return execSync(`git diff "${file}"`, { cwd: SNAPSHOT_DIR, encoding: 'utf-8' })
  } catch {
    return ''
  }
}

/**
 * Get the diff between two commits
 */
function getDiffBetweenCommits(fromHash: string, toHash: string): FileDiff[] {
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

      return { path, status: statusType }
    })
  } catch {
    return []
  }
}

// ============================================================================
// Snapshot API
// ============================================================================

/**
 * Create a new snapshot
 */
export function createSnapshot(options: SnapshotOptions): Snapshot {
  ensureGitRepo()

  const { sessionId, message = 'Snapshot', files } = options
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
  patchState.baseHash = hash

  return snapshot
}

/**
 * Save snapshot metadata to file
 */
function saveSnapshotMetadata(snapshot: Snapshot): void {
  const metaPath = join(SNAPSHOT_DIR, '.snapshots', `${snapshot.hash}.json`)
  const metaDir = dirname(metaPath)
  if (!existsSync(metaDir)) {
    mkdirSync(metaDir, { recursive: true })
  }
  writeFileSync(metaPath, JSON.stringify(snapshot, null, 2))
}

/**
 * Get snapshot by hash
 */
export function getSnapshot(hash: string): Snapshot | undefined {
  const metaPath = join(SNAPSHOT_DIR, '.snapshots', `${hash}.json`)
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
 * Get all snapshots for a session
 */
export function getSessionSnapshots(sessionId: string): Snapshot[] {
  const metaDir = join(SNAPSHOT_DIR, '.snapshots')
  if (!existsSync(metaDir)) {
    return []
  }

  const snapshots: Snapshot[] = []

  return snapshots.sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * Get all snapshots
 */
export function listSnapshots(): Snapshot[] {
  const metaDir = join(SNAPSHOT_DIR, '.snapshots')
  if (!existsSync(metaDir)) {
    return []
  }

  const snapshots: Snapshot[] = []

  return snapshots.sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * Get the diff between two snapshots
 */
export function diffSnapshots(fromHash: string, toHash: string): FileDiff[] {
  return getDiffBetweenCommits(fromHash, toHash)
}

/**
 * Restore files from a snapshot
 */
export function restoreSnapshot(hash: string): { restored: string[]; errors: string[] } {
  const snapshot = getSnapshot(hash)
  if (!snapshot) {
    return { restored: [], errors: ['Snapshot not found'] }
  }

  const restored: string[] = []
  const errors: string[] = []

  try {
    execSync(`git checkout ${hash} -- .`, { cwd: SNAPSHOT_DIR, stdio: 'pipe' })
    restored.push(...snapshot.files)
  } catch (e: any) {
    errors.push(`Failed to restore: ${e.message}`)
  }

  return { restored, errors }
}

/**
 * Get file content at a specific snapshot
 */
export function getFileAtSnapshot(file: string, hash: string): string | undefined {
  try {
    const content = execSync(`git show ${hash}:${file}`, { cwd: SNAPSHOT_DIR, encoding: 'utf-8' })
    return content
  } catch {
    return undefined
  }
}

/**
 * Track a file copy in the snapshot directory
 */
export function trackFile(sourcePath: string, destPath: string): void {
  ensureGitRepo()

  const fullDestPath = join(SNAPSHOT_DIR, destPath)
  const destDir = dirname(fullDestPath)

  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true })
  }

  const content = readFileSync(sourcePath)
  writeFileSync(fullDestPath, content)
}

/**
 * Get current working tree status
 */
export function getWorkingTreeStatus(): {
  files: FileDiff[]
  hash: string
  hasChanges: boolean
} {
  const files = getChangedFiles().map((file) => ({
    path: file,
    status: getFileStatus(file) as FileDiff['status'],
    diff: getFileDiff(file),
  }))

  let hash = ''
  try {
    hash = execSync('git rev-parse HEAD', { cwd: SNAPSHOT_DIR, encoding: 'utf-8' }).trim()
  } catch {
    hash = ''
  }

  return {
    files,
    hash,
    hasChanges: files.length > 0,
  }
}

// ============================================================================
// Revert Support
// ============================================================================

export interface RevertInfo {
  snapshotHash: string
  messageID?: string
  partID?: string
  diff?: string
}

/**
 * Create a revert point before major changes
 */
export function createRevertPoint(sessionId: string, messageID?: string): RevertInfo {
  const status = getWorkingTreeStatus()

  if (!status.hasChanges) {
    return { snapshotHash: status.hash }
  }

  const snapshot = createSnapshot({
    sessionId,
    message: `Revert point${messageID ? ` for ${messageID}` : ''}`,
    files: status.files.map((f) => f.path),
  })

  return {
    snapshotHash: snapshot.hash,
    messageID,
    diff: status.files.map((f) => `${f.status}: ${f.path}`).join('\n'),
  }
}
