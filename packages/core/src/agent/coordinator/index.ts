/**
 * Coordinator Service - 多Agent协作编排服务
 *
 * 实现Claude Code的Coordinator模式，使用Effect fiber实现轻量级隔离：
 * - Phase工作流: Research → Synthesis → Implementation → Verification
 * - Worker spawning通过Effect.forkScoped
 * - 消息通过Effect Queue/Ref传递
 * - 权限隔离通过独立的PermissionContext
 *
 * 参考来源:
 * - Anthropic-Leaked-Source-Code/coordinator/coordinatorMode.ts
 * - Anthropic-Leaked-Source-Code/tools/AgentTool.tsx
 * - Anthropic-Leaked-Source-Code/forkSubagent.ts
 */

import { Effect, Layer, Queue, Ref, Fiber, Deferred, Stream, Context } from 'effect'
import type { Scope } from 'effect'
import type {
  WorkerConfig,
  WorkerHandle,
  WorkerResult,
  WorkerMessage,
  CoordinatorResult,
  CoordinatorEvent,
  CoordinatorPhase,
  PhaseResult,
} from './types.js'
import { createDefaultContext } from '../../permission/index.js'

// ============================================================================
// Message Queue
// ============================================================================

/**
 * Create a message queue for worker communication
 */
export function createMessageQueue() {
  return Queue.unbounded<WorkerMessage>()
}

/**
 * Create shared state for worker messages
 */
export function createMessageState() {
  return Ref.unsafeMake<Map<string, Queue.Queue<WorkerMessage>>>(new Map())
}

// ============================================================================
// Worker Management
// ============================================================================

/**
 * Generate unique worker ID
 */
function generateWorkerId(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return `worker_${Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}`
}

/**
 * Run a single worker in an isolated fiber
 * 来自: Anthropic-Leaked-Source-Code/forkSubagent.ts
 */
function runWorker(
  config: WorkerConfig,
  messageQueue: Queue.Queue<WorkerMessage>,
  permissionContext: ReturnType<typeof createDefaultContext>
): Effect.Effect<WorkerResult> {
  const startTime = Date.now()
  let toolUses = 0

  return Effect.gen(function* () {
    // Worker runs in isolated context with its own permissions
    // This is where you would integrate with your agent execution
    yield* Effect.sleep(100) // Placeholder for actual agent execution

    // Simulate receiving messages
    const msg = yield* Queue.take(messageQueue).pipe(Effect.option)

    return {
      id: config.id,
      status: 'completed' as const,
      output: `Worker ${config.name} completed`,
      toolUses,
      durationMs: Date.now() - startTime,
    }
  }).pipe(
    Effect.catchAll((e) =>
      Effect.succeed({
        id: config.id,
        status: 'failed' as const,
        error: (e as Error).message,
        toolUses,
        durationMs: Date.now() - startTime,
      }),
    )
  )
}

/**
 * Spawn a new worker
 * 使用Effect.forkScoped在独立fiber中运行worker
 */
function spawnWorker(
  config: WorkerConfig,
  messageQueue: Queue.Queue<WorkerMessage>,
  permissionContext: ReturnType<typeof createDefaultContext>
): Effect.Effect<WorkerHandle, Error, unknown> {
  return Effect.gen(function* () {
    // Create isolated permission context for this worker
    const workerPermCtx = createDefaultContext(config.permissions)

    // Fork worker in scoped fiber
    const fiber = yield* Effect.forkScoped(
      runWorker(config, messageQueue, workerPermCtx)
    )

    // Create worker handle
    const handle: WorkerHandle = {
      id: config.id,
      name: config.name,
      fiber,
      status: 'pending',
      sendMessage: (msg) =>
        Queue.offer(messageQueue, {
          id: generateWorkerId(),
          from: 'coordinator',
          to: config.id,
          content: msg,
          timestamp: Date.now(),
          type: 'text',
        }),
      kill: () => Effect.succeed(undefined) as unknown as Effect.Effect<void>,
    }

    return handle
  })
}

// ============================================================================
// Phase Execution
// ============================================================================

/**
 * Execute a single phase with workers
 */
function executePhase(
  phase: CoordinatorPhase,
  task: string,
  workers: WorkerConfig[],
  messageQueues: Map<string, Queue.Queue<WorkerMessage>>
): Effect.Effect<PhaseResult> {
  const startTime = Date.now()

  return Effect.gen(function* () {
    const results: WorkerResult[] = []

    // Spawn workers for this phase
    const handles = yield* Effect.all(
      workers.map((w) => spawnWorker(w, messageQueues.get(w.id)!, createDefaultContext(w.permissions))),
      { concurrency: 'unbounded' }
    )

    // Send initial task to all workers
    for (const handle of handles) {
      yield* handle.sendMessage(`[${phase}] ${task}`)
    }

    // Wait for all workers to complete
    const fibers = handles.map((h) => h.fiber)
    const completed = yield* Effect.all(fibers, { concurrency: 'unbounded' })

    // Collect results
    for (const result of completed) {
      results.push(result)
    }

    return {
      phase,
      workers: results,
      output: results.map((r) => r.output).join('\n---\n'),
      durationMs: Date.now() - startTime,
    }
  }) as unknown as Effect.Effect<PhaseResult>
}

// ============================================================================
// Coordinator Service
// ============================================================================

/**
 * Coordinator Service implementation
 */
export interface CoordinatorService {
  /**
   * Spawn a worker with given configuration
   */
  spawnWorker(config: WorkerConfig): Effect.Effect<WorkerHandle>

