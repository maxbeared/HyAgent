/**
 * Skill URL Fetcher
 *
 * Fetch skills from remote URLs, supporting SKILL.md format.
 *
 * Reference: opencode/packages/opencode/src/skill/url.ts
 */

import { Effect, Ref } from 'effect'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import { z } from 'zod'
import { randomUUID } from 'crypto'

// ============================================================================
// Types
// ============================================================================

import type { Skill, SkillFrontmatter } from './types.js'
import { SkillFrontmatterSchema } from './types.js'

// ============================================================================
// Skill URL Entry
// ============================================================================

export const SkillURLEntrySchema = z.object({
  url: z.string().url(),
  name: z.string(),
  lastFetched: z.number(),
  etag: z.string().optional(),
  content: z.string().optional(),
  location: z.string().optional(),
})

export type SkillURLEntry = z.infer<typeof SkillURLEntrySchema>

// ============================================================================
// URL Fetcher Result
// ============================================================================

export interface FetchResult {
  skill: Skill
  content: string
  etag?: string
  cached: boolean
}

// ============================================================================
// URL Cache
// ============================================================================

const SKILL_URL_CACHE_DIR = join(homedir(), '.hybrid-agent', 'skill-cache')

function ensureCacheDir(): void {
  if (!existsSync(SKILL_URL_CACHE_DIR)) {
    mkdirSync(SKILL_URL_CACHE_DIR, { recursive: true })
  }
}

function getCachePath(name: string): string {
  return join(SKILL_URL_CACHE_DIR, `${name.replace(/[^a-z0-9]/gi, '_')}.json`)
}

/**
 * Load cached skill URL entry
 */
function loadCachedEntry(name: string): SkillURLEntry | undefined {
  const path = getCachePath(name)
  if (!existsSync(path)) return undefined

  try {
    const data = readFileSync(path, 'utf-8')
    return JSON.parse(data)
  } catch {
    return undefined
  }
}

/**
 * Save skill URL entry to cache
 */
function saveCachedEntry(entry: SkillURLEntry): void {
  ensureCacheDir()
  const path = getCachePath(entry.name)
  writeFileSync(path, JSON.stringify(entry, null, 2))
}

// ============================================================================
// SKILL.md Parsing
// ============================================================================

/**
 * Parse SKILL.md content (markdown with YAML frontmatter)
 */
