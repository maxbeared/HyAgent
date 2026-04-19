/**
 * Task Tool - 让 Agent 能够创建和管理后台任务
 *
 * 这允许 Agent 将复杂任务分解为子任务并行执行。
 */

import { z } from 'zod'
import { Effect } from 'effect'
import type { ToolDef, ExecuteResult } from './tool.js'

// ============================================================================
// Types
// ============================================================================

/**
 * Task input schema
 */
export const TaskInputSchema = z.object({
  task: z.string().describe('The task to execute'),
  description: z.string().optional().describe('Optional description of the task'),
})

export type TaskInput = z.infer<typeof TaskInputSchema>

/**
 * Task result input
 */
export const TaskResultInputSchema = z.object({
  taskId: z.string().describe('The task ID returned from task creation'),
})

export type TaskResultInput = z.infer<typeof TaskResultInputSchema>

/**
 * Task metadata
 */
export type TaskMetadata = {
  taskId: string
  task: string
}

/**
 * Task state
 */
export interface Task {
  id: string
  task: string
  description?: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  result?: string
  error?: string
  createdAt: number
  completedAt?: number
}

// ============================================================================
// Task Manager
// ============================================================================

/**
 * Simple in-memory task store
 */
class TaskStore {
  private tasks: Map<string, Task> = new Map()

  create(task: string, description?: string): Task {
    const id = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const newTask: Task = {
      id,
      task,
      description,
      status: 'pending',
      createdAt: Date.now(),
    }
    this.tasks.set(id, newTask)
    return newTask
  }

  get(id: string): Task | undefined {
    return this.tasks.get(id)
  }

  update(id: string, updates: Partial<Task>): void {
    const task = this.tasks.get(id)
    if (task) {
      Object.assign(task, updates)
    }
  }

  list(): Task[] {
    return Array.from(this.tasks.values())
  }

  delete(id: string): boolean {
    return this.tasks.delete(id)
  }
}

// Singleton instance
let taskStoreInstance: TaskStore | null = null

export function getTaskStore(): TaskStore {
  if (!taskStoreInstance) {
    taskStoreInstance = new TaskStore()
  }
  return taskStoreInstance
}

// ============================================================================
// Task Tool
// ============================================================================

/**
 * Create the task tool
 */
export function createTaskTool(
  executeTask: (task: string) => Promise<{ output: string; success: boolean }>
): ToolDef<typeof TaskInputSchema, TaskMetadata> {
  const store = getTaskStore()

  return {
    id: 'task',
    description: 'Create a background task to be executed. The task will run asynchronously. Use task_result to get the result later.',
    parameters: TaskInputSchema,

    isConcurrencySafe() {
      return true // Creating tasks is safe
    },

    execute(input) {
      return Effect.gen(function* () {
        const startTime = Date.now()
        const task = store.create(input.task, input.description)

        // Start task execution in background
        ;(async () => {
          store.update(task.id, { status: 'running' })

          try {
            const result = await executeTask(input.task)
            store.update(task.id, {
              status: result.success ? 'completed' : 'failed',
              result: result.output,
              completedAt: Date.now(),
            })
          } catch (err) {
            store.update(task.id, {
              status: 'failed',
              error: err instanceof Error ? err.message : String(err),
              completedAt: Date.now(),
            })
          }
        })()

        return {
          title: `Task Created: ${task.id}`,
          metadata: { taskId: task.id, task: input.task } as TaskMetadata,
          output: `Task created successfully.\nTask ID: ${task.id}\nTask: ${input.task}\n\nUse task_result to get the result when ready.`,
        }
      })
    },
  }
}

/**
 * Create the task result tool
 */
export function createTaskResultTool(): ToolDef<typeof TaskResultInputSchema, TaskMetadata> {
  const store = getTaskStore()

  return {
    id: 'task_result',
    description: 'Get the result of a previously created task. Returns the output if the task completed, or status if still running.',
    parameters: TaskResultInputSchema,

    isConcurrencySafe() {
      return true
    },

    execute(input) {
      return Effect.gen(function* () {
        const task = store.get(input.taskId)

        if (!task) {
          return {
            title: 'Task Not Found',
            metadata: { taskId: input.taskId, task: '' } as TaskMetadata,
            output: `Task not found: ${input.taskId}`,
          }
        }

        let output = `Task ID: ${task.id}\nStatus: ${task.status}\n`

        if (task.status === 'completed' && task.result) {
          output += `\nResult:\n${task.result}`
        } else if (task.status === 'failed' && task.error) {
          output += `\nError:\n${task.error}`
        } else if (task.status === 'running') {
          output += '\nTask is still running...'
        }

        return {
          title: `Task Result: ${task.id}`,
          metadata: { taskId: task.id, task: task.task } as TaskMetadata,
          output,
        }
      })
    },
  }
}

/**
 * Create the task list tool
 */
export function createTaskListTool(): ToolDef<z.ZodType, Record<string, never>> {
  const store = getTaskStore()

  return {
    id: 'task_list',
    description: 'List all tasks and their statuses.',
    parameters: z.object({}),

    isConcurrencySafe() {
      return true
    },

    execute() {
      return Effect.gen(function* () {
        const tasks = store.list()

        if (tasks.length === 0) {
          return {
            title: 'Task List',
            metadata: {},
            output: 'No tasks.',
          }
        }

        const lines = tasks.map(
          (t) => `${t.id}: ${t.status} - ${t.task.slice(0, 50)}${t.task.length > 50 ? '...' : ''}`
        )

        return {
          title: 'Task List',
          metadata: {},
          output: `Tasks:\n${lines.join('\n')}`,
        }
      })
    },
  }
}
