/**
 * ACP (Agent Communication Protocol)
 *
 * Inter-agent communication, service discovery, and capability negotiation.
 *
 * Features:
 * - Agent registry and discovery
 * - Capability-based routing
 * - Message passing with request/response
 * - Subscription-based notifications
 * - Transport abstraction
 *
 * Reference: opencode/packages/opencode/src/acp/
 */

import { Effect, Layer, Context, Ref } from 'effect'
import { z } from 'zod'
import { randomUUID } from 'crypto'

// ============================================================================
// Types
// ============================================================================

import type {
  ACPMessage,
  ACPConfig,
  ACPError,
  AgentIdentity,
  AgentRegistryEntry,
  Capability,
  ServiceEndpoint,
  Subscription,
} from './types.js'

export {
  ACPMessage,
  ACPConfig,
  ACPError,
  AgentIdentity,
  AgentRegistryEntry,
  Capability,
  ServiceEndpoint,
  Subscription,
} from './types.js'

import {
  ACPConfigSchema,
  AgentIdentitySchema,
  ACPMessageSchema,
  MessageTypeSchema,
  CapabilitySchema,
  ServiceEndpointSchema,
} from './types.js'

// ============================================================================
// ACP Service State
// ============================================================================

interface PendingRequest {
  resolve: (msg: ACPMessage) => void
  reject: (err: ACPError) => void
  timeout: ReturnType<typeof setTimeout>
}

interface ACPState {
  config: ACPConfig
  registry: Map<string, AgentRegistryEntry>
  subscriptions: Map<string, Subscription>
  messageHandlers: Map<string, Set<(msg: ACPMessage) => void>>
  pendingRequests: Map<string, PendingRequest>
}

function createACPState(config: ACPConfig): ACPState {
  return {
    config,
    registry: new Map(),
    subscriptions: new Map(),
    messageHandlers: new Map(),
    pendingRequests: new Map(),
  }
}

// ============================================================================
// ACP Service
// ============================================================================

export class ACPService {
  private state: ACPState

  constructor(config: ACPConfig) {
    this.state = createACPState(config)
  }

  // ============================================================================
  // Configuration
  // ============================================================================

  get config(): ACPConfig {
    return this.state.config
  }

  // ============================================================================
  // Agent Registry
  // ============================================================================

  /**
   * Register this agent
   */
  register(identity: AgentIdentity, endpoint?: ServiceEndpoint): void {
    const entry: AgentRegistryEntry = {
      identity,
      endpoint,
      status: 'online',
      lastSeen: Date.now(),
      registeredAt: Date.now(),
    }

    this.state.registry.set(identity.id, entry)
  }

  /**
   * Unregister this agent
   */
  unregister(): void {
    this.state.registry.delete(this.state.config.agentId)
  }

  /**
   * Update agent status
   */
  updateStatus(status: AgentRegistryEntry['status']): void {
    const entry = this.state.registry.get(this.state.config.agentId)
    if (entry) {
      entry.status = status
      entry.lastSeen = Date.now()
    }
  }

  /**
   * Get agent by ID
   */
  getAgent(agentId: string): AgentRegistryEntry | undefined {
    return this.state.registry.get(agentId)
  }

  /**
   * List all registered agents
   */
  listAgents(filter?: { status?: AgentRegistryEntry['status']; capability?: string }): AgentRegistryEntry[] {
    let agents = Array.from(this.state.registry.values())

    if (filter?.status) {
      agents = agents.filter((a) => a.status === filter.status)
    }

    if (filter?.capability) {
      agents = agents.filter((a) =>
        a.identity.capabilities?.some((c) => c.id === filter.capability)
      )
    }

    return agents
  }

  /**
   * Discover agents by capability
   */
  discoverByCapability(capabilityId: string): AgentRegistryEntry[] {
    return this.listAgents({ capability: capabilityId })
  }

  /**
   * Update heartbeat
   */
  heartbeat(): void {
    this.updateStatus('online')
  }

  // ============================================================================
  // Capability Management
  // ============================================================================

