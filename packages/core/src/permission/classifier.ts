/**
 * YOLO Permission Classifier
 *
 * 自动学习用户授权模式，预测性地批准或拒绝操作。
 * 基于历史授权记录训练简单规则，减少交互式确认。
 *
 * 参考来源:
 * - Anthropic-Leaked-Source-Code/utils/permissions/yoloClassifier.ts
 */

import { z } from 'zod'

// ============================================================================
// Types
// ============================================================================

/**
 * Permission decision
 */
export type PermissionDecision = 'allow' | 'deny' | 'ask'

/**
 * Classification result
 */
export interface ClassificationResult {
  decision: PermissionDecision
  confidence: number       // 0-1, how confident the classifier is
  matchedRule?: string     // Description of the matched rule
  reason?: string          // Human-readable reason
}

/**
 * Permission event record
 */
export interface PermissionEvent {
  tool: string
  input: string            // Stringified input
  path?: string            // If file-related
  command?: string         // If bash-related
  decision: PermissionDecision
  timestamp: number
}

/**
 * Classifier rule
 */
interface ClassifierRule {
  pattern: string          // Pattern to match
  patternType: 'glob' | 'regex' | 'exact'
  decision: PermissionDecision
  tool?: string            // Optional tool filter
  count: number             // How many times this matched
  lastMatched: number
}

/**
 * YOLO Classifier state
 */
interface YOLOState {
  rules: ClassifierRule[]
  events: PermissionEvent[]
  allowCount: number
  denyCount: number
  askCount: number
}

// ============================================================================
// Pattern Matching
// ============================================================================

/**
 * Match a string against a pattern
 */
function matchPattern(str: string, pattern: string, patternType: 'glob' | 'regex' | 'exact'): boolean {
  switch (patternType) {
    case 'exact':
      return str === pattern

    case 'glob': {
      // Simple glob matching (no regex)
      const regexPattern = pattern
        .replace(/\./g, '\\.')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.')
      return new RegExp(`^${regexPattern}$`).test(str)
    }

    case 'regex':
      try {
        return new RegExp(pattern).test(str)
      } catch {
        return false
      }
  }
}

/**
 * Extract path from tool input
 */
function extractPath(input: unknown): string | undefined {
  if (!input) return undefined

  if (typeof input === 'string') return input

  if (typeof input === 'object') {
    const obj = input as Record<string, unknown>
    // Common path fields
    for (const field of ['path', 'file', 'file_path', 'target', 'source']) {
      if (typeof obj[field] === 'string') {
        return obj[field] as string
      }
    }
  }

  return undefined
}

/**
 * Extract command from bash input
 */
function extractCommand(input: unknown): string | undefined {
  if (!input) return undefined

  if (typeof input === 'string') return input

  if (typeof input === 'object') {
    const obj = input as Record<string, unknown>
    if (typeof obj.command === 'string') {
      return obj.command as string
    }
  }

  return undefined
}

// ============================================================================
// YOLO Classifier
// ============================================================================

/**
 * YOLO Permission Classifier
 *
 * Learns from user decisions over time and predicts future decisions.
 */
export class YOLOClassifier {
  private state: YOLOState
  private persistPath?: string

  constructor(persistPath?: string) {
    this.persistPath = persistPath
    this.state = {
      rules: [],
      events: [],
      allowCount: 0,
      denyCount: 0,
      askCount: 0,
    }

    // Try to load persisted state
    if (persistPath) {
      this.load()
    }
  }

  /**
   * Record a permission decision
   */
  record(event: PermissionEvent): void {
    // Add to events
    this.state.events.push(event)

    // Update counts
    switch (event.decision) {
      case 'allow': this.state.allowCount++; break
      case 'deny': this.state.denyCount++; break
      case 'ask': this.state.askCount++; break
    }

    // Only learn from explicit allow/deny, not 'ask'
    if (event.decision === 'ask') {
      this.persist()
      return
    }

    // Try to learn a pattern
    this.learn(event)

    // Persist periodically
    if (this.state.events.length % 10 === 0) {
      this.persist()
    }
  }

