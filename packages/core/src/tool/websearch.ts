/**
 * Web Search Tool - 让 Agent 能够搜索网页
 *
 * 使用搜索引擎 API 搜索网页并返回结果摘要。
 */

import { z } from 'zod'
import { Effect } from 'effect'
import type { ToolDef, ExecuteResult } from './tool.js'

// ============================================================================
// Tool Input/Output Types
// ============================================================================

/**
 * Web search input schema
 */
export const WebSearchInputSchema = z.object({
  query: z.string().describe('Search query'),
  limit: z.number().min(1).max(20).default(5).describe('Maximum number of results to return'),
})

export type WebSearchInput = z.infer<typeof WebSearchInputSchema>

// ============================================================================
// Tool Definition
// ============================================================================

/**
 * Web search tool
 */
export function createWebSearchTool(
  searchFn: (query: string, limit: number) => Promise<WebSearchResult[]>
): ToolDef<typeof WebSearchInputSchema, WebSearchMetadata> {
  return {
    id: 'websearch',
    description: 'Search the web for information. Use this when you need to find current information, look up facts, or research topics that require internet access. Returns search results with titles, URLs, and snippets.',
    parameters: WebSearchInputSchema,

    isConcurrencySafe() {
      return true
    },

    execute(input) {
      return Effect.gen(function* () {
        const startTime = Date.now()

        try {
          const results = yield* Effect.promise(() => searchFn(input.query, input.limit))

          const output = results
            .map((r, i) => `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.snippet}`)
            .join('\n\n')

          return {
            title: `Web Search: ${input.query}`,
            metadata: {
              query: input.query,
              resultCount: results.length,
              durationMs: Date.now() - startTime,
            } as WebSearchMetadata,
            output: output || 'No results found.',
          }
        } catch (err) {
          return {
            title: `Web Search: ${input.query}`,
            metadata: { query: input.query, durationMs: Date.now() - startTime } as WebSearchMetadata,
            output: `Search error: ${err instanceof Error ? err.message : String(err)}`,
          }
        }
      })
    },
  }
}

/**
 * Web search result
 */
export interface WebSearchResult {
  title: string
  url: string
  snippet: string
}

/**
 * Web search metadata
 */
export interface WebSearchMetadata {
  [key: string]: unknown
  query: string
  resultCount?: number
  durationMs: number
}

// ============================================================================
// Search Provider Interface
// ============================================================================

/**
 * Search provider function type
 */
type SearchProvider = (query: string, limit: number) => Promise<WebSearchResult[]>

/**
 * Search provider with name
 */
interface SearchProviderDef {
  name: string
  search: SearchProvider
}

// ============================================================================
// Search Providers
// ============================================================================


/**
 * DuckDuckGo HTML search
 */
async function duckduckgoHtmlSearch(query: string, limit: number): Promise<WebSearchResult[]> {
  const encodedQuery = encodeURIComponent(query)
  const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}&kl=wt-wt`

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    signal: AbortSignal.timeout(10000),
  })

  if (!response.ok) {
    throw new Error(`DuckDuckGo failed: ${response.status}`)
  }

  const html = await response.text()
  const results: WebSearchResult[] = []

  const resultRegex = /<a class="result__a" href="([^"]+)">([^<]+)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g

  let match
  while ((match = resultRegex.exec(html)) !== null && results.length < limit) {
    const url = match[1]
    const title = match[2].trim()
    const snippet = match[3].replace(/<[^>]+>/g, '').trim()
    results.push({ title, url, snippet })
  }

  return results
}

/**
 * Bing HTML search
 */
async function bingSearch(query: string, limit: number): Promise<WebSearchResult[]> {
  const encodedQuery = encodeURIComponent(query)
  const url = `https://www.bing.com/search?q=${encodedQuery}`

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    signal: AbortSignal.timeout(10000),
  })

  if (!response.ok) {
    throw new Error(`Bing failed: ${response.status}`)
  }

  const html = await response.text()
  const results: WebSearchResult[] = []

  // Parse Bing results - match h2 > a and following div.b_caption > p
  const resultRegex = /<li class="b_algo"[^>]*>[\s\S]*?<h2[^>]*><a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<div class="b_caption"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/g

  let match
  while ((match = resultRegex.exec(html)) !== null && results.length < limit) {
    const url = match[1]
    const title = match[2].replace(/<[^>]+>/g, '').trim()
    const snippet = match[3].replace(/<[^>]+>/g, '').trim()
    if (title && url) {
      results.push({ title, url, snippet })
    }
  }

  return results
}