  /**
   * Register capabilities for this agent
   */
  registerCapabilities(capabilities: Capability[]): void {
    const entry = this.state.registry.get(this.state.config.agentId)
    if (entry) {
      entry.identity.capabilities = capabilities
    }
  }

  /**
   * Get capability by ID
   */
  getCapability(capabilityId: string): { agent: AgentRegistryEntry; capability: Capability } | undefined {
    for (const entry of this.state.registry.values()) {
      const capability = entry.identity.capabilities?.find((c) => c.id === capabilityId)
      if (capability) {
        return { agent: entry, capability }
      }
    }
    return undefined
  }

  // ============================================================================
  // Message Passing
  // ============================================================================

  /**
   * Send a message
   */
  send(message: Omit<ACPMessage, 'id' | 'timestamp' | 'from'>): ACPMessage {
    const fullMessage: ACPMessage = {
      ...message,
      id: randomUUID(),
      timestamp: Date.now(),
      from: this.state.config.agentId,
    }

    // Handle based on message type
    switch (message.type) {
      case 'request':
        return this.sendRequest(fullMessage)
      case 'notification':
      case 'announce':
        return this.broadcast(fullMessage)
      case 'discover':
        return this.handleDiscover(fullMessage)
      default:
        return this.routeMessage(fullMessage)
    }
  }

  private sendRequest(message: ACPMessage): ACPMessage {
    if (!message.to) {
      throw { type: 'invalid_message', reason: 'Request message requires "to" field' }
    }

    const recipient = this.state.registry.get(message.to)
    if (!recipient) {
      throw { type: 'agent_not_found', agentId: message.to }
    }

    // If recipient endpoint exists, we would send via transport
    // For now, handle locally
    this.routeMessage(message)
    return message
  }

  private broadcast(message: ACPMessage): ACPMessage {
    const handlers = this.state.messageHandlers.get(message.capability || '*')
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(message)
        } catch (e) {
          console.error('[ACP] Handler error:', e)
        }
      }
    }
    return message
  }

  private handleDiscover(message: ACPMessage): ACPMessage {
    const capability = message.capability
    const agents = capability
      ? this.discoverByCapability(capability)
      : this.listAgents()

    const response: ACPMessage = {
      id: randomUUID(),
      type: 'response',
      from: this.state.config.agentId,
      to: message.from,
      replyTo: message.id,
      timestamp: Date.now(),
      payload: {
        agents: agents.map((a) => ({
          id: a.identity.id,
          name: a.identity.name,
          type: a.identity.type,
          capabilities: a.identity.capabilities,
        })),
      },
    }

    return response
  }

  private routeMessage(message: ACPMessage): ACPMessage {
    // Route to specific handler if "to" is set
    if (message.to) {
      const key = `${message.to}:${message.capability || '*'}`
      const handlers = this.state.messageHandlers.get(key)
      if (handlers) {
        for (const handler of handlers) {
          handler(message)
        }
      }
    }

    // Also broadcast to capability subscribers
    if (message.capability) {
      const handlers = this.state.messageHandlers.get(message.capability)
      if (handlers) {
        for (const handler of handlers) {
          handler(message)
        }
      }
    }

    return message
  }

  /**
   * Send and wait for response
   */
  async sendAndWait(
    message: Omit<ACPMessage, 'id' | 'timestamp' | 'from' | 'type'>,
    timeoutMs?: number
  ): Promise<ACPMessage> {
    const fullMessage: ACPMessage = {
      ...message,
      id: randomUUID(),
      type: 'request',
      timestamp: Date.now(),
      from: this.state.config.agentId,
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.state.pendingRequests.delete(fullMessage.id)
        reject({ type: 'message_timeout', messageId: fullMessage.id })
      }, timeoutMs || this.state.config.messageTimeout)

      this.state.pendingRequests.set(fullMessage.id, { resolve, reject, timeout })

      // Send the message
      this.send(fullMessage)

      // Register temporary handler for response
      const handler = (response: ACPMessage) => {
        if (response.replyTo === fullMessage.id) {
          clearTimeout(timeout)
          this.state.pendingRequests.delete(fullMessage.id)
          this.removeMessageHandler(`*:${fullMessage.capability || '*'}`, handler)
          resolve(response)
        }
      }

      this.addMessageHandler(`*:${fullMessage.capability || '*'}`, handler)
    })
  }

  // ============================================================================
  // Message Handlers
  // ============================================================================

  /**
   * Add message handler for capability/agent
   */
  addMessageHandler(key: string, handler: (msg: ACPMessage) => void): void {
    if (!this.state.messageHandlers.has(key)) {
      this.state.messageHandlers.set(key, new Set())
    }
    this.state.messageHandlers.get(key)!.add(handler)
  }

  /**
   * Remove message handler
   */
  removeMessageHandler(key: string, handler: (msg: ACPMessage) => void): void {
    const handlers = this.state.messageHandlers.get(key)
    if (handlers) {
      handlers.delete(handler)
      if (handlers.size === 0) {
        this.state.messageHandlers.delete(key)
      }
    }
  }

  // ============================================================================
  // Subscriptions
  // ============================================================================

  /**
   * Subscribe to agent announcements
   */
  subscribe(subscription: Omit<Subscription, 'id' | 'agentId'>): Subscription {
    const full: Subscription = {
      ...subscription,
      id: randomUUID(),
      agentId: this.state.config.agentId,
    }

    this.state.subscriptions.set(full.id, full)
    return full
  }

  /**
   * Unsubscribe
   */
  unsubscribe(subscriptionId: string): void {
    this.state.subscriptions.delete(subscriptionId)
  }

  /**
   * Get subscriptions for this agent
   */
  getSubscriptions(): Subscription[] {
    return Array.from(this.state.subscriptions.values()).filter(
      (s) => s.agentId === this.state.config.agentId
    )
  }

  // ============================================================================
  // Utility
  // ============================================================================

  /**
   * Create a capability request message
   */
  requestCapability(
    capability: string,
    action: string,
    payload?: unknown,
    to?: string
  ): ACPMessage {
    return this.send({
      type: 'request',
      to,
      capability,
      action,
      payload,
    })
  }

  /**
   * Announce a capability event
   */
  announce(capability: string, event: string, payload?: unknown): ACPMessage {
    return this.send({
      type: 'announce',
      capability,
      action: event,
      payload,
    })
  }
}

