/**
 * Comprehensive Agent Hooks
 *
 * useCanUseTool, useTypeahead, useScheduledTasks, and more React-style hooks.
 *
 * Reference: Anthropic-Leaked-Source-Code/hooks/
 */

import { Effect, Ref } from 'effect'
import { z } from 'zod'
import { randomUUID } from 'crypto'

// ============================================================================
// Hook Context Types
// ============================================================================

export interface HookContext {
  sessionId?: string
  task?: string
  agentId?: string
  timestamp: number
}

export interface TurnEndContext extends HookContext {
  turnNumber: number
  stopReason?: string
  toolCalls: Array<{
    name: string
    input: unknown
    output?: string
  }>
  text?: string
  messageCount: number
}

export interface TaskCompleteContext extends HookContext {
  result: 'success' | 'failed' | 'stopped'
  stopReason?: string
  iterations: number
  output?: string
  error?: string
}

export interface IterationContext extends HookContext {
  iteration: number
  stopReason?: string
  hasErrors: boolean
}

export interface ErrorContext extends HookContext {
  error: string
  iteration: number
  fatal: boolean
}

export interface ToolContext extends HookContext {
  tool: string
  input: unknown
  result?: unknown
  allowed: boolean
  reason?: string
}

// ============================================================================
// Hook Result Types
// ============================================================================

export interface HookResult {
  stop?: boolean
  stopReason?: string
  message?: string
  modifyResponse?: unknown
}

export interface ToolCheckResult {
  allowed: boolean
  reason?: string
}

export interface TypeaheadResult {
  completions: string[]
  selectedIndex?: number
}

// ============================================================================
// useCanUseTool Hook
// ============================================================================

type ToolChecker = (context: ToolContext) => ToolCheckResult | Promise<ToolCheckResult>

export function createCanUseToolHook(checker: ToolChecker) {
  return {
    name: 'useCanUseTool' as const,
    async check(context: ToolContext): Promise<ToolCheckResult> {
      return checker(context)
    },
  }
}

// ============================================================================
// useTypeahead Hook
// ============================================================================

type TypeaheadProvider = (context: HookContext & { partial: string }) => TypeaheadResult | Promise<TypeaheadResult>

export function createTypeaheadHook(provider: TypeaheadProvider) {
  return {
    name: 'useTypeahead' as const,
    async getCompletions(context: HookContext & { partial: string }): Promise<TypeaheadResult> {
      return provider(context)
    },
  }
}

// ============================================================================
// useScheduledTasks Hook
// ============================================================================

export interface ScheduledTask {
  id: string
  name: string
  callback: () => void | Promise<void>
  interval: number  // ms
  maxRuns?: number
  runs: number
  nextRun: number
  enabled: boolean
}

export interface ScheduledTasksHook {
  name: 'useScheduledTasks'
  schedule(task: Omit<ScheduledTask, 'id' | 'runs' | 'nextRun'>): string
  unschedule(taskId: string): void
  pause(taskId: string): void
  resume(taskId: string): void
  list(): ScheduledTask[]
  pauseAll(): void
  resumeAll(): void
}

export function createScheduledTasksHook() {
  const tasks = new Map<string, ScheduledTask>()
  let intervalId: NodeJS.Timeout | null = null

  const processTasks = () => {
    const now = Date.now()
    for (const task of tasks.values()) {
      if (!task.enabled) continue
      if (task.nextRun > now) continue
      if (task.maxRuns && task.runs >= task.maxRuns) {
        tasks.delete(task.id)
        continue
      }

      try {
        task.callback()
        task.runs++
        task.nextRun = now + task.interval
      } catch (e) {
        console.error(`[ScheduledTask] Error in ${task.name}:`, e)
      }
    }
  }

  const ensureInterval = () => {
    if (!intervalId) {
      intervalId = setInterval(processTasks, 100)
    }
  }

  const hook: ScheduledTasksHook = {
    name: 'useScheduledTasks',

    schedule(task) {
      const id = randomUUID()
      tasks.set(id, {
        ...task,
        id,
        runs: 0,
        nextRun: Date.now() + task.interval,
      })
      ensureInterval()
      return id
    },

    unschedule(id) {
      tasks.delete(id)
    },

    pause(id) {
      const task = tasks.get(id)
      if (task) {
        task.enabled = false
      }
    },

    resume(id) {
      const task = tasks.get(id)
      if (task) {
        task.enabled = true
        task.nextRun = Date.now() + task.interval
      }
    },

    list() {
      return Array.from(tasks.values())
    },

    pauseAll() {
      for (const task of tasks.values()) {
        task.enabled = false
      }
    },

    resumeAll() {
      const now = Date.now()
      for (const task of tasks.values()) {
        task.enabled = true
        task.nextRun = now + task.interval
      }
    },
  }

  return hook
}