  /**
   * Send message to a worker
   */
  sendMessage(workerId: string, message: string): Effect.Effect<void>

  /**
   * Kill a worker
   */
  killWorker(workerId: string): Effect.Effect<void>

  /**
   * Run task through coordinator phases
   */
  runPhases(
    task: string,
    phases?: CoordinatorPhase[]
  ): Effect.Effect<CoordinatorResult>

  /**
   * Get worker status
   */
  getWorkerStatus(workerId: string): Effect.Effect<WorkerHandle | undefined>

  /**
   * Stream coordinator events
   */
  streamEvents(): Stream.Stream<CoordinatorEvent>
}

/**
 * Coordinator service tag for Effect context
 */
export const CoordinatorServiceTag = Context.GenericTag<CoordinatorService>('@hybrid-agent/coordinator')

/**
 * Create Coordinator Service layer
 */
export const CoordinatorServiceLayer = Layer.effect(
  CoordinatorServiceTag,
  Effect.gen(function* () {
    // Worker state
    const workers = yield* Ref.make<Map<string, WorkerHandle>>(new Map())
    const messageQueues = yield* Ref.make<Map<string, Queue.Queue<WorkerMessage>>>(new Map())
    const events = yield* Queue.unbounded<CoordinatorEvent>()

    // Helper to get or create message queue for worker
    const getOrCreateQueue = (workerId: string) =>
      Effect.gen(function* () {
        const queues = yield* Ref.get(messageQueues)
        let queue = queues.get(workerId)
        if (!queue) {
          queue = yield* createMessageQueue()
          yield* Ref.update(messageQueues, (q) => new Map(q).set(workerId, queue!))
        }
        return queue!
      })

    return {
      spawnWorker(config) {
        return Effect.gen(function* () {
          const queue = yield* getOrCreateQueue(config.id)
          const handle = yield* spawnWorker(config, queue, createDefaultContext(config.permissions))

          // Store worker handle
          yield* Ref.update(workers, (w) => new Map(w).set(config.id, handle))

          // Emit event
          yield* Queue.offer(events, {
            type: 'worker_spawn',
            workerId: config.id,
            workerName: config.name,
          })

          return handle
        }) as unknown as Effect.Effect<WorkerHandle>
      },

      sendMessage(workerId, message) {
        return Effect.gen(function* () {
          const w = yield* Ref.get(workers)
          const handle = w.get(workerId)
          if (handle) {
            yield* handle.sendMessage(message)
            yield* Queue.offer(events, {
              type: 'worker_message',
              workerId,
              message,
            })
          }
        }) as unknown as Effect.Effect<void>
      },

      killWorker(workerId) {
        return Effect.gen(function* () {
          const w = yield* Ref.get(workers)
          const handle = w.get(workerId)
          if (handle) {
            yield* handle.kill()
            yield* Ref.update(workers, (workers) => {
              const next = new Map(workers)
              next.delete(workerId)
              return next
            })
          }
        }) as unknown as Effect.Effect<void>
      },

      runPhases(task, phases: CoordinatorPhase[] = ['research', 'implementation', 'verification']) {
        return Effect.gen(function* () {
          const startTime = Date.now()
          const phaseResults: PhaseResult[] = []

          // Emit coordinator message
          yield* Queue.offer(events, {
            type: 'coordinator_message',
            message: `Starting task: ${task}`,
          })

          for (const phase of phases) {
            yield* Queue.offer(events, { type: 'phase_start', phase })

            // Create workers for this phase
            const workerConfigs: WorkerConfig[] = [
              {
                id: generateWorkerId(),
                name: `${phase}-worker-1`,
                prompt: `Execute ${phase} for: ${task}`,
                tools: ['*'],
                permissions: [],
              },
            ]

            // Execute phase
            const result = yield* executePhase(
              phase,
              task,
              workerConfigs,
              yield* Ref.get(messageQueues)
            )
            phaseResults.push(result)

            yield* Queue.offer(events, { type: 'phase_complete', phase, result })

            // Kill workers after phase
            for (const w of workerConfigs) {
              yield* Effect.gen(function* () {
                const workerMap = yield* Ref.get(workers)
                const handle = workerMap.get(w.id)
                if (handle) {
                  yield* handle.kill()
                }
              })
            }
          }

          return {
            task,
            phases: phaseResults,
            totalDurationMs: Date.now() - startTime,
            finalOutput: phaseResults.map((p) => p.output).join('\n\n'),
          }
        }) as unknown as Effect.Effect<CoordinatorResult>
      },

      getWorkerStatus(workerId) {
        return Effect.gen(function* () {
          const w = yield* Ref.get(workers)
          return w.get(workerId)
        }) as unknown as Effect.Effect<WorkerHandle | undefined>
      },

      streamEvents() {
        return Stream.fromQueue(events)
      },
    } as unknown as CoordinatorService
  })
)

// ============================================================================
// Predefined Phase Configurations
// ============================================================================

/**
 * Default coordinator phase sequence
 */
export const DEFAULT_PHASES: CoordinatorPhase[] = [
  'research',
  'synthesis',
  'implementation',
  'verification',
]

/**
 * Phase descriptions
 */
export const PHASE_DESCRIPTIONS: Record<CoordinatorPhase, string> = {
  research: 'Investigate and understand the codebase',
  synthesis: 'Analyze findings and create a plan',
  implementation: 'Make targeted code changes',
  verification: 'Test and verify the changes work correctly',
}
