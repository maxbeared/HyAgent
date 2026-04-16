/**
 * Hybrid Agent - Development Entry Point
 *
 * Run with: pnpm dev
 *
 * Architecture:
 *   dev.ts        → entry point (this file)
 *   config.ts     → configuration loading
 *   permission.ts → path/command safety checks
 *   server.ts     → Hono HTTP routes
 *   agent/loop.ts → core agent loop (streaming, doom loop, compaction)
 *   agent/tools.ts → tool definitions and concurrent execution
 *   agent/compaction.ts → session compaction
 */

import { serve } from '@hono/node-server'
import { loadConfig } from './config.js'
import { createApp } from './server.js'

const PORT = Number(process.env.PORT ?? 3001)

const { config, suggestions } = loadConfig()

if (!config.apiKey) {
  console.warn('[WARNING] No API key configured. Set ANTHROPIC_API_KEY or create a config file.')
  console.warn('  See CLAUDE.md for configuration options.')
}

console.log(`[Hybrid Agent] Provider: ${config.provider}, Model: ${config.model}`)
console.log(`[Hybrid Agent] Config suggestions found: ${suggestions.length}`)

const app = createApp({ current: config, suggestions })

serve({ fetch: app.fetch, port: PORT }, info => {
  console.log(`[Hybrid Agent] Server running at http://localhost:${info.port}`)
  console.log(`[Hybrid Agent] Health: http://localhost:${info.port}/health`)
  console.log(`[Hybrid Agent] Agent: POST http://localhost:${info.port}/api/agent/execute`)
  console.log(`[Hybrid Agent] Stream: GET  http://localhost:${info.port}/api/agent/stream?task=...`)
})
