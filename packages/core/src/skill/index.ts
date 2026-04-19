/**
 * Skill System
 *
 * Reusable prompt templates that can be invoked by name.
 */

export type { Skill, SkillSource, SkillInput, SkillResult, SkillFrontmatter } from './types.js'
export { SkillInputSchema } from './types.js'

export { getSkillService, type SkillService } from './service.js'
export { discoverSkills, generateSkillContent, getSkillDirectories } from './discovery.js'

export { createSkillTool, type SkillMetadata } from '../tool/skill.js'
