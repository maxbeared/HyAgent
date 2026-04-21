/**
 * Task Decomposition System
 *
 * Inspired by Claude Code's coordinator pattern and OpenCode's subtask system.
 * Provides:
 * - Complex task breakdown into parallelizable subtasks
 * - Dependency tracking between subtasks
 * - Status tracking and result aggregation
 * - Support for nested task trees
 */

import { randomUUID } from 'crypto'

// ============================================================================
// Types
// ============================================================================

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed'

export interface SubTask {
  id: string
  description: string
  status: TaskStatus
  dependencies: string[]  // Task IDs that must complete before this one
  result?: unknown
  error?: string
  createdAt: number
  completedAt?: number
}

export interface TaskPlan {
  id: string
  rootTask: string  // Original task description
  subtasks: Map<string, SubTask>
  status: 'analyzing' | 'planned' | 'executing' | 'completed' | 'failed'
  createdAt: number
  completedAt?: number
  parentId?: string  // For nested task plans
}

// ============================================================================
// Task Plan State
// ============================================================================

let currentPlan: TaskPlan | null = null

/**
 * Create a new task plan
 */
export function createTaskPlan(rootTask: string, parentId?: string): TaskPlan {
  currentPlan = {
    id: randomUUID(),
    rootTask,
    subtasks: new Map(),
    status: 'analyzing',
    createdAt: Date.now(),
    parentId,
  }
  return currentPlan
}

/**
 * Get the current task plan
 */
export function getCurrentPlan(): TaskPlan | null {
  return currentPlan
}

/**
 * Reset task plan state
 */
export function resetTaskPlan(): void {
  currentPlan = null
}

// ============================================================================
// Task Management
// ============================================================================

/**
 * Add a subtask to the current plan
 */
export function addSubTask(
  description: string,
  dependencies: string[] = [],
): string {
  if (!currentPlan) {
    throw new Error('No task plan active. Call createTaskPlan first.')
  }

  const id = randomUUID()
  const subtask: SubTask = {
    id,
    description,
    status: 'pending',
    dependencies,
    createdAt: Date.now(),
  }

  currentPlan.subtasks.set(id, subtask)
  return id
}

/**
 * Update subtask status
 */
export function updateSubTaskStatus(
  taskId: string,
  status: TaskStatus,
  result?: unknown,
  error?: string,
): void {
  if (!currentPlan) return

  const subtask = currentPlan.subtasks.get(taskId)
  if (!subtask) return

  subtask.status = status
  if (result !== undefined) subtask.result = result
  if (error !== undefined) subtask.error = error
  if (status === 'completed' || status === 'failed') {
    subtask.completedAt = Date.now()
  }
}

/**
 * Get subtask by ID
 */
export function getSubTask(taskId: string): SubTask | undefined {
  return currentPlan?.subtasks.get(taskId)
}

/**
 * Get all pending subtasks (tasks with all dependencies satisfied)
 */
export function getReadySubTasks(): SubTask[] {
  if (!currentPlan) return []

  const completedOrFailed = new Set<string>()

  return Array.from(currentPlan.subtasks.values())
    .filter(task => {
      if (task.status !== 'pending') return false
      // Check if all dependencies are complete
      return task.dependencies.every(depId => {
        const dep = currentPlan!.subtasks.get(depId)
        return dep && (dep.status === 'completed' || dep.status === 'failed')
      })
    })
}

/**
 * Get execution-ready subtasks that can run in parallel
 */
export function getParallelizableTasks(): SubTask[] {
  const ready = getReadySubTasks()

  // Group by whether they have dependencies on each other
  const independentTasks: SubTask[] = []
  const dependentGroups: SubTask[][] = []

  for (const task of ready) {
    // Check if this task depends on any other ready task
    const hasReadyDependency = task.dependencies.some(depId => {
      return ready.some(r => r.id === depId)
    })

    if (!hasReadyDependency) {
      independentTasks.push(task)
    } else {
      // Find or create group for this task's dependency chain
      const group = findDependencyGroup(task, ready)
      if (group.length > 0 && !dependentGroups.some(g => g[0].id === group[0].id)) {
        dependentGroups.push(group)
      }
    }
  }

  // Return independent tasks that can run in parallel
  return independentTasks
}

function findDependencyGroup(task: SubTask, allReady: SubTask[]): SubTask[] {
  const group: SubTask[] = [task]
  const groupIds = new Set([task.id])

  // Find all tasks that depend on this task
  for (const t of allReady) {
    if (!groupIds.has(t.id) && t.dependencies.some(d => groupIds.has(d))) {
      group.push(t)
      groupIds.add(t.id)
    }
  }

  return group
}

/**
 * Check if all subtasks are complete
 */
