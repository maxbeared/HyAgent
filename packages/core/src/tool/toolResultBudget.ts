/**
 * Tool Result Budget System
 *
 * Inspired by Claude Code's content replacement mechanism:
 * - Tracks cumulative tool result sizes
 * - When output exceeds budget, persists to disk
 * - Returns a preview + file path to the model
 * - Model can use Task tool to explore full output
 *
 * This prevents context overflow from large tool outputs while
 * preserving access to the full data.
 */

import { promises as fs } from 'fs'
import path from 'path'

// ============================================================================
// Types
// ============================================================================

export interface ToolResultBudget {
  totalChars: number
  usedChars: number
  maxChars: number
  files: Map<string, BudgetFile>
}

export interface BudgetFile {
  path: string
  sizeChars: number
  createdAt: number
  toolName: string
}

export interface BudgetResult {
  content: string
  truncated: boolean
  preview?: string
  outputPath?: string
  budgetExceeded: boolean
}

export interface BudgetConfig {
  maxTotalChars: number
  maxFileSizeChars: number
  truncatePreviewChars: number
  retentionMs: number
  outputDir: string
}

const DEFAULT_CONFIG: BudgetConfig = {
  maxTotalChars: 50_000,       // 50KB total for tool outputs
  maxFileSizeChars: 100_000,   // 100KB before forcing to disk
  truncatePreviewChars: 2_000, // Preview shown to model
  retentionMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  outputDir: '.hyagent/tool-outputs',
}

// ============================================================================
// State
// ============================================================================

let globalBudget: ToolResultBudget = {
  totalChars: 0,
  usedChars: 0,
  maxChars: DEFAULT_CONFIG.maxTotalChars,
  files: new Map(),
}

let globalConfig: BudgetConfig = { ...DEFAULT_CONFIG }

// ============================================================================
// Configuration
// ============================================================================

export function setBudgetConfig(config: Partial<BudgetConfig>): void {
  globalConfig = { ...globalConfig, ...config }
  globalBudget.maxChars = globalConfig.maxTotalChars
}

export function getBudgetConfig(): BudgetConfig {
  return { ...globalConfig }
}

export function getBudgetState(): ToolResultBudget {
  return { ...globalBudget, files: new Map(globalBudget.files) }
}