// ============================================================================
// Effect Context
// ============================================================================

export const ACPConfigContext = Context.GenericTag<ACPConfig>('ACPConfig')
export const ACPServiceContext = Context.GenericTag<ACPService>('ACPService')

export const ACPLayer = Layer.effect(
  ACPServiceContext,
  Effect.map(ACPConfigContext, (config) => new ACPService(config))
)

// ============================================================================
// Singleton
// ============================================================================

let acpService: ACPService | null = null

export function getACPService(config?: Partial<ACPConfig>): ACPService {
  if (!acpService) {
    const defaultConfig: ACPConfig = {
      agentId: `agent-${randomUUID().substring(0, 8)}`,
      agentName: 'HyAgent',
      heartbeatInterval: 30000,
      discoveryTimeout: 5000,
      messageTimeout: 30000,
      ...config,
    }
    acpService = new ACPService(defaultConfig)
  }
  return acpService
}

export function initializeACP(config: ACPConfig): ACPService {
  acpService = new ACPService(config)
  return acpService
}

// ============================================================================
// Built-in Capabilities
// ============================================================================

export const BUILTIN_CAPABILITIES = {
  agentInfo: {
    id: 'agent:info',
    name: 'Agent Information',
    description: 'Query agent identity and capabilities',
    version: '1.0.0',
    tools: ['info'],
  },
  taskExecution: {
    id: 'task:execute',
    name: 'Task Execution',
    description: 'Execute tasks on behalf of another agent',
    version: '1.0.0',
    tools: ['task'],
  },
  fileTransfer: {
    id: 'file:transfer',
    name: 'File Transfer',
    description: 'Transfer files between agents',
    version: '1.0.0',
    tools: ['read', 'write'],
  },
  worktreeManagement: {
    id: 'worktree:manage',
    name: 'Worktree Management',
    description: 'Create and manage git worktrees',
    version: '1.0.0',
    tools: ['bash'],
  },
}