// ============================================================================
// useWorkspaceInfo Hook
// ============================================================================

export interface WorkspaceInfo {
  rootPath: string
  gitBranch?: string
  gitStatus?: {
    ahead: number
    behind: number
    changed: number
    conflicted: number
  }
  openFiles: string[]
  focusedFile?: string
}

export function createWorkspaceInfoHook(getter: () => WorkspaceInfo | Promise<WorkspaceInfo>) {
  return {
    name: 'useWorkspaceInfo' as const,
    async get(): Promise<WorkspaceInfo> {
      return getter()
    },
  }
}

// ============================================================================
// useAgentStatus Hook
// ============================================================================

export interface AgentStatus {
  agentId: string
  status: 'idle' | 'running' | 'paused' | 'stopped'
  currentTask?: string
  progress?: number
  iterations: number
  memoryUsage?: number
}

export function createAgentStatusHook(updater: Ref.Ref<AgentStatus>) {
  return {
    name: 'useAgentStatus' as const,
    async get(): Promise<AgentStatus> {
      return Ref.get(updater).pipe(Effect.runPromise)
    },
    async update(status: Partial<AgentStatus>): Promise<void> {
      const current = await Effect.runPromise(Ref.get(updater))
      await Effect.runPromise(Ref.set(updater, { ...current, ...status }))
    },
  }
}

// ============================================================================
// usePermission Hook
// ============================================================================

export interface PermissionRequest {
  type: 'bash' | 'read' | 'write' | 'network' | 'process'
  paths?: string[]
  command?: string
  url?: string
}

export interface PermissionResult {
  granted: boolean
  reason?: string
  tempDuration?: number
}

type PermissionChecker = (request: PermissionRequest) => PermissionResult | Promise<PermissionResult>

export function createPermissionHook(checker: PermissionChecker) {
  return {
    name: 'usePermission' as const,
    async check(request: PermissionRequest): Promise<PermissionResult> {
      return checker(request)
    },
  }
}

// ============================================================================
// useNotification Hook
// ============================================================================

export interface NotificationOptions {
  type: 'info' | 'success' | 'warning' | 'error'
  title: string
  message: string
  duration?: number
  priority?: 'low' | 'normal' | 'high' | 'urgent'
}

type NotificationHandler = (options: NotificationOptions) => void

export function createNotificationHook(handler: NotificationHandler) {
  return {
    name: 'useNotification' as const,
    notify(options: NotificationOptions): void {
      handler(options)
    },
  }
}

// ============================================================================
// useMetrics Hook
// ============================================================================

export interface AgentMetrics {
  totalTokens: number
  promptTokens: number
  completionTokens: number
  totalCost: number
  toolCalls: number
  errors: number
  avgResponseTime: number
  totalIterations: number
  sessionDuration: number
}

export function createMetricsHook() {
  const metrics: AgentMetrics = {
    totalTokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalCost: 0,
    toolCalls: 0,
    errors: 0,
    avgResponseTime: 0,
    totalIterations: 0,
    sessionDuration: 0,
  }

  let responseTimes: number[] = []

  return {
    name: 'useMetrics' as const,

    recordTokens(prompt: number, completion: number) {
      metrics.promptTokens += prompt
      metrics.completionTokens += completion
      metrics.totalTokens += prompt + completion
    },

    recordCost(cost: number) {
      metrics.totalCost += cost
    },

    recordToolCall() {
      metrics.toolCalls++
    },

    recordError() {
      metrics.errors++
    },

    recordResponseTime(ms: number) {
      responseTimes.push(ms)
      metrics.avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
    },

    recordIteration() {
      metrics.totalIterations++
    },

    getMetrics(): AgentMetrics {
      return { ...metrics }
    },

    reset() {
      Object.assign(metrics, {
        totalTokens: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalCost: 0,
        toolCalls: 0,
        errors: 0,
        avgResponseTime: 0,
        totalIterations: 0,
        sessionDuration: 0,
      })
      responseTimes = []
    },
  }
}

// ============================================================================
// Comprehensive Hooks Registry
// ============================================================================

export interface ComprehensiveHooks {
  // Core hooks
  useCanUseTool?: ReturnType<typeof createCanUseToolHook>
  useTypeahead?: ReturnType<typeof createTypeaheadHook>
  useScheduledTasks?: ScheduledTasksHook
  useWorkspaceInfo?: ReturnType<typeof createWorkspaceInfoHook>
  useAgentStatus?: ReturnType<typeof createAgentStatusHook>
  usePermission?: ReturnType<typeof createPermissionHook>
  useNotification?: ReturnType<typeof createNotificationHook>
  useMetrics?: ReturnType<typeof createMetricsHook>