export function resetBudget(): void {
  globalBudget = {
    totalChars: 0,
    usedChars: 0,
    maxChars: globalConfig.maxTotalChars,
    files: new Map(),
  }
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Process a tool result through the budget system.
 * Returns the content to send to the model (may be truncated or a preview).
 */
export async function processToolResult(
  toolName: string,
  content: string,
  input?: unknown,
): Promise<BudgetResult> {
  const contentLength = content.length

  // Check if content exceeds single-output threshold
  if (contentLength > globalConfig.maxFileSizeChars) {
    return persistLargeOutput(toolName, content, input)
  }

  // Check if adding this would exceed total budget
  if (globalBudget.usedChars + contentLength > globalBudget.maxChars) {
    return persistAndTruncate(toolName, content, input)
  }

  // Normal case: content fits in budget
  globalBudget.usedChars += contentLength
  return {
    content,
    truncated: false,
    budgetExceeded: false,
  }
}

/**
 * Persist a large output to disk and return a preview
 */
async function persistLargeOutput(
  toolName: string,
  content: string,
  input?: unknown,
): Promise<BudgetResult> {
  const { filePath, fileSize } = await persistToFile(toolName, content, input)

  const preview = content.slice(0, globalConfig.truncatePreviewChars)

  return {
    content: preview,
    truncated: true,
    preview: buildPreviewMessage(toolName, filePath, fileSize, preview),
    outputPath: filePath,
    budgetExceeded: true,
  }
}

/**
 * Persist content to disk and truncate to fit budget
 */
async function persistAndTruncate(
  toolName: string,
  content: string,
  input?: unknown,
): Promise<BudgetResult> {
  // First, try cleanup old files to make room
  await cleanupOldFiles()

  // Check again if we have room
  if (globalBudget.usedChars + content.length > globalBudget.maxChars) {
    // Still over budget, truncate content to fit
    const availableChars = globalBudget.maxChars - globalBudget.usedChars
    if (availableChars < globalConfig.truncatePreviewChars) {
      // Not enough room for even a preview, persist most of it
      const truncateAt = Math.min(availableChars, content.length)
      const truncatedContent = content.slice(0, truncateAt)
      const { filePath, fileSize } = await persistToFile(toolName, content, input)

      globalBudget.usedChars += truncatedContent.length

      return {
        content: truncatedContent + `\n\n[Output truncated - full result saved to: ${filePath}]`,
        truncated: true,
        outputPath: filePath,
        budgetExceeded: true,
      }
    }

    // Truncate to fit
    const truncatedContent = content.slice(0, availableChars)
    globalBudget.usedChars = globalBudget.maxChars

    return {
      content: truncatedContent + `\n\n[Output truncated due to budget - tool results budget exhausted]`,
      truncated: true,
      budgetExceeded: true,
    }
  }

  // We have room now after cleanup
  const { filePath, fileSize } = await persistToFile(toolName, content, input)
  globalBudget.usedChars += content.length

  const preview = content.slice(0, globalConfig.truncatePreviewChars)

  return {
    content: preview,
    truncated: true,
    preview: buildPreviewMessage(toolName, filePath, fileSize, preview),
    outputPath: filePath,
    budgetExceeded: true,
  }
}

/**
 * Persist content to a file
 */
async function persistToFile(
  toolName: string,
  content: string,
  input?: unknown,
): Promise<{ filePath: string; fileSize: number }> {
  const timestamp = Date.now()
  const id = crypto.randomUUID()
  const filename = `${toolName}_${timestamp}_${id.slice(0, 8)}.txt`
  const filePath = path.join(globalConfig.outputDir, filename)

  // Ensure directory exists
  await fs.mkdir(globalConfig.outputDir, { recursive: true })

  // Write metadata header
  const header = `Tool: ${toolName}\nTimestamp: ${new Date(timestamp).toISOString()}\nInput: ${JSON.stringify(input)}\n---\n\n`
  await fs.writeFile(filePath, header + content, 'utf-8')

  // Track the file
  globalBudget.files.set(filePath, {
    path: filePath,
    sizeChars: content.length,
    createdAt: timestamp,
    toolName,
  })

  globalBudget.totalChars += content.length

  return { filePath, fileSize: content.length }
}

/**
 * Build a preview message for truncated output
 */
function buildPreviewMessage(
  toolName: string,
  filePath: string,
  fileSize: number,
  preview: string,
): string {
  const sizeKB = (fileSize / 1024).toFixed(1)
  return `${preview}

---

[Output saved to file: ${filePath}]
[Full output: ${sizeKB} chars - ${fileSize.toLocaleString()} characters]

You can use the Task tool or Read tool to explore the full output.
DO NOT attempt to read the entire file directly - use grep or selective reading instead.`
}

/**
 * Read content from a persisted file
 */
export async function readPersistedOutput(
  filePath: string,
  offset?: number,
  limit?: number,
): Promise<string> {
  try {
    const content = await fs.readFile(filePath, 'utf-8')

    // Strip header if present
    const headerEnd = content.indexOf('---\n\n')
    const actualContent = headerEnd >= 0 ? content.slice(headerEnd + 5) : content

    if (offset !== undefined || limit !== undefined) {
      const lines = actualContent.split('\n')
      const start = offset ?? 0
      const end = limit !== undefined ? start + limit : lines.length
      return lines.slice(start, end).join('\n')
    }

    return actualContent
  } catch {
    return `[Error: Could not read ${filePath}]`
  }
}

/**
 * Cleanup old persisted files
 */
async function cleanupOldFiles(): Promise<void> {
  const now = Date.now()

  for (const [filePath, file] of globalBudget.files.entries()) {
    if (now - file.createdAt > globalConfig.retentionMs) {
      try {
        await fs.unlink(filePath)
        globalBudget.files.delete(filePath)
        globalBudget.usedChars -= file.sizeChars
        globalBudget.totalChars -= file.sizeChars
      } catch {
        // File might already be deleted, ignore
      }
    }
  }
}

/**
 * Get budget usage statistics
 */
export function getBudgetStats(): {
  usedChars: number
  maxChars: number
  usagePercent: number
  fileCount: number
  totalStoredChars: number
} {
  return {
    usedChars: globalBudget.usedChars,
    maxChars: globalBudget.maxChars,
    usagePercent: Math.round((globalBudget.usedChars / globalBudget.maxChars) * 100),
    fileCount: globalBudget.files.size,
    totalStoredChars: globalBudget.totalChars,
  }
}

/**
 * Suggest compaction when budget is high
 */
export function shouldSuggestCompaction(): boolean {
  const usagePercent = globalBudget.usedChars / globalBudget.maxChars
  return usagePercent > 0.8 // Suggest compaction at 80% usage
}
