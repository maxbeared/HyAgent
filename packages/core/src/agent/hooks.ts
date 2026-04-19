/**
 * Agent Hooks - 生命周期钩子
 *
 * 提供Agent执行过程中的钩子点:
 * - onTurnEnd: 每个turn结束时
 * - onTaskComplete: 任务完成时
 * - onIteration: 每次迭代时
 * - onError: 发生错误时
 *
 * 参考来源: Anthropic-Leaked-Source-Code/query/stopHooks.ts
 */

/**
 * Hook context passed to all hooks
 */
export interface HookContext {
  sessionId?: string
  task?: string
  iterations?: number
  messages?: unknown[]
}

/**
 * Hook result - can modify agent behavior
 */
export interface HookResult {
  /**
   * If true, the agent should stop
   */
  stop?: boolean

  /**
   * Optional stop reason
   */
  stopReason?: string

  /**
   * Optional message to append
   */
  message?: string
}

/**
 * Turn end hook context
 */
export interface TurnEndContext extends HookContext {
  turnNumber: number
  stopReason?: string
  toolCalls: Array<{
    name: string
    input: unknown
    output?: string
  }>
  text?: string
}

/**
 * Task complete hook context
 */
export interface TaskCompleteContext extends HookContext {
  result: 'success' | 'failed' | 'stopped'
  stopReason?: string
  iterations: number
  output?: string
  error?: string
}

/**
 * Iteration hook context
 */
export interface IterationContext extends HookContext {
  iteration: number
  stopReason?: string
  hasErrors?: boolean
}

/**
 * Error hook context
 */
export interface ErrorContext extends HookContext {
  error: string
  iteration: number
  fatal: boolean
}

/**
 * Agent hooks interface
 */
export interface AgentHooks {
  /**
   * Called at the end of each turn
   */
  onTurnEnd?: (context: TurnEndContext) => HookResult | void | Promise<HookResult | void>

  /**
   * Called when a task is completed (success, failed, or stopped)
   */
  onTaskComplete?: (context: TaskCompleteContext) => void | Promise<void>

  /**
   * Called at the start of each iteration
   */
  onIterationStart?: (context: IterationContext) => void | Promise<void>

  /**
   * Called at the end of each iteration
   */
  onIterationEnd?: (context: IterationContext) => void | Promise<void>

  /**
   * Called when an error occurs
   */
  onError?: (context: ErrorContext) => void | Promise<void>

  /**
   * Called before tool execution
   */
  onBeforeTool?: (context: HookContext & { tool: string; input: unknown }) => void | Promise<void>

  /**
   * Called after tool execution
   */
  onAfterTool?: (context: HookContext & { tool: string; input: unknown; result: unknown }) => void | Promise<void>
}

/**
 * Default empty hooks
 */
export const NOOP_HOOKS: AgentHooks = {}

/**
 * Hooks registry for managing multiple hooks
 */
export class HooksRegistry {
  private hooks: AgentHooks[] = []

  /**
   * Register hooks
   */
  register(hooks: AgentHooks): void {
    this.hooks.push(hooks)
  }

  /**
   * Unregister hooks
   */
  unregister(hooks: AgentHooks): void {
    const index = this.hooks.indexOf(hooks)
    if (index !== -1) {
      this.hooks.splice(index, 1)
    }
  }

  /**
   * Execute onTurnEnd hooks
   */
  async executeTurnEnd(context: TurnEndContext): Promise<HookResult | void> {
    for (const hooks of this.hooks) {
      if (typeof hooks.onTurnEnd === 'function') {
        const result = await hooks.onTurnEnd(context)
        if (result && typeof result === 'object' && result.stop) {
          return result
        }
      }
    }
  }

  /**
   * Execute onTaskComplete hooks
   */
  async executeTaskComplete(context: TaskCompleteContext): Promise<void> {
    for (const hooks of this.hooks) {
      if (typeof hooks.onTaskComplete === 'function') {
        await hooks.onTaskComplete(context)
      }
    }
  }

  /**
   * Execute onIterationStart hooks
   */
  async executeIterationStart(context: IterationContext): Promise<void> {
    for (const hooks of this.hooks) {
      if (typeof hooks.onIterationStart === 'function') {
        await hooks.onIterationStart(context)
      }
    }
  }

  /**
   * Execute onIterationEnd hooks
   */
  async executeIterationEnd(context: IterationContext): Promise<void> {
    for (const hooks of this.hooks) {
      if (typeof hooks.onIterationEnd === 'function') {
        await hooks.onIterationEnd(context)
      }
    }
  }

  /**
   * Execute onError hooks
   */
  async executeError(context: ErrorContext): Promise<void> {
    for (const hooks of this.hooks) {
      if (typeof hooks.onError === 'function') {
        await hooks.onError(context)
      }
    }
  }

  /**
   * Execute onBeforeTool hooks
   */
  async executeBeforeTool(context: HookContext & { tool: string; input: unknown }): Promise<void> {
    for (const hooks of this.hooks) {
      if (typeof hooks.onBeforeTool === 'function') {
        await hooks.onBeforeTool(context)
      }
    }
  }

  /**
   * Execute onAfterTool hooks
   */
  async executeAfterTool(context: HookContext & { tool: string; input: unknown; result: unknown }): Promise<void> {
    for (const hooks of this.hooks) {
      if (typeof hooks.onAfterTool === 'function') {
        await hooks.onAfterTool(context)
      }
    }
  }
}

// Singleton registry
let registryInstance: HooksRegistry | null = null

/**
 * Get the hooks registry singleton
 */
export function getHooksRegistry(): HooksRegistry {
  if (!registryInstance) {
    registryInstance = new HooksRegistry()
  }
  return registryInstance
}

/**
 * Helper to create a hook that logs activity
 */
export function createLoggingHooks(prefix: string): AgentHooks {
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