/**
 * SerpAPI-style free search (using Google via scraperAPI alternative)
 * Falls back to a simple Google search
 */
async function googleSearch(query: string, limit: number): Promise<WebSearchResult[]> {
  const encodedQuery = encodeURIComponent(query)
  // Use Google search via webcache or similar public endpoint
  const url = `https://www.google.com/search?q=${encodedQuery}&num=${limit}`

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html',
    },
    signal: AbortSignal.timeout(10000),
  })

  if (!response.ok) {
    throw new Error(`Google failed: ${response.status}`)
  }

  const html = await response.text()
  const results: WebSearchResult[] = []

  // Parse Google results
  const resultRegex = /<div class="BNEwe[^"]*"[^>]*>[\s\S]*?<a href="([^"]+)"[^>]*>([^<]+)<\/a>[\s\S]*?<span class="w1kFxf[^"]*">([\s\S]*?)<\/span>/g

  let match
  while ((match = resultRegex.exec(html)) !== null && results.length < limit) {
    const url = match[1]
    const title = match[2].replace(/<[^>]+>/g, '').trim()
    const snippet = match[3].replace(/<[^>]+>/g, '').trim()
    if (title && url && !url.startsWith('/')) {
      results.push({ title, url, snippet })
    }
  }

  return results
}

/**
 * Searx search (open source meta-search engine)
 * Public instances available
 */
async function searxSearch(query: string, limit: number): Promise<WebSearchResult[]> {
  const encodedQuery = encodeURIComponent(query)
  // Use public Searx instance
  const url = `https://searx.org/search?q=${encodedQuery}&format=json`

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; HyAgent/1.0)',
    },
    signal: AbortSignal.timeout(10000),
  })

  if (!response.ok) {
    throw new Error(`Searx failed: ${response.status}`)
  }

  const data = await response.json() as { results?: Array<{ url: string; title: string; content?: string }> }

  if (!data.results) {
    return []
  }

  return data.results.slice(0, limit).map((r) => ({
    title: r.title || 'No title',
    url: r.url,
    snippet: r.content || '',
  }))
}

// ============================================================================
// Exports (for testing)
// ============================================================================

// export { duckduckgoHtmlSearch }  // Requires direct network access
export { bingSearch }  // ✓ Working
// export { googleSearch }  // Requires direct network access
// export { searxSearch }  // May be blocked by VPN

// ============================================================================
// Fallback Search with Multiple Providers
// ============================================================================

/**
 * Search providers in order of preference
 *
 * Note: DuckDuckGo, Google, Searx may be blocked by VPN/firewall in some environments.
 * If a provider fails/times out, the fallback will try the next one.
 * Current working configuration: Bing + (Searx if accessible)
 */
const SEARCH_PROVIDERS: SearchProviderDef[] = [
  // { name: 'DuckDuckGo', search: duckduckgoHtmlSearch },  // Requires direct network access
  { name: 'Bing', search: bingSearch },  // ✓ Working
  // { name: 'Google', search: googleSearch },  // Requires direct network access
  // { name: 'Searx', search: searxSearch },  // May be blocked by VPN
]

/**
 * Search with automatic fallback through multiple providers
 */
export async function duckduckgoSearch(query: string, limit: number = 5): Promise<WebSearchResult[]> {
  const errors: string[] = []

  for (const provider of SEARCH_PROVIDERS) {
    try {
      const results = await provider.search(query, limit)
      if (results.length > 0) {
        return results
      }
      // Empty results, try next provider
      errors.push(`${provider.name}: empty results`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`${provider.name}: ${msg}`)
    }
  }

  // All providers failed
  throw new Error(`All search providers failed:\n${errors.join('\n')}`)
}
