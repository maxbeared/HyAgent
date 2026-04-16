/**
 * Coordinator Types - 多Agent协作类型定义
 *
 * 参考来源:
 * - Anthropic-Leaked-Source-Code/coordinator/coordinatorMode.ts
 * - Anthropic-Leaked-Source-Code/tools/AgentTool.tsx
 * - Anthropic-Leaked-Source-Code/Task.ts
 */

import type { Effect, Fiber } from 'effect'
import type { Ruleset, PermissionContext } from '../../permission/types.js'

// ============================================================================
// Worker Types
// ============================================================================

/**
 * Worker configuration
 */
export interface WorkerConfig {
  id: string
  name: string
  prompt: string
  tools: string[] | ['*']
  maxTurns?: number
  permissions: Ruleset
  model?: string
}

/**
 * Worker state
 */
export type WorkerStatus = 'pending' | 'running' | 'completed' | 'failed' | 'killed'

/**
 * Worker handle returned from spawn
 */
export interface WorkerHandle {
  id: string
  name: string
  fiber: Fiber.Fiber<WorkerResult>
  status: WorkerStatus
  sendMessage: (msg: string) => Effect.Effect<void>
  kill: () => Effect.Effect<void>
}

/**
 * Worker result when completed
 */
export interface WorkerResult {
  id: string
  status: WorkerStatus
  output?: string
  error?: string
  tokenUsage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
  toolUses: number
  durationMs: number
}

// ============================================================================
// Message Types
// ============================================================================

/**
 * Message sent to/from workers
 */
export interface WorkerMessage {
  id: string
  from: string
  to: string
  content: string
  timestamp: number
  type: 'text' | 'shutdown_request' | 'shutdown_response' | 'plan_approval_request'
}

/**
 * Structured message types for inter-agent communication
 * 来自: Anthropic-Leaked-Source-Code/tools/SendMessageTool.ts
 */
export type StructuredMessage =
  | { type: 'shutdown_request'; reason?: string; request_id?: string }
  | { type: 'shutdown_response'; request_id: string; approve: boolean; reason?: string }
  | { type: 'plan_approval_request'; request_id: string; feedback?: string }
  | { type: 'plan_approval_response'; request_id: string; approve: boolean; feedback?: string }

// ============================================================================
// Phase Types
// ============================================================================

/**
 * Coordinator phases for workflow
 */
export type CoordinatorPhase = 'research' | 'synthesis' | 'implementation' | 'verification'

/**
 * Phase configuration
 */
export interface PhaseConfig {
  phase: CoordinatorPhase
  description: string
  maxWorkers?: number
  parallel?: boolean
}

/**
 * Phase result
 */
export interface PhaseResult {
  phase: CoordinatorPhase
  workers: WorkerResult[]
  output: string
  durationMs: number
}

// ============================================================================
// Coordinator Types
// ============================================================================

/**
 * Coordinator result after running all phases
 */
export interface CoordinatorResult {
  task: string
  phases: PhaseResult[]
  totalDurationMs: number
  finalOutput: string
}

/**
 * Coordinator events for streaming
 */
export type CoordinatorEvent =
  | { type: 'phase_start'; phase: CoordinatorPhase }
  | { type: 'worker_spawn'; workerId: string; workerName: string }
  | { type: 'worker_message'; workerId: string; message: string }
  | { type: 'worker_complete'; workerId: string; result: WorkerResult }
  | { type: 'phase_complete'; phase: CoordinatorPhase; result: PhaseResult }
  | { type: 'coordinator_message'; message: string }
  | { type: 'error'; error: string }

/**
 * Coordinator configuration
 */
export interface CoordinatorConfig {
  maxWorkers?: number
  phases?: PhaseConfig[]
  defaultPermissions?: Ruleset
  defaultTools?: string[]
}

// ============================================================================
// Agent Types (shared)
// ============================================================================

/**
 * Agent type identifier
 */
export type AgentType =
  | 'build'
  | 'plan'
  | 'general'
  | 'explore'
  | 'coordinator'
  | 'worker'

/**
 * Agent info definition
 */
export interface AgentInfo {
  name: string
  type: AgentType
  description?: string
  tools: string[] | ['*']
  permissions: Ruleset
  model?: string
  maxTurns?: number
  coordinator?: {
    enabled: boolean
    phases?: CoordinatorPhase[]
    maxWorkers?: number
  }
}
