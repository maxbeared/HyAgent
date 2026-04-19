/**
 * Web Fetch Tool - 让 Agent 能够获取网页内容
 *
 * 获取指定 URL 的网页内容并返回简化后的文本。
 */

import { z } from 'zod'
import { Effect } from 'effect'
import type { ToolDef, ExecuteResult } from './tool.js'

// ============================================================================
// Tool Input/Output Types
// ============================================================================

/**
 * Web fetch input schema
 */
export const WebFetchInputSchema = z.object({
  url: z.string().url().describe('URL to fetch'),
  maxLength: z.number().min(100).max(50000).default(10000).describe('Maximum content length to return'),
})

export type WebFetchInput = z.infer<typeof WebFetchInputSchema>

// ============================================================================
// Tool Definition
// ============================================================================

/**
 * Web fetch tool
 */
export function createWebFetchTool(
  fetchFn: (url: string, maxLength: number) => Promise<WebFetchResult>
): ToolDef<typeof WebFetchInputSchema, WebFetchMetadata> {
  return {
    id: 'webfetch',
    description: 'Fetch the content of a web page. Use this to get detailed information from a specific URL. Returns the page title and main content, stripped of HTML tags and navigation elements.',
    parameters: WebFetchInputSchema,

    isConcurrencySafe() {
      return true
    },

    execute(input) {
      return Effect.gen(function* () {
        const startTime = Date.now()

        try {
          const result = yield* Effect.promise(() => fetchFn(input.url, input.maxLength))

          return {
            title: `Web Fetch: ${result.title || input.url}`,
            metadata: {
              url: input.url,
              title: result.title,
              contentLength: result.content.length,
              durationMs: Date.now() - startTime,
            } as WebFetchMetadata,
            output: `Title: ${result.title || 'N/A'}\n\n${result.content}`,
          }
        } catch (err) {
          return {
            title: `Web Fetch: ${input.url}`,
            metadata: { url: input.url, durationMs: Date.now() - startTime } as WebFetchMetadata,
            output: `Fetch error: ${err instanceof Error ? err.message : String(err)}`,
          }
        }
      })
    },
  }
}

/**
 * Web fetch result
 */
export interface WebFetchResult {
  title: string
  content: string
}

/**
 * Web fetch metadata
 */
export interface WebFetchMetadata {
  url: string
  title?: string
  contentLength?: number
  durationMs: number
}

// ============================================================================
// Default Implementation
// ============================================================================

/**
 * Default web fetch using fetch API
 */
export async function defaultWebFetch(url: string, maxLength: number = 10000): Promise<WebFetchResult> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Hybrid-Agent/1.0)',
      'Accept': 'text/html,application/xhtml+xml',
    },
  })

  if (!response.ok) {
    throw new Error(`Fetch failed: ${response.status} ${response.statusText}`)
  }

  const html = await response.text()

  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  const title = titleMatch ? titleMatch[1].trim() : ''

  // Strip HTML and get plain text
  let content = html
    // Remove scripts and styles
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    // Remove navigation and footer elements
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
    // Remove HTML comments
    .replace(/<!--[\s\S]*?-->/g, '')
    // Replace common elements with newlines
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    // Strip remaining HTML tags
    .replace(/<[^>]+>/g, '')
    // Decode HTML entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Clean up whitespace
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim()

  // Truncate if too long
  if (content.length > maxLength) {
    content = content.slice(0, maxLength) + '...'
  }

  return { title, content }
}
