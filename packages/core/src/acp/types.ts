/**
 * ACP (Agent Communication Protocol) Types
 *
 * Inter-agent communication, service discovery, and capability negotiation.
 *
 * Reference: opencode/packages/opencode/src/acp/
 */

import { z } from 'zod'

// ============================================================================
// Capability Schema
// ============================================================================

export const CapabilitySchema = z.object({
  id: z.string().describe('Capability identifier'),
  name: z.string().describe('Human-readable name'),
  description: z.string().describe('What this capability does'),
  version: z.string().describe('Version semver'),
  tools: z.array(z.string()).optional().describe('Available tools'),
  tags: z.array(z.string()).optional().describe('Categorization tags'),
})

export type Capability = z.infer<typeof CapabilitySchema>

// ============================================================================
// Agent Identity
// ============================================================================

export const AgentIdentitySchema = z.object({
  id: z.string().describe('Unique agent identifier'),
  name: z.string().describe('Agent display name'),
  type: z.enum(['user', 'agent', 'service']).describe('Agent type'),
  version: z.string().optional().describe('Agent version'),
  capabilities: z.array(CapabilitySchema).optional().describe('Agent capabilities'),
  metadata: z.record(z.unknown()).optional().describe('Additional metadata'),
})

export type AgentIdentity = z.infer<typeof AgentIdentitySchema>

// ============================================================================
// Message Types
// ============================================================================

export const MessageTypeSchema = z.enum([
  'request',
  'response',
  'notification',
  'error',
  'subscribe',
  'unsubscribe',
  'discover',
  'announce',
])

export const ACPMessageSchema = z.object({
  id: z.string().describe('Unique message ID'),
  type: MessageTypeSchema.describe('Message type'),
  from: z.string().describe('Sender agent ID'),
  to: z.string().optional().describe('Recipient agent ID (null for broadcast)'),
  capability: z.string().optional().describe('Target capability'),
  action: z.string().optional().describe('Action to perform'),
  payload: z.unknown().optional().describe('Message payload'),
  timestamp: z.number().describe('Unix timestamp'),
  ttl: z.number().optional().describe('Time to live in ms'),
  replyTo: z.string().optional().describe('Message ID to reply to'),
})

export type ACPMessage = z.infer<typeof ACPMessageSchema>

// ============================================================================
// Service Discovery
// ============================================================================

export const ServiceEndpointSchema = z.object({
  agentId: z.string().describe('Agent ID'),
  url: z.string().url().describe('Service URL'),
  transport: z.enum(['http', 'ws', 'streamable-http']).describe('Transport type'),
  capabilities: z.array(z.string()).describe('Supported capabilities'),
  weight: z.number().optional().describe('Load balancing weight'),
})

export type ServiceEndpoint = z.infer<typeof ServiceEndpointSchema>

// ============================================================================
// Registry Types
// ============================================================================

export const AgentRegistryEntrySchema = z.object({
  identity: AgentIdentitySchema,
  endpoint: ServiceEndpointSchema.optional(),
  status: z.enum(['online', 'offline', 'busy', 'draining']).default('offline'),
  lastSeen: z.number().describe('Last heartbeat timestamp'),
  registeredAt: z.number().describe('Registration timestamp'),
})

export type AgentRegistryEntry = z.infer<typeof AgentRegistryEntrySchema>

// ============================================================================
// Subscription
// ============================================================================

export const SubscriptionSchema = z.object({
  id: z.string().describe('Subscription ID'),
  agentId: z.string().describe('Subscriber agent ID'),
  filter: z.object({
    capability: z.string().optional().describe('Filter by capability'),
    agentType: z.enum(['user', 'agent', 'service']).optional().describe('Filter by type'),
    tags: z.array(z.string()).optional().describe('Filter by tags'),
  }),
  callback: z.string().url().optional().describe('Callback URL for notifications'),
})

export type Subscription = z.infer<typeof SubscriptionSchema>

// ============================================================================
// ACP Config
// ============================================================================

export const ACPConfigSchema = z.object({
  agentId: z.string().describe('This agent\'s ID'),
  agentName: z.string().describe('This agent\'s name'),
  registryUrl: z.string().url().optional().describe('Registry URL for service discovery'),
  heartbeatInterval: z.number().default(30000).describe('Heartbeat interval in ms'),
  discoveryTimeout: z.number().default(5000).describe('Discovery timeout in ms'),
  messageTimeout: z.number().default(30000).describe('Message timeout in ms'),
})

export type ACPConfig = z.infer<typeof ACPConfigSchema>

// ============================================================================
// Error Types
// ============================================================================

export const ACPErrorSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('agent_not_found'),
    agentId: z.string(),
  }),
  z.object({
    type: z.literal('capability_not_found'),
    capability: z.string(),
  }),
  z.object({
    type: z.literal('message_timeout'),
    messageId: z.string(),
  }),
  z.object({
    type: z.literal('invalid_message'),
    reason: z.string(),
  }),
  z.object({
    type: z.literal('registry_unavailable'),
    reason: z.string(),
  }),
  z.object({
    type: z.literal('subscription_failed'),
    reason: z.string(),
  }),
])

export type ACPError = z.infer<typeof ACPErrorSchema>
