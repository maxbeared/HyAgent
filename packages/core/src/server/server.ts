/**
 * Server - Hono服务端入口
 *
 * 参考来源: opencode/packages/opencode/src/server/server.ts
 */

import { Effect, Layer, Context } from 'effect'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'

// ============================================================================
// Types
// ============================================================================

/**
 * Server configuration
 */
export interface ServerConfig {
  port?: number
  host?: string
}

/**
 * Server handle
 */
export interface ServerHandle {
  close(): void
}

// ============================================================================
// Server Implementation
// ============================================================================

/**
 * Create and start the server
 */
export function createServer(config: ServerConfig = {}) {
  const app = new Hono()

  // Middleware
  app.use('*', logger())
  app.use('*', cors())

  // Health check
  app.get('/health', (c) => c.json({ status: 'ok', timestamp: Date.now() }))

  // API routes (placeholder)
  app.get('/api/providers', (c) => {
    return c.json([
      { id: 'anthropic', name: 'Anthropic' },
      { id: 'openai', name: 'OpenAI' },
      { id: 'google', name: 'Google' },
    ])
  })

  app.get('/api/models', (c) => {
    const provider = c.req.query('provider') ?? 'anthropic'
    // Return models for provider
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

  // Message routes
  app.post('/api/sessions/:id/messages', async (c) => {
    const id = c.req.param('id')
    const body = await c.req.json()
    return c.json({
      id: `msg_${Date.now()}`,
      sessionID: id,
      role: 'user',
      parts: body.parts ?? [{ type: 'text', content: body.content ?? '' }],
      timestamp: Date.now(),
    })
  })

  // WebSocket upgrade for real-time communication
  app.get('/ws', (c) => {
    // In a real implementation, handle WebSocket upgrade
    return c.json({ message: 'WebSocket endpoint' })
  })

  return app
}

/**
 * Start server
 */
export async function startServer(config: ServerConfig = {}): Promise<ServerHandle> {
  const app = createServer(config)
  const port = config.port ?? 3000
  const host = config.host ?? '0.0.0.0'

  // Use hono/node-server for local development
  const { serve } = await import('@hono/node-server')

  const server = serve({
    fetch: app.fetch,
    port,
    hostname: host,
  })

  console.log(`Server running at http://${host}:${port}`)

  return {
    close() {
      server.close()
    },
  }
}

// ============================================================================
// Effect-based Server
// ============================================================================

/**
 * Server service interface
 */
export interface ServerService {
  start(config?: ServerConfig): Effect.Effect<ServerHandle>
  stop(handle: ServerHandle): Effect.Effect<void>
}

/**
 * Server service tag for Effect context
 */
export const ServerService = Context.GenericTag<ServerService>('@hyagent/server')

/**
 * Create Server Service layer
 */
export const ServerServiceLayer = Layer.effect(
  ServerService,
  Effect.gen(function* () {
    return ServerService.of({
      start(config) {
        return Effect.promise(() => startServer(config))
      },
      stop(handle) {
        return Effect.sync(() => handle.close())
      },
    })
  })
)
