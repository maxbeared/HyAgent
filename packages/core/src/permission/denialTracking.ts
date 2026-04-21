/**
 * Denial Tracking System
 *
 * Inspired by Claude Code's denial tracking mechanism:
 * Tracks permission denials over time and helps the system make
 * better decisions when the user consistently denies or allows certain operations.
 *
 * Key insight: If a user denies the same operation multiple times,
 * they probably want to always deny it. Instead of asking repeatedly,
 * we can learn from their patterns.
 */

import type { PermissionDecision } from './types.js'

// ============================================================================
// Types
// ============================================================================

export interface DenialRecord {
  toolName: string
  pattern: string
  count: number
  firstDenial: number
  lastDenial: number
  userId?: string
}

export interface DenialTrackingState {
  denials: Map<string, DenialRecord>
  threshold: number
  windowMs: number  // Time window for counting denials
}

export interface DenialTrackingResult {
  decision: 'continue' | 'upgrade_to_always' | 'downgrade_to_allow'
  reason: string
  record?: DenialRecord
}

// Key format: "toolName:pattern"
function makeKey(toolName: string, pattern: string): string {
  return `${toolName}:${pattern}`
}

// ============================================================================
// State Management
// ============================================================================

let globalDenialState: DenialTrackingState = {
  denials: new Map(),
  threshold: 3,  // After 3 denials, suggest always deny
  windowMs: 5 * 60 * 1000,  // 5 minute window
}

export function getDenialTrackingState(): DenialTrackingState {
  return globalDenialState
}

export function resetDenialTracking(): void {
  globalDenialState = {
    denials: new Map(),
    threshold: 3,
    windowMs: 5 * 60 * 1000,
  }
}

export function setDenialThreshold(threshold: number): void {
  globalDenialState.threshold = threshold
}

export function setDenialWindow(windowMs: number): void {
  globalDenialState.windowMs = windowMs
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Record a denial event
 */
export function recordDenial(toolName: string, pattern: string, userId?: string): void {
  const key = makeKey(toolName, pattern)
  const now = Date.now()

  const existing = globalDenialState.denials.get(key)
  if (existing) {
    existing.count++
    existing.lastDenial = now
    if (userId) existing.userId = userId
  } else {
    globalDenialState.denials.set(key, {
      toolName,
      pattern,
      count: 1,
      firstDenial: now,
      lastDenial: now,
      userId,
    })
  }

  // Cleanup old entries outside the window
  cleanupOldDenials()
}

/**
 * Record an allow event - reduces denial count
 */
export function recordAllow(toolName: string, pattern: string): void {
  const key = makeKey(toolName, pattern)
  const existing = globalDenialState.denials.get(key)

  if (existing) {
    // Reduce count but don't remove completely
    existing.count = Math.max(0, existing.count - 1)
    if (existing.count === 0) {
      globalDenialState.denials.delete(key)
    }
  }
}

/**
 * Check the current denial status for a tool+pattern
 */
export function getDenialStatus(toolName: string, pattern: string): DenialTrackingResult {
  const key = makeKey(toolName, pattern)
  const now = Date.now()
  const record = globalDenialState.denials.get(key)

  if (!record) {
    return {
      decision: 'continue',
      reason: 'No denial history',
    }
  }

  // Check if outside time window
  if (now - record.lastDenial > globalDenialState.windowMs) {
    // Outside window, reset
    globalDenialState.denials.delete(key)
    return {
      decision: 'continue',
      reason: 'Denial history expired',
    }
  }

  // Check threshold
  if (record.count >= globalDenialState.threshold) {
    return {
      decision: 'upgrade_to_always',
      reason: `User has denied "${toolName}" with pattern "${pattern}" ${record.count} times. Consider always denying.`,
      record,
    }
  }

  return {
    decision: 'continue',
    reason: `Denial count: ${record.count}/${globalDenialState.threshold}`,
    record,
  }
}

/**
 * Process a permission decision and update tracking
 */
export function processPermissionDecision(
  toolName: string,
  pattern: string,
  decision: PermissionDecision,
  userId?: string,
): void {
  if (decision.behavior === 'deny') {
    recordDenial(toolName, pattern, userId)
  } else if (decision.behavior === 'allow') {
    recordAllow(toolName, pattern)
  }
  // 'ask' doesn't change tracking
}

/**
 * Cleanup entries outside the time window
 */
function cleanupOldDenials(): void {
  const now = Date.now()
  for (const [key, record] of globalDenialState.denials.entries()) {
    if (now - record.lastDenial > globalDenialState.windowMs) {
      globalDenialState.denials.delete(key)
    }
  }
}

// ============================================================================
// Suggestions
// ============================================================================

export interface DenialSuggestion {
  toolName: string
  pattern: string
  suggestedAction: 'allow' | 'deny'
  reason: string
  confidence: 'high' | 'medium' | 'low'
}

/**
 * Get suggestions for permission rules based on denial history
 */
export function getDenialSuggestions(): DenialSuggestion[] {
  const suggestions: DenialSuggestion[] = []

  for (const record of globalDenialState.denials.values()) {
    if (record.count >= globalDenialState.threshold) {
      suggestions.push({
        toolName: record.toolName,
        pattern: record.pattern,
        suggestedAction: 'deny',
        reason: `Denied ${record.count} times in recent window`,
        confidence: record.count >= globalDenialState.threshold * 2 ? 'high' : 'medium',
      })
    }
  }

  return suggestions
}

// ============================================================================
// Persistence (Optional)
// ============================================================================

interface PersistedDenialState {
  denials: Array<[string, DenialRecord]>
  threshold: number
  windowMs: number
}

export function serializeDenialState(): string {
  return JSON.stringify({
    denials: Array.from(globalDenialState.denials.entries()),
    threshold: globalDenialState.threshold,
    windowMs: globalDenialState.windowMs,
  })
}

export function deserializeDenialState(data: string): void {
  try {
    const parsed: PersistedDenialState = JSON.parse(data)
    globalDenialState = {
      denials: new Map(parsed.denials),
      threshold: parsed.threshold,
      windowMs: parsed.windowMs,
    }
  } catch {
    // Invalid data, keep default state
  }
}
