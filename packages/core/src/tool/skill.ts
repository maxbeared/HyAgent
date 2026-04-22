/**
 * Skill Tool - Invoke reusable skills
 *
 * Skills are reusable prompt templates that can be invoked by name.
 */

import { z } from 'zod'
import { Effect } from 'effect'
import type { ToolDef } from './tool.js'
import { getSkillService } from '../skill/service.js'

// ============================================================================
// Tool Input/Output Types
// ============================================================================

/**
 * Skill tool input schema
 */
export const SkillToolInputSchema = z.object({
  skill: z.string().describe('The skill name to invoke'),
  args: z.string().optional().describe('Optional arguments for the skill'),
})

export type SkillToolInput = z.infer<typeof SkillToolInputSchema>

// ============================================================================
// Tool Definition
// ============================================================================

/**
 * Create the skill tool
 */
export function createSkillTool(): ToolDef<typeof SkillToolInputSchema, SkillMetadata> {
  return {
    id: 'skill',
    description: 'Invoke a reusable skill by name. Skills are pre-defined prompt templates stored in ~/.hybrid-agent/skills/ or project-level skills/ directories. Use this when you want to perform a specialized task that has a corresponding skill defined.',

    parameters: SkillToolInputSchema,

    isConcurrencySafe() {
      return true
    },

    execute(input) {
      return Effect.gen(function* () {
        const startTime = Date.now()
        const service = getSkillService()

        const result = yield* Effect.either(service.invokeSkill(input.skill, input.args))

        if (result._tag === 'Left') {
          const error = result.left as Error
          return {
            title: `Skill: ${input.skill}`,
            metadata: {
              skill: input.skill,
              success: false,
              durationMs: Date.now() - startTime,
            } as SkillMetadata,
            output: `Error: ${error.message}`,
          }
        }

        const { skill, content } = result.right

        return {
          title: `Skill: ${skill.name}`,
          metadata: {
            skill: skill.name,
            context: skill.context || 'inline',
            success: true,
            durationMs: Date.now() - startTime,
          } as SkillMetadata,
          output: content,
        }
      })
    },
  }
}

/**
 * Skill tool metadata
 */
export interface SkillMetadata {
  [key: string]: unknown
  skill: string
  context?: 'inline' | 'fork'
  success: boolean
  durationMs: number
}
