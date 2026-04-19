/**
 * Dynamic Agent Generation
 *
 * Generate agents dynamically from descriptions.
 *
 * Reference: opencode/packages/opencode/src/agent/dynamic/
 */

import { Effect, Layer, Context } from 'effect'
import { z } from 'zod'
import { randomUUID } from 'crypto'

// ============================================================================
// Agent Template Types
// ============================================================================

export const AgentTemplateSchema = z.object({
  name: z.string().describe('Agent name'),
  description: z.string().describe('Agent description'),
  type: z.enum(['build', 'plan', 'general', 'explore', 'review', 'research', 'coding', 'custom']).describe('Agent type'),
  systemPrompt: z.string().optional().describe('Custom system prompt'),
  tools: z.array(z.string()).or(z.literal('*')).describe('Allowed tools'),
  maxTurns: z.number().optional().describe('Max conversation turns'),
  model: z.string().optional().describe('Specific model to use'),
  permissions: z.record(z.unknown()).optional().describe('Permission ruleset'),
})

export type AgentTemplate = z.infer<typeof AgentTemplateSchema>

// ============================================================================
// Dynamic Agent Request
// ============================================================================

export const DynamicAgentRequestSchema = z.object({
  description: z.string().describe('Natural language description of the agent to create'),
  name: z.string().optional().describe('Optional custom name'),
  type: z.enum(['build', 'plan', 'general', 'explore', 'review', 'research', 'coding', 'custom']).optional().describe('Agent type'),
  tools: z.array(z.string()).or(z.literal('*')).optional().describe('Tools to allow'),
  context: z.record(z.unknown()).optional().describe('Additional context'),
})

export type DynamicAgentRequest = z.infer<typeof DynamicAgentRequestSchema>

// ============================================================================
// Generated Agent
// ============================================================================

export interface GeneratedAgent {
  id: string
  template: AgentTemplate
  createdAt: number
  description: string
}

// ============================================================================
// Agent Registry
// ============================================================================

export const AgentRegistryEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  description: z.string(),
  template: AgentTemplateSchema,
  createdAt: z.number(),
})

export type AgentRegistryEntry = z.infer<typeof AgentRegistryEntrySchema>

// ============================================================================
// Agent Generation Service
// ============================================================================

export class DynamicAgentService {
  private registry: Map<string, AgentRegistryEntry> = new Map()
  private templates: Map<string, AgentTemplate> = new Map()

  constructor() {
    // Register built-in templates
    this.registerBuiltinTemplates()
  }

  private registerBuiltinTemplates(): void {
    // Build agent - for implementing features
    this.registerTemplate({
      name: 'Build Agent',
      description: 'Agent specialized in building and implementing code',
      type: 'build',
      systemPrompt: 'You are a skilled software engineer focused on implementing high-quality code. Follow best practices, write clean code, and ensure proper testing.',
      tools: ['*'],
      maxTurns: 100,
    })

    // Plan agent - for planning and architecture
    this.registerTemplate({
      name: 'Plan Agent',
      description: 'Agent specialized in planning and architecture design',
      type: 'plan',
      systemPrompt: 'You are a software architect focused on planning and design. Break down requirements into clear specifications and architectural decisions.',
      tools: ['read', 'glob', 'grep', 'task', 'task_result', 'task_list'],
      maxTurns: 50,
    })

    // Review agent - for code review
    this.registerTemplate({
      name: 'Review Agent',
      description: 'Agent specialized in code review',
      type: 'review',
      systemPrompt: 'You are a code reviewer focused on quality and security. Provide constructive feedback on code changes.',
      tools: ['read', 'glob', 'grep', 'task', 'task_result', 'task_list'],
      maxTurns: 50,
    })

    // Research agent - for exploration
    this.registerTemplate({
      name: 'Research Agent',
      description: 'Agent specialized in research and exploration',
      type: 'research',
      systemPrompt: 'You are a researcher focused on gathering information and analyzing options. Be thorough and provide well-sourced insights.',
      tools: ['read', 'glob', 'grep', 'websearch', 'webfetch', 'task', 'task_result', 'task_list'],
      maxTurns: 30,
    })

    // Explore agent - for codebase exploration
    this.registerTemplate({
      name: 'Explore Agent',
      description: 'Agent specialized in exploring and understanding codebases',
      type: 'explore',
      systemPrompt: 'You are an explorer focused on understanding code structure and relationships. Map out the codebase and identify key components.',
      tools: ['read', 'glob', 'grep', 'webfetch', 'task', 'task_result', 'task_list'],
      maxTurns: 20,
    })

    // Coding agent - general coding
    this.registerTemplate({
      name: 'Coding Agent',
      description: 'General coding agent',
      type: 'coding',
      systemPrompt: 'You are a versatile software engineer. Write clean, efficient, and maintainable code.',
      tools: ['*'],
      maxTurns: 100,
    })
  }

