/**
 * Coordinator Subagent Tools
 *
 * AgentTool, SendMessageTool, TaskStopTool for subagent management.
 *
 * Reference: Anthropic-Leaked-Source-Code/tools/AgentTool.tsx
 * Reference: Anthropic-Leaked-Source-Code/tools/SendMessageTool.ts
 * Reference: Anthropic-Leaked-Source-Code/tools/TaskStopTool.ts
 */

import { Effect, Layer, Context } from 'effect'
import { z } from 'zod'
import { randomUUID } from 'crypto'

// ============================================================================
// AgentTool Types
// ============================================================================

export const AgentToolInputSchema = z.object({
  task: z.string().describe('Task description for the subagent'),
  agentType: z.enum(['build', 'plan', 'general', 'explore', 'review', 'research', 'coding']).default('general').describe('Type of agent to spawn'),
  name: z.string().optional().describe('Optional name for the agent'),
  tools: z.array(z.string()).or(z.literal('*')).optional().describe('Tools to allow'),
  maxTurns: z.number().optional().describe('Maximum conversation turns'),
  model: z.string().optional().describe('Specific model to use'),
  timeout: z.number().optional().describe('Timeout in milliseconds'),
})

export type AgentToolInput = z.infer<typeof AgentToolInputSchema>

// ============================================================================
// SendMessageTool Types
// ============================================================================

export const SendMessageToolInputSchema = z.object({
  targetAgentId: z.string().describe('Target agent ID'),
  message: z.string().describe('Message content'),
  messageType: z.enum(['text', 'shutdown_request', 'shutdown_response', 'plan_approval_request', 'plan_approval_response']).default('text').describe('Type of message'),
  requestId: z.string().optional().describe('Request ID for structured messages'),
  approve: z.boolean().optional().describe('For approval responses'),
  reason: z.string().optional().describe('Reason for the message'),
})

export type SendMessageToolInput = z.infer<typeof SendMessageToolInputSchema>

// ============================================================================
// TaskStopTool Types
// ============================================================================

export const TaskStopToolInputSchema = z.object({
  agentId: z.string().describe('Agent ID to stop'),
  reason: z.string().optional().describe('Reason for stopping'),
})

export type TaskStopToolInput = z.infer<typeof TaskStopToolInputSchema>

// ============================================================================
// Subagent Result
// ============================================================================

export interface SubagentResult {
  agentId: string
  name: string
  status: 'running' | 'completed' | 'failed' | 'stopped'
  output?: string
  error?: string
  durationMs?: number
}

// ============================================================================
// Subagent Handle
// ============================================================================

export interface SubagentHandle {
  id: string
  name: string
  type: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'stopped'
  startTime: number
  sendMessage: (msg: string) => void
  stop: (reason?: string) => void
  awaitCompletion: () => Promise<SubagentResult>
}

// ============================================================================
// Subagent Manager
// ============================================================================

export class SubagentManager {
  private agents: Map<string, SubagentHandle> = new Map()
  private results: Map<string, SubagentResult> = new Map()

  /**
   * Create a new subagent
   */
  createAgent(input: AgentToolInput): SubagentHandle {
    const id = input.name || `agent-${randomUUID().substring(0, 8)}`
    const handle: SubagentHandle = {
      id,
      name: input.agentType,
      type: input.agentType,
      status: 'pending',
      startTime: Date.now(),
      sendMessage: (msg: string) => this.sendMessage(id, msg),
      stop: (reason?: string) => this.stopAgent(id, reason),
      awaitCompletion: () => this.awaitCompletion(id),
    }

    this.agents.set(id, handle)
    return handle
  }

  /**
   * Get agent by ID
   */
  getAgent(id: string): SubagentHandle | undefined {
    return this.agents.get(id)
  }

  /**
   * List all agents
   */
  listAgents(): SubagentHandle[] {
    return Array.from(this.agents.values())
  }

  /**
   * Update agent status
   */
  updateStatus(id: string, status: SubagentHandle['status']): void {
    const agent = this.agents.get(id)
    if (agent) {
      agent.status = status
    }
  }

  /**
   * Send message to agent
   */
  sendMessage(agentId: string, message: string): void {
    const agent = this.agents.get(agentId)
    if (agent) {
      console.log(`[SubagentManager] Sending message to ${agentId}:`, message)
      // In real implementation, would route to agent's message queue
    }
  }

  /**
   * Stop agent
   */
  stopAgent(agentId: string, reason?: string): void {
    const agent = this.agents.get(agentId)
    if (agent) {
      agent.status = 'stopped'

      this.results.set(agentId, {
        agentId,
        name: agent.name,
        status: 'stopped',
        durationMs: Date.now() - agent.startTime,
      })
    }
  }

