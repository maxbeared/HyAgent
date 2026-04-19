/**
 * Skill Service
 *
 * Manages skill loading, discovery, and invocation.
 */

import { Effect, Ref } from 'effect'
import type { Skill } from './types.js'
import { discoverSkills, generateSkillContent } from './discovery.js'

// ============================================================================
// Service State
// ============================================================================

interface SkillServiceState {
  skills: Map<string, Skill>
  loaded: boolean
}

// ============================================================================
// Service
// ============================================================================

/**
 * Create a skill service
 */
export function createSkillService() {
  const state = Ref.unsafeMake<SkillServiceState>({
    skills: new Map(),
    loaded: false,
  })

  const self = {
    state,

    /**
     * Ensure skills are loaded
     */
    ensureLoaded(): Effect.Effect<void> {
      return Effect.gen(function* () {
        const current = yield* Ref.get(state)
        if (current.loaded) return

        const skills = yield* Effect.promise(() => discoverSkills())
        const skillMap = new Map(skills.map((s) => [s.name, s]))

        yield* Ref.set(state, { skills: skillMap, loaded: true })
      })
    },

    /**
     * Get a skill by name
     */
    getSkill(name: string): Effect.Effect<Skill | undefined> {
      return Effect.gen(function* () {
        yield* self.ensureLoaded()
        const current = yield* Ref.get(state)
        return current.skills.get(name)
      })
    },

    /**
     * Get all skills
     */
    getAllSkills(): Effect.Effect<Skill[]> {
      return Effect.gen(function* () {
        yield* self.ensureLoaded()
        const current = yield* Ref.get(state)
        return Array.from(current.skills.values())
      })
    },

    /**
     * List skill names
     */
    listSkillNames(): Effect.Effect<string[]> {
      return Effect.gen(function* () {
        yield* self.getAllSkills()
        const current = yield* Ref.get(state)
        return Array.from(current.skills.keys())
      })
    },

    /**
     * Generate skill content for invocation
     */
    invokeSkill(
      name: string,
      args?: string
    ): Effect.Effect<{ skill: Skill; content: string }> {
      return Effect.gen(function* () {
        const skill = yield* self.getSkill(name)
        if (!skill) {
          return yield* Effect.fail(new Error(`Skill not found: ${name}`))
        }

        const content = generateSkillContent(skill, args)
        return { skill, content }
      })
    },

    /**
     * Reload skills from disk
     */
    reload(): Effect.Effect<void> {
      return Effect.gen(function* () {
        yield* Ref.set(state, { skills: new Map(), loaded: false })
        yield* self.ensureLoaded()
      })
    },
  }

  return self
}

export type SkillService = ReturnType<typeof createSkillService>

// ============================================================================
// Singleton
// ============================================================================

let skillServiceInstance: SkillService | null = null

/**
 * Get the global skill service singleton
 */
export function getSkillService(): SkillService {
  if (!skillServiceInstance) {
    skillServiceInstance = createSkillService()
  }
  return skillServiceInstance
}
