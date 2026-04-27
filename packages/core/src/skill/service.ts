/**
 * Skill Service
 *
 * Manages skill loading, discovery, and invocation.
 */

import { Effect, Ref } from 'effect'
import type { Skill } from './types.js'
import { discoverSkills, generateSkillContent } from './discovery.js'
import { builtinSkills, builtinToSkill } from './builtin/index.js'

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

        // Load built-in skills first
        const builtins = builtinSkills.map(builtinToSkill)
        const skillMap = new Map(builtins.map((s) => [s.name, s]))

        // Then load disk-based skills
        const diskSkills = yield* Effect.promise(() => discoverSkills())
        for (const skill of diskSkills) {
          skillMap.set(skill.name, skill)
        }

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
      const skillEffect = self.getSkill(name)
      return Effect.gen(function* () {
        const skill = yield* skillEffect
        if (!skill) {
          return { skill: null as unknown as Skill, content: '' }
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
