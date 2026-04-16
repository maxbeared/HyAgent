/**
 * Development entry point
 * Run with: pnpm dev
 */

import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'

// Create app
const app = new Hono()

// Middleware
app.use('*', logger())
app.use('*', cors())

// Health check
app.get('/health', (c) => c.json({ status: 'ok', timestamp: Date.now() }))

// API routes
app.get('/api/providers', (c) => {
  return c.json([
    { id: 'anthropic', name: 'Anthropic' },
    { id: 'openai', name: 'OpenAI' },
    { id: 'google', name: 'Google' },
  ])
})

app.get('/api/models', (c) => {
  const provider = c.req.query('provider') ?? 'anthropic'
  return c.json([
    { id: `${provider}/model-1`, name: 'Model 1' },
    { id: `${provider}/model-2`, name: 'Model 2' },
  ])
})

// Session routes
app.post('/api/sessions', async (c) => {
  const body = await c.req.json()
  const sessionID = `session_${Date.now()}`
  return c.json({ id: sessionID, ...body })
})

app.get('/api/sessions/:id', (c) => {
  const id = c.req.param('id')
  return c.json({
    id,
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })
})

app.get('/api/sessions', (c) => {
  return c.json([])
})

// Permission check endpoint
app.post('/api/permission/check', async (c) => {
  const body = await c.req.json()
  const { path } = body

  // Import path validation
  const { validatePathSafety } = await import('./permission/pathValidation.js')

  const result = validatePathSafety(path)
  return c.json(result)
})

console.log('Starting Hybrid Agent development server...')
console.log('Server running at http://0.0.0.0:3000')
console.log('Press Ctrl+C to stop')

// Start server
serve({
  fetch: app.fetch,
  port: 3000,
  hostname: '0.0.0.0',
})