  /**
   * Await agent completion
   */
  awaitCompletion(agentId: string): Promise<SubagentResult> {
    return new Promise((resolve) => {
      const checkStatus = () => {
        const agent = this.agents.get(agentId)
        if (!agent) {
          resolve({
            agentId,
            name: agentId,
            status: 'failed',
            error: 'Agent not found',
          })
          return
        }

        if (agent.status === 'completed' || agent.status === 'failed' || agent.status === 'stopped') {
          const result = this.results.get(agentId) || {
            agentId,
            name: agent.name,
            status: agent.status,
            durationMs: Date.now() - agent.startTime,
          }
          resolve(result)
        } else {
          setTimeout(checkStatus, 100)
        }
      }

      checkStatus()
    })
  }

  /**
   * Set agent result
   */
  setResult(result: SubagentResult): void {
    this.results.set(result.agentId, result)
    const agent = this.agents.get(result.agentId)
    if (agent) {
      agent.status = result.status
    }
  }

  /**
   * Remove agent
   */
  removeAgent(id: string): void {
    this.agents.delete(id)
    this.results.delete(id)
  }

  /**
   * Clear all agents
   */
  clear(): void {
    this.agents.clear()
    this.results.clear()
  }
}

// ============================================================================
// Structured Message Types
// ============================================================================

export type StructuredMessage =
  | { type: 'shutdown_request'; agentId: string; reason?: string; requestId?: string }
  | { type: 'shutdown_response'; agentId: string; requestId: string; approve: boolean; reason?: string }
  | { type: 'plan_approval_request'; agentId: string; plan: string; requestId: string }
  | { type: 'plan_approval_response'; agentId: string; requestId: string; approve: boolean; feedback?: string }

/**
 * Send structured message to agent
 */
export function sendStructuredMessage(manager: SubagentManager, message: StructuredMessage): void {
  const { type, agentId } = message

  switch (type) {
    case 'shutdown_request': {
      const agent = manager.getAgent(agentId)
      if (agent) {
        agent.sendMessage(JSON.stringify({ type: 'shutdown_request', ...message }))
      }
      break
    }

    case 'shutdown_response': {
      const agent = manager.getAgent(agentId)
      if (agent) {
        agent.sendMessage(JSON.stringify({ type: 'shutdown_response', ...message }))
      }
      break
    }

    case 'plan_approval_request': {
      const agent = manager.getAgent(agentId)
      if (agent) {
        agent.sendMessage(JSON.stringify({ type: 'plan_approval_request', ...message }))
      }
      break
    }

    case 'plan_approval_response': {
      const agent = manager.getAgent(agentId)
      if (agent) {
        agent.sendMessage(JSON.stringify({ type: 'plan_approval_response', ...message }))
      }
      break
    }
  }
}

// ============================================================================
// Subagent Tools
// ============================================================================

/**
 * AgentTool - Spawn a subagent to execute a task
 */
export const AgentTool = {
  name: 'agent' as const,
  description: 'Spawn a subagent to execute a task',
  inputSchema: AgentToolInputSchema,

  execute(input: AgentToolInput): SubagentHandle {
    const manager = getSubagentManager()
    return manager.createAgent(input)
  },
}

/**
 * SendMessageTool - Send message to a subagent
 */
export const SendMessageTool = {
  name: 'send_message' as const,
  description: 'Send a message to a subagent',
  inputSchema: SendMessageToolInputSchema,

  execute(input: SendMessageToolInput): { success: boolean; messageId: string } {
    const manager = getSubagentManager()
    const agent = manager.getAgent(input.targetAgentId)

    if (!agent) {
      return { success: false, messageId: '' }
    }

    const messageId = randomUUID()

    if (input.messageType === 'text') {
      agent.sendMessage(input.message)
    } else {
      const structured: StructuredMessage = {
        type: input.messageType as any,
        agentId: input.targetAgentId,
        requestId: input.requestId || randomUUID(),
        reason: input.reason,
        approve: input.approve,
        plan: input.message, // For plan_approval_request
        feedback: input.reason, // For plan_approval_response
      }
      sendStructuredMessage(manager, structured)
    }

    return { success: true, messageId }
  },
}

/**
 * TaskStopTool - Stop a subagent
 */
export const TaskStopTool = {
  name: 'task_stop' as const,
  description: 'Stop a running subagent',
  inputSchema: TaskStopToolInputSchema,

  execute(input: TaskStopToolInput): { success: boolean; agentId: string } {
    const manager = getSubagentManager()
    const agent = manager.getAgent(input.agentId)

    if (!agent) {
      return { success: false, agentId: input.agentId }
    }

    manager.stopAgent(input.agentId, input.reason)
    return { success: true, agentId: input.agentId }
  },
}

// ============================================================================
// Singleton
// ============================================================================

let subagentManagerInstance: SubagentManager | null = null

export function getSubagentManager(): SubagentManager {
  if (!subagentManagerInstance) {
    subagentManagerInstance = new SubagentManager()
  }
  return subagentManagerInstance
}

// ============================================================================
// Effect Context
// ============================================================================

export const SubagentManagerContext = Context.GenericTag<SubagentManager>('SubagentManager')
