/**
 * Skill Discovery
 *
 * Discovers skills from filesystem directories.
 * Skills are markdown files with YAML frontmatter (SKILL.md format).
 *
 * Skill sources (in priority order):
 * 1. Bundled/preset skills - shipped with the package (highest priority)
 * 2. User skills from ~/.hybrid-agent/skills/
 * 3. Project-level skills from .hybrid-agent/skills/ or skills/
 */

import { readdir, readFile } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import fm from 'front-matter'
import type { Skill, SkillFrontmatter, SkillSource } from './types.js'

// ============================================================================
// Directories
// ============================================================================

/**
 * Get the bundled presets directory (relative to this module)
 */
function getPresetsDirectory(): string {
  try {
    const currentFile = fileURLToPath(import.meta.url)
    const currentDir = dirname(currentFile)
    return join(currentDir, 'presets')
  } catch {
    return ''
  }
}

/**
 * Get skill directories to search (in priority order)
 *
 * Priority (first wins):
 * 1. Bundled preset skills (shipped with package)
 * 2. ~/.agents/skills (user's agent skills)
 * 3. ~/.claude/skills (Claude Code skills)
 * 4. ~/.hybrid-agent/skills (hybrid-agent user skills)
 * 5. Project-level skills
 */
export async function getSkillDirectories(): Promise<string[]> {
  const dirs: string[] = []
  const home = homedir()

  // 1. Bundled preset skills (highest priority - will be loaded first)
  const presetsDir = getPresetsDirectory()
  if (presetsDir) {
    dirs.push(presetsDir)
  }

  // 2. User skills from various sources
  dirs.push(join(home, '.agents', 'skills'))
  dirs.push(join(home, '.claude', 'skills'))
  dirs.push(join(home, '.hybrid-agent', 'skills'))

  // 3. Project-level skills
  try {
    const cwd = process.cwd()
    dirs.push(join(cwd, '.agents', 'skills'))
    dirs.push(join(cwd, '.claude', 'skills'))
    dirs.push(join(cwd, '.hybrid-agent', 'skills'))
    dirs.push(join(cwd, 'skills'))
  } catch {
    // process.cwd() might fail
  }

  // Deduplicate and filter existing directories
  const uniqueDirs = [...new Set(dirs)]
  const existingDirs: string[] = []

  for (const dir of uniqueDirs) {
    try {
      await readdir(dir)
      existingDirs.push(dir)
    } catch {
      // Directory doesn't exist, skip
    }
  }

  return existingDirs
}

// ============================================================================
// Frontmatter Parsing
// ============================================================================

interface ParsedSkill {
  frontmatter: SkillFrontmatter
  content: string
  raw: string
}

/**
 * Parse frontmatter from skill content
 */
function parseFrontmatter(content: string): ParsedSkill | null {
  try {
    const parsed = fm<SkillFrontmatter>(content)
    if (!parsed.attributes.name) {
      return null
    }
    return {
      frontmatter: parsed.attributes,
      content: parsed.body,
      raw: content,
    }
  } catch {
    return null
  }
}

// ============================================================================
// Skill Loading
// ============================================================================

/**
 * Load a single skill from a SKILL.md file
 */
export async function loadSkillFromFile(
  filePath: string,
  source: SkillSource = 'file'
): Promise<Skill | null> {
  try {
    const content = await readFile(filePath, 'utf-8')
    const parsed = parseFrontmatter(content)

    if (!parsed) {
      return null
    }

    const { frontmatter } = parsed
    const location = resolve(filePath)

    return {
      name: frontmatter.name,
      description: frontmatter.description,
      content: parsed.content.trim(),
      source,
      location,
      whenToUse: frontmatter.when_to_use,
      argumentHint: frontmatter.argument_hint,
      allowedTools: frontmatter.allowed_tools,
      model: frontmatter.model,
      disableModelInvocation: frontmatter.disable_model_invocation,
      userInvocable: frontmatter.user_invokable ?? true,
      context: frontmatter.context,
      agent: frontmatter.agent,
    }
  } catch {
    return null
  }
}

/**
 * Load skills from a directory
 */
export async function loadSkillsFromDirectory(
  dirPath: string,
  source: SkillSource = 'file'
): Promise<Skill[]> {
  const skills: Skill[] = []

  try {
    const entries = await readdir(dirPath, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const skillPath = join(dirPath, entry.name, 'SKILL.md')
      const skill = await loadSkillFromFile(skillPath, source)

      if (skill) {
        skills.push(skill)
      }
    }
  } catch {
    // Directory read failed
  }

  return skills
}

/**
 * Discover all available skills from all directories
 */
export async function discoverSkills(): Promise<Skill[]> {
  const directories = await getSkillDirectories()
  const presetsDir = getPresetsDirectory()
  const allSkills: Skill[] = []

  for (const dir of directories) {
    // Determine source based on directory
    const source: SkillSource = dir === presetsDir ? 'bundled' : 'file'
    const skills = await loadSkillsFromDirectory(dir, source)
    allSkills.push(...skills)
  }

  // Deduplicate by name (first occurrence wins - higher priority dirs first)
  const seen = new Set<string>()
  return allSkills.filter((skill) => {
    if (seen.has(skill.name)) return false
    seen.add(skill.name)
    return true
  })
}

// ============================================================================
// Skill Content Generation
// ============================================================================

/**
 * Generate the prompt content for a skill invocation
 */
export function generateSkillContent(
  skill: Skill,
  args?: string
): string {
  let content = skill.content
  const trimmedArgs = args?.trim()

  // Handle simple template variables
  // Replace {{args}} with the actual args value
  if (trimmedArgs) {
    content = content.replace(/\{\{args\}\}/g, trimmedArgs)
    // Handle {% if args %}...{% endif %} blocks
    content = content.replace(/\{% if args %\}([\s\S]*?)\{% endif %\}/g, '$1')
  } else {
    // Remove {% if args %}...{% endif %} blocks when no args
    content = content.replace(/\{% if args %\}[\s\S]*?\{% endif %\}/g, '')
  }

  // Append args as additional context if not already handled
  if (trimmedArgs && !content.includes(trimmedArgs)) {
    content += `\n\n## Additional Context\n\n${trimmedArgs}`
  }

  return content
}