export function isPlanComplete(): boolean {
  if (!currentPlan) return false

  return Array.from(currentPlan.subtasks.values()).every(
    task => task.status === 'completed' || task.status === 'failed'
  )
}

/**
 * Get plan progress summary
 */
export function getPlanProgress(): {
  total: number
  completed: number
  failed: number
  pending: number
  inProgress: number
  progressPercent: number
} {
  if (!currentPlan) {
    return { total: 0, completed: 0, failed: 0, pending: 0, inProgress: 0, progressPercent: 0 }
  }

  const subtasks = Array.from(currentPlan.subtasks.values())
  const total = subtasks.length
  const completed = subtasks.filter(t => t.status === 'completed').length
  const failed = subtasks.filter(t => t.status === 'failed').length
  const pending = subtasks.filter(t => t.status === 'pending').length
  const inProgress = subtasks.filter(t => t.status === 'in_progress').length

  return {
    total,
    completed,
    failed,
    pending,
    inProgress,
    progressPercent: total > 0 ? Math.round(((completed + failed) / total) * 100) : 0,
  }
}

/**
 * Finalize plan status
 */
export function finalizePlan(): void {
  if (!currentPlan) return

  if (isPlanComplete()) {
    currentPlan.status = 'completed'
    currentPlan.completedAt = Date.now()
  } else {
    currentPlan.status = 'failed'
  }
}

// ============================================================================
// Task Analysis (LLM-driven)
// ============================================================================

export interface TaskAnalysis {
  canDecompose: boolean
  suggestedSubtasks: string[]
  estimatedComplexity: 'low' | 'medium' | 'high'
  parallelPossible: boolean
  reasoning: string
}

/**
 * Analyze a task to determine if it should be decomposed
 */
export function analyzeTask(task: string): TaskAnalysis {
  // Simple heuristic analysis
  // In production, this could use LLM to analyze

  const taskLower = task.toLowerCase()

  // Indicators that suggest decomposition is needed
  const multiIndicator = [
    'and then', 'also need to', 'additionally', 'multiple', 'several',
    'set up both', 'implement and', 'create and', 'build and',
    'install and configure', 'migrate and',
  ]

  // Indicators that suggest high complexity
  const complexIndicator = [
    'architecture', 'refactor', 'design', 'implement from scratch',
    'migrate', 'rebuild', 'multiple services', 'distributed',
  ]

  const canDecompose = multiIndicator.some(indicator => taskLower.includes(indicator))
  const isComplex = complexIndicator.some(indicator => taskLower.includes(indicator))

  // Estimate complexity
  let estimatedComplexity: 'low' | 'medium' | 'high' = 'low'
  if (isComplex || task.length > 500) estimatedComplexity = 'high'
  else if (canDecompose || task.length > 200) estimatedComplexity = 'medium'

  return {
    canDecompose,
    suggestedSubtasks: canDecompose ? suggestSubtasks(task) : [],
    estimatedComplexity,
    parallelPossible: canDecompose,
    reasoning: canDecompose
      ? 'Task contains multiple operations that can be executed in parallel or sequence'
      : 'Task appears to be a single focused operation',
  }
}

/**
 * Suggest subtasks based on task content
 */
function suggestSubtasks(task: string): string[] {
  const subtasks: string[] = []

  // Simple pattern-based decomposition
  // Split by common separators
  const separators = [/ and then /i, /,? then /i, /,? also /i, /,? additionally /i]
  let parts = [task]

  for (const sep of separators) {
    const newParts: string[] = []
    for (const part of parts) {
      newParts.push(...part.split(sep))
    }
    parts = newParts
  }

  // Filter out very short parts and clean up
  for (const part of parts) {
    const trimmed = part.trim()
    if (trimmed.length > 20 && !subtasks.includes(trimmed)) {
      subtasks.push(trimmed)
    }
  }

  return subtasks
}

// ============================================================================
// Serialization
// ============================================================================

export interface SerializedTaskPlan {
  id: string
  rootTask: string
  subtasks: [string, SubTask][]
  status: TaskPlan['status']
  createdAt: number
  completedAt?: number
  parentId?: string
}

export function serializePlan(plan: TaskPlan): SerializedTaskPlan {
  return {
    id: plan.id,
    rootTask: plan.rootTask,
    subtasks: Array.from(plan.subtasks.entries()),
    status: plan.status,
    createdAt: plan.createdAt,
    completedAt: plan.completedAt,
    parentId: plan.parentId,
  }
}

export function deserializePlan(data: SerializedTaskPlan): TaskPlan {
  return {
    id: data.id,
    rootTask: data.rootTask,
    subtasks: new Map(data.subtasks),
    status: data.status,
    createdAt: data.createdAt,
    completedAt: data.completedAt,
    parentId: data.parentId,
  }
}