  // Lifecycle hooks (from original)
  onTurnEnd?: (context: TurnEndContext) => HookResult | void | Promise<HookResult | void>
  onTaskComplete?: (context: TaskCompleteContext) => void | Promise<void>
  onIterationStart?: (context: IterationContext) => void | Promise<void>
  onIterationEnd?: (context: IterationContext) => void | Promise<void>
  onError?: (context: ErrorContext) => void | Promise<void>
  onBeforeTool?: (context: ToolContext) => void | Promise<void>
  onAfterTool?: (context: ToolContext) => void | Promise<void>
}

/**
 * Comprehensive hooks registry
 */
export class ComprehensiveHooksRegistry {
  private hooks: ComprehensiveHooks[] = []

  register(hooks: ComprehensiveHooks): void {
    this.hooks.push(hooks)
  }

  unregister(hooks: ComprehensiveHooks): void {
    const index = this.hooks.indexOf(hooks)
    if (index !== -1) {
      this.hooks.splice(index, 1)
    }
  }

  // Tool check
  async checkTool(context: ToolContext): Promise<ToolCheckResult> {
    for (const h of this.hooks) {
      if (h.useCanUseTool) {
        const result = await h.useCanUseTool.check(context)
        if (!result.allowed) return result
      }
    }
    return { allowed: true }
  }

  // Typeahead
  async getTypeahead(context: HookContext & { partial: string }): Promise<TypeaheadResult> {
    for (const h of this.hooks) {
      if (h.useTypeahead) {
        return h.useTypeahead.getCompletions(context)
      }
    }
    return { completions: [] }
  }

  // Scheduled tasks
  getScheduledTasks(): ScheduledTasksHook | undefined {
    for (const h of this.hooks) {
      if (h.useScheduledTasks) {
        return h.useScheduledTasks
      }
    }
    return undefined
  }

  // Metrics
  getMetrics(): AgentMetrics | undefined {
    for (const h of this.hooks) {
      if (h.useMetrics) {
        return h.useMetrics.getMetrics()
      }
    }
    return undefined
  }

  // Lifecycle hooks
  async executeTurnEnd(context: TurnEndContext): Promise<HookResult | void> {
    for (const h of this.hooks) {
      if (h.onTurnEnd) {
        const result = await h.onTurnEnd(context)
        if (result && result.stop) return result
      }
    }
  }

  async executeTaskComplete(context: TaskCompleteContext): Promise<void> {
    for (const h of this.hooks) {
      if (h.onTaskComplete) await h.onTaskComplete(context)
    }
  }

  async executeIterationStart(context: IterationContext): Promise<void> {
    for (const h of this.hooks) {
      if (h.onIterationStart) await h.onIterationStart(context)
    }
  }

  async executeIterationEnd(context: IterationContext): Promise<void> {
    for (const h of this.hooks) {
      if (h.onIterationEnd) await h.onIterationEnd(context)
    }
  }

  async executeError(context: ErrorContext): Promise<void> {
    for (const h of this.hooks) {
      if (h.onError) await h.onError(context)
    }
  }

  async executeBeforeTool(context: ToolContext): Promise<void> {
    for (const h of this.hooks) {
      if (h.onBeforeTool) await h.onBeforeTool(context)
    }
  }

  async executeAfterTool(context: ToolContext): Promise<void> {
    for (const h of this.hooks) {
      if (h.onAfterTool) await h.onAfterTool(context)
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let comprehensiveRegistryInstance: ComprehensiveHooksRegistry | null = null

export function getComprehensiveHooksRegistry(): ComprehensiveHooksRegistry {
  if (!comprehensiveRegistryInstance) {
    comprehensiveRegistryInstance = new ComprehensiveHooksRegistry()
  }
  return comprehensiveRegistryInstance
}

// ============================================================================
// Built-in Hooks Factories
// ============================================================================

export function createLoggingHooks(prefix: string): ComprehensiveHooks {
  return {
    onTurnEnd: (ctx) => {
      console.log(`[${prefix}] Turn ${ctx.turnNumber} ended: ${ctx.stopReason || 'unknown'}`)
    },
    onTaskComplete: (ctx) => {
      console.log(`[${prefix}] Task ${ctx.result} after ${ctx.iterations} iterations`)
    },
    onIterationStart: (ctx) => {
      console.log(`[${prefix}] Iteration ${ctx.iteration} started`)
    },
    onIterationEnd: (ctx) => {
      if (ctx.hasErrors) {
        console.log(`[${prefix}] Iteration ${ctx.iteration} ended with errors`)
      }
    },
    onError: (ctx) => {
      console.error(`[${prefix}] Error at iteration ${ctx.iteration}: ${ctx.error}`)
    },
  }
}