export function parseSkillMarkdown(content: string, source: string): Skill {
  // Check for YAML frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)

  let frontmatter: Partial<SkillFrontmatter> = {}
  let markdownContent = content

  if (frontmatterMatch) {
    // Parse YAML frontmatter
    const yamlContent = frontmatterMatch[1]
    markdownContent = frontmatterMatch[2]

    // Simple YAML parsing (handles basic key: value pairs)
    for (const line of yamlContent.split('\n')) {
      const colonIndex = line.indexOf(':')
      if (colonIndex > 0) {
        const key = line.substring(0, colonIndex).trim()
        let value = line.substring(colonIndex + 1).trim()

        // Remove quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1)
        }

        // Parse arrays
        if (value.startsWith('[') && value.endsWith(']')) {
          value = value.slice(1, -1)
          frontmatter[key] = value.split(',').map((v) => v.trim().replace(/['"]/g, ''))
        } else {
          frontmatter[key] = value
        }
      }
    }
  }

  // Build skill object
  return {
    name: frontmatter.name || source,
    description: frontmatter.description || '',
    content: markdownContent.trim(),
    source: 'file',
    location: source,
    whenToUse: frontmatter.when_to_use,
    argumentHint: frontmatter.argument_hint,
    allowedTools: frontmatter.allowed_tools,
    model: frontmatter.model,
    disableModelInvocation: frontmatter.disable_model_invocation,
    userInvocable: frontmatter.user_invokable ?? true,
    context: frontmatter.context || 'inline',
    agent: frontmatter.agent,
  }
}

// ============================================================================
// URL Fetching
// ============================================================================

/**
 * Fetch a skill from URL
 */
export async function fetchSkillFromURL(
  url: string,
  options?: {
    etag?: string
    timeout?: number
  }
): Promise<FetchResult> {
  // Check cache first
  const name = extractNameFromURL(url)
  const cached = loadCachedEntry(name)

  // Prepare headers
  const headers: Record<string, string> = {}
  if (options?.etag || (cached?.etag && !isCacheStale(cached.lastFetched))) {
    headers['If-None-Match'] = options?.etag || cached?.etag || ''
  }

  // Fetch
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options?.timeout || 30000)

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (response.status === 304 && cached) {
      // Not modified, use cached
      return {
        skill: parseSkillMarkdown(cached.content!, cached.location),
        content: cached.content!,
        etag: cached.etag,
        cached: true,
      }
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const content = await response.text()
    const etag = response.headers.get('ETag') || cached?.etag

    // Update cache
    const entry: SkillURLEntry = {
      url,
      name,
      lastFetched: Date.now(),
      etag,
      content,
    }
    saveCachedEntry(entry)

    const skill = parseSkillMarkdown(content, url)

    return {
      skill,
      content,
      etag,
      cached: false,
    }
  } catch (e: any) {
    clearTimeout(timeout)

    // If fetch fails but we have cached content, use it
    if (cached?.content) {
      return {
        skill: parseSkillMarkdown(cached.content, cached.location),
        content: cached.content,
        etag: cached.etag,
        cached: true,
      }
    }

    throw e
  }
}

/**
 * Fetch multiple skills from URLs in parallel
 */
export async function fetchSkillsFromURLs(
  urls: string[],
  options?: {
    concurrency?: number
    timeout?: number
  }
): Promise<Map<string, FetchResult>> {
  const results = new Map<string, FetchResult>()
  const concurrency = options?.concurrency || 3

  // Process in batches
  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency)
    const batchResults = await Promise.allSettled(
      batch.map((url) => fetchSkillFromURL(url, { timeout: options?.timeout }))
    )

    for (let j = 0; j < batch.length; j++) {
      const result = batchResults[j]
      if (result.status === 'fulfilled') {
        results.set(batch[j], result.value)
      } else {
        console.error(`[Skill] Failed to fetch ${batch[j]}:`, result.reason)
      }
    }
  }

  return results
}

/**
 * Extract skill name from URL
 */
function extractNameFromURL(url: string): string {
  try {
    const parsed = new URL(url)
    const pathParts = parsed.pathname.split('/').filter(Boolean)
    const lastPart = pathParts[pathParts.length - 1] || 'skill'

    // Remove extension
    return lastPart.replace(/\.(md|txt|html)$/i, '')
  } catch {
    return 'skill'
  }
}

/**
 * Check if cache is stale (older than 24 hours)
 */
function isCacheStale(lastFetched: number): boolean {
  const staleThreshold = 24 * 60 * 60 * 1000 // 24 hours
  return Date.now() - lastFetched > staleThreshold
}

// ============================================================================
// Skill URL Registry
// ============================================================================

const registeredURLs: Map<string, string> = new Map() // name -> url

/**
 * Register a skill URL
 */
export function registerSkillURL(name: string, url: string): void {
  registeredURLs.set(name, url)
}

/**
 * Get registered skill URL
 */
export function getRegisteredSkillURL(name: string): string | undefined {
  return registeredURLs.get(name)
}

/**
 * List registered skill URLs
 */
export function listRegisteredSkillURLs(): Array<{ name: string; url: string }> {
  return Array.from(registeredURLs.entries()).map(([name, url]) => ({ name, url }))
}

/**
 * Fetch all registered skill URLs
 */
export async function fetchAllRegisteredSkills(): Promise<Map<string, FetchResult>> {
  const urls = Array.from(registeredURLs.values())
  return fetchSkillsFromURLs(urls)
}

// ============================================================================
// Skill Content Generation
// ============================================================================

/**
 * Generate skill content for invocation with args
 */
export function generateSkillContent(skill: Skill, args?: string): string {
  let content = skill.content

  // Replace {{args}} placeholder if present
  if (args && content.includes('{{args}}')) {
    content = content.replace(/\{\{args\}\}/g, args)
  }

  return content
}
