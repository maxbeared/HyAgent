/**
 * Skill Types
 *
 * Skills are reusable prompt templates that can be invoked by the user or agent.
 * Based on Claude Code's skill system.
 */

import { z } from 'zod'

// ============================================================================
// Skill Source
// ============================================================================

/**
 * Where a skill was loaded from
 */
export const SkillSourceSchema = z.enum(['bundled', 'file', 'plugin', 'mcp'])
export type SkillSource = z.infer<typeof SkillSourceSchema>

// ============================================================================
// Skill Definition
// ============================================================================

/**
 * Skill frontmatter schema (YAML frontmatter in SKILL.md)
 */
export const SkillFrontmatterSchema = z.object({
  name: z.string().describe('Skill name'),
  description: z.string().describe('Human-readable description of what the skill does'),
  when_to_use: z.string().optional().describe('When to use this skill'),
  argument_hint: z.string().optional().describe('Hint for expected arguments'),
  allowed_tools: z.array(z.string()).optional().describe('Tools this skill is allowed to use'),
  model: z.string().optional().describe('Model to use for this skill'),
  disable_model_invocation: z.boolean().optional().describe('Disable LLM for this skill'),
  user_invokable: z.boolean().optional().describe('Whether user can invoke this skill directly'),
  context: z.enum(['inline', 'fork']).optional().describe('Execution context: inline (inject into conversation) or fork (run as subagent)'),
  agent: z.string().optional().describe('Agent to use for forked execution'),
})

export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>

/**
 * Skill definition
 */
export interface Skill {
  name: string
  description: string
  content: string  // The actual prompt/markdown content
  source: SkillSource
  location: string  // File path or identifier
  whenToUse?: string
  argumentHint?: string
  allowedTools?: string[]
  model?: string
  disableModelInvocation?: boolean
  userInvocable?: boolean
  context?: 'inline' | 'fork'
  agent?: string
}

// ============================================================================
// Skill Input/Output
// ============================================================================

/**
 * Skill invocation input
 */
export const SkillInputSchema = z.object({
  skill: z.string().describe('The skill name to invoke'),
  args: z.string().optional().describe('Optional arguments for the skill'),
})

export type SkillInput = z.infer<typeof SkillInputSchema>

/**
 * Skill invocation result
 */
export interface SkillResult {
  skill: string
  args?: string
  content: string  // The generated prompt content
  context: 'inline' | 'fork'
  success: boolean
}