  /**
   * Register a custom template
   */
  registerTemplate(template: AgentTemplate): void {
    const key = template.name.toLowerCase().replace(/\s+/g, '_')
    this.templates.set(key, template)
    this.templates.set(template.type, template)
  }

  /**
   * Get template by name or type
   */
  getTemplate(key: string): AgentTemplate | undefined {
    return this.templates.get(key.toLowerCase().replace(/\s+/g, '_'))
  }

  /**
   * List all available templates
   */
  listTemplates(): AgentTemplate[] {
    const seen = new Set<string>()
    const templates: AgentTemplate[] = []

    for (const template of this.templates.values()) {
      if (!seen.has(template.name)) {
        seen.add(template.name)
        templates.push(template)
      }
    }

    return templates
  }

  /**
   * Generate agent from description
   */
  generateAgent(request: DynamicAgentRequest): GeneratedAgent {
    const id = `dynamic-${randomUUID().substring(0, 8)}`

    // Find best matching template based on description
    const template = this.findMatchingTemplate(request.description, request.type)

    // Build final template
    const finalTemplate: AgentTemplate = {
      name: request.name || template?.name || 'Generated Agent',
      description: request.description,
      type: request.type || template?.type || 'general',
      systemPrompt: template?.systemPrompt,
      tools: request.tools || template?.tools || ['*'],
      maxTurns: template?.maxTurns,
      model: template?.model,
      permissions: template?.permissions,
    }

    // Create registry entry
    const entry: AgentRegistryEntry = {
      id,
      name: finalTemplate.name,
      type: finalTemplate.type,
      description: request.description,
      template: finalTemplate,
      createdAt: Date.now(),
    }

    this.registry.set(id, entry)

    return {
      id,
      template: finalTemplate,
      createdAt: entry.createdAt,
      description: request.description,
    }
  }

  /**
   * Find matching template based on description
   */
  private findMatchingTemplate(description: string, type?: string): AgentTemplate | undefined {
    // If type specified, use that
    if (type) {
      const byType = this.templates.get(type)
      if (byType) return byType
    }

    // Keywords matching
    const lowerDesc = description.toLowerCase()

    if (lowerDesc.includes('build') || lowerDesc.includes('implement') || lowerDesc.includes('code')) {
      return this.templates.get('build')
    }
    if (lowerDesc.includes('plan') || lowerDesc.includes('design') || lowerDesc.includes('architect')) {
      return this.templates.get('plan')
    }
    if (lowerDesc.includes('review') || lowerDesc.includes('feedback')) {
      return this.templates.get('review')
    }
    if (lowerDesc.includes('research') || lowerDesc.includes('investigate') || lowerDesc.includes('analyze')) {
      return this.templates.get('research')
    }
    if (lowerDesc.includes('explore') || lowerDesc.includes('understand') || lowerDesc.includes('map')) {
      return this.templates.get('explore')
    }
    if (lowerDesc.includes('code') || lowerDesc.includes('program')) {
      return this.templates.get('coding')
    }

    return undefined
  }

  /**
   * Get agent by ID
   */
  getAgent(id: string): AgentRegistryEntry | undefined {
    return this.registry.get(id)
  }

  /**
   * List all generated agents
   */
  listAgents(): AgentRegistryEntry[] {
    return Array.from(this.registry.values())
  }

  /**
   * Remove agent from registry
   */
  removeAgent(id: string): boolean {
    return this.registry.delete(id)
  }

  /**
   * Create agent instance for execution
   */
  createAgentInstance(agentId: string): AgentInstance | undefined {
    const entry = this.registry.get(agentId)
    if (!entry) return undefined

    return {
      id: agentId,
      name: entry.name,
      type: entry.type,
      template: entry.template,
      status: 'idle',
      createdAt: entry.createdAt,
    }
  }
}

// ============================================================================
// Agent Instance
// ============================================================================

export interface AgentInstance {
  id: string
  name: string
  type: string
  template: AgentTemplate
  status: 'idle' | 'running' | 'completed' | 'failed' | 'stopped'
  createdAt: number
}

// ============================================================================
// Effect Context
// ============================================================================

export const DynamicAgentServiceContext = Context.GenericTag<DynamicAgentService>('DynamicAgentService')

// ============================================================================
// Singleton
// ============================================================================

let dynamicAgentService: DynamicAgentService | null = null

export function getDynamicAgentService(): DynamicAgentService {
  if (!dynamicAgentService) {
    dynamicAgentService = new DynamicAgentService()
  }
  return dynamicAgentService
}

// ============================================================================
// Convenience Functions
// ============================================================================

export function generateAgent(request: DynamicAgentRequest): GeneratedAgent {
  return getDynamicAgentService().generateAgent(request)
}

export function listAgentTemplates(): AgentTemplate[] {
  return getDynamicAgentService().listTemplates()
}

export function getAgentTemplates(): Map<string, AgentTemplate> {
  return getDynamicAgentService()['templates']
}