  /**
   * Classify an incoming permission request
   */
  classify(tool: string, input: unknown): ClassificationResult {
    const inputStr = JSON.stringify(input)
    const path = extractPath(input)
    const command = extractCommand(input)

    // Check existing rules
    for (const rule of this.state.rules) {
      // Check tool match if specified
      if (rule.tool && rule.tool !== tool) continue

      // Check pattern match
      // Note: patternType is 'glob' | 'regex' | 'exact', never 'command'
      const target = (path ?? inputStr)
      if (!target) continue

      if (matchPattern(target, rule.pattern, rule.patternType as 'glob' | 'regex' | 'exact')) {
        return {
          decision: rule.decision,
          confidence: Math.min(0.9, 0.5 + rule.count * 0.1), // 0.5-0.9 based on count
          matchedRule: `${rule.patternType}:${rule.pattern}`,
          reason: `Matched ${rule.patternType} pattern: ${rule.pattern}`,
        }
      }
    }

    // No match found - use fallback based on overall statistics
    const total = this.state.allowCount + this.state.denyCount
    if (total > 5) {
      // If we have enough data, use overall probability
      const allowRate = this.state.allowCount / total
      if (allowRate > 0.8) {
        return {
          decision: 'allow',
          confidence: allowRate * 0.5, // Lower confidence for fallback
          reason: 'Fallback: high historical allow rate',
        }
      } else if (allowRate < 0.2) {
        return {
          decision: 'deny',
          confidence: (1 - allowRate) * 0.5,
          reason: 'Fallback: high historical deny rate',
        }
      }
    }

    // Default to 'ask' with low confidence
    return {
      decision: 'ask',
      confidence: 0.1,
      reason: 'No matching rules found, defaulting to ask',
    }
  }

  /**
   * Learn a new rule from a permission event
   */
  private learn(event: PermissionEvent): void {
    const path = extractPath(event.input) ?? extractCommand(event.input)
    if (!path) return

    // Try to find a pattern
    let pattern = ''
    let patternType: 'glob' | 'regex' | 'exact' = 'exact'

    // Extract useful pattern from path
    if (event.path || event.command) {
      const target = event.path ?? event.command!

      // Extract directory pattern
      if (target.includes('/')) {
        const dir = target.split('/').slice(0, -1).join('/')
        if (dir.length > 3) {
          pattern = dir + '/*'
          patternType = 'glob'
        }
      }

      // Extract file extension
      const extMatch = target.match(/\.([^.]+)$/)
      if (extMatch) {
        const extPattern = `*.${extMatch[1]}`
        // Check if this pattern already exists
        const existing = this.state.rules.find(
          r => r.pattern === extPattern && r.decision === event.decision
        )
        if (!existing) {
          this.state.rules.push({
            pattern: extPattern,
            patternType: 'glob',
            decision: event.decision,
            tool: event.tool,
            count: 1,
            lastMatched: Date.now(),
          })
        } else {
          existing.count++
          existing.lastMatched = Date.now()
        }
      }
    }

    // Add directory pattern if found
    if (pattern && patternType === 'glob') {
      const existing = this.state.rules.find(
        r => r.pattern === pattern && r.decision === event.decision
      )
      if (!existing) {
        this.state.rules.push({
          pattern,
          patternType,
          decision: event.decision,
          tool: event.tool,
          count: 1,
          lastMatched: Date.now(),
        })
      } else {
        existing.count++
        existing.lastMatched = Date.now()
      }
    }
  }

  /**
   * Persist state to disk
   */
  private persist(): void {
    if (!this.persistPath) return

    try {
      const { writeFileSync } = require('fs')
      writeFileSync(this.persistPath, JSON.stringify(this.state, null, 2), 'utf-8')
    } catch {
      // Silently fail if persistence fails
    }
  }

  /**
   * Load state from disk
   */
  private load(): void {
    if (!this.persistPath) return

    try {
      const { existsSync, readFileSync } = require('fs')
      if (existsSync(this.persistPath)) {
        const data = readFileSync(this.persistPath, 'utf-8')
        const parsed = JSON.parse(data)
        this.state = {
          rules: parsed.rules || [],
          events: parsed.events || [],
          allowCount: parsed.allowCount || 0,
          denyCount: parsed.denyCount || 0,
          askCount: parsed.askCount || 0,
        }
      }
    } catch {
      // Silently fail if loading fails
    }
  }

  /**
   * Get classifier statistics
   */
  getStats(): { rules: number; events: number; allowRate: number } {
    const total = this.state.allowCount + this.state.denyCount + this.state.askCount
    return {
      rules: this.state.rules.length,
      events: this.state.events.length,
      allowRate: total > 0 ? this.state.allowCount / total : 0,
    }
  }

  /**
   * Reset learned data
   */
  reset(): void {
    this.state = {
      rules: [],
      events: [],
      allowCount: 0,
      denyCount: 0,
      askCount: 0,
    }
    if (this.persistPath) {
      try {
        const { unlinkSync } = require('fs')
        unlinkSync(this.persistPath)
      } catch {
        // Silently fail
      }
    }
  }
}

// Singleton instance
let classifierInstance: YOLOClassifier | null = null

/**
 * Get the YOLO classifier singleton
 */
export function getYOLOClassifier(): YOLOClassifier {
  if (!classifierInstance) {
    classifierInstance = new YOLOClassifier()
  }
  return classifierInstance
}
