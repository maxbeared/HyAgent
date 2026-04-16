/**
 * Hono HTTP server with all API routes.
 *
 * Routes:
 * - GET  /health                          → health check
 * - GET  /api/info                        → server info
 * - GET  /api/config/suggestions          → imported config suggestions
 * - POST /api/config/apply                → apply a config suggestion
 * - GET  /api/providers                   → list providers
 * - GET  /api/models?provider=...         → list models for provider
 * - POST /api/models/refresh              → refresh models.dev cache
 * - POST /api/models                      → add custom model
 * - DELETE /api/models                    → remove custom model
 * - GET  /api/model/current               → current model
 * - PUT  /api/model/current               → set current model
 * - POST /api/permission/check            → check path safety
 * - POST /api/permission/check-command    → check command safety
 * - POST /api/sessions                    → create session
 * - GET  /api/sessions                    → list sessions
 * - GET  /api/sessions/:id                → get session
 * - DELETE /api/sessions/:id              → delete session
 * - POST /api/sessions/:id/messages       → add message
 * - GET  /api/sessions/:id/messages       → get messages
 * - POST /api/tools/execute               → execute single tool
 * - POST /api/agent/execute               → run agent loop (blocking, single task)
 * - GET  /api/agent/stream                → run agent loop (SSE, single task)
 * - POST /api/chat                        → single LLM call (no tools, no session)
 * - POST /api/chat/:sessionId            → continuous agent chat with tools (session history preserved)
 * - GET  /api/chat/:sessionId/stream     → SSE streaming version
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { streamSSE } from 'hono/streaming'
import type { Config, ConfigSuggestion } from './config.js'
import { checkPathSafety, checkCommandSafety } from './permission.js'
import { executeTool } from './agent/tools.js'
import { runAgentLoop, runAgentLoopStream, type AgentConfig } from './agent/loop.js'
import type { Message } from './agent/compaction.js'

// ---- Types ----

interface Session {
  id: string
  messages: any[]
  model?: string
  provider?: string
  createdAt: number
  updatedAt: number
}

interface Worker {
  id: string
  name: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  result?: string
}

interface ModelInfo {
  id: string
  name: string
  context: number
  provider?: string
  addedAt: number
  fromModelsDev?: boolean
}

// ---- In-memory state ----

const sessions = new Map<string, Session>()
const workers = new Map<string, Worker>()
const customModels = new Map<string, ModelInfo>()

let modelsDevCache: Record<string, any> = {}
let modelsDevCacheTime = 0
const MODELS_DEV_TTL = 5 * 60 * 1000

// ---- models.dev helpers ----

async function fetchModelsFromModelsDev(): Promise<Record<string, any>> {
  const now = Date.now()
  if (modelsDevCacheTime && now - modelsDevCacheTime < MODELS_DEV_TTL) {
    return modelsDevCache
  }
  try {
    const response = await fetch('https://models.dev/api.json', {
      headers: { 'User-Agent': 'HybridAgent/1.0' },
      signal: AbortSignal.timeout(10000),
    })
    if (response.ok) {
      modelsDevCache = await response.json()
      modelsDevCacheTime = now
    }
  } catch {
    // silently fail — will use cache or empty
  }
  return modelsDevCache
}

const CONFIG_MODELS: Record<string, string[]> = {
  anthropic: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'o3', 'o4-mini'],
  google: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  minimaxi: ['MiniMax-M2.7'],
}

async function getModelsForProvider(provider: string, currentModel: string): Promise<ModelInfo[]> {
  const result: ModelInfo[] = []

  // From models.dev
  const modelsDev = await fetchModelsFromModelsDev()
  if (modelsDev[provider]?.models) {
    for (const [modelId, modelData] of Object.entries(modelsDev[provider].models)) {
      const m = modelData as any
      result.push({
        id: modelId,
        name: m.name || modelId,
        context: m.limit?.context || 100000,
        provider,
        addedAt: 0,
        fromModelsDev: true,
      })
    }
  }

  // From config (fill in any not already listed)
  const existingIds = new Set(result.map(m => m.id))
  const configProviderModels = provider === 'minimaxi'
    ? [currentModel]
    : (CONFIG_MODELS[provider] ?? [])

  for (const modelId of configProviderModels) {
    if (!existingIds.has(modelId)) {
      result.push({ id: modelId, name: modelId, context: 100000, provider, addedAt: 0 })
    }
  }

  // Custom models
  for (const model of customModels.values()) {
    if (model.provider === provider) result.push(model)
  }

  return result
}

// ---- App factory ----

export function createApp(config: { current: Config; suggestions: ConfigSuggestion[] }) {
  const { suggestions } = config
  // config.current is mutable via PUT /api/model/current and POST /api/config/apply
  const cfg = config.current

  const app = new Hono()
  app.use('*', logger())
  app.use('*', cors())

  const agentCfg = (): AgentConfig => ({
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
    model: cfg.model,
  })

  // ---- Health & Info ----

  app.get('/health', c => c.json({
    status: 'ok',
    timestamp: Date.now(),
    version: '0.1.0',
    uptime: process.uptime(),
  }))

  app.get('/api/info', c => c.json({
    name: 'Hybrid Agent',
    version: '0.1.0',
    config: { provider: cfg.provider, model: cfg.model, hasApiKey: !!cfg.apiKey },
  }))

  // ---- Config ----

  app.get('/api/config/suggestions', c => c.json({
    suggestions,
    current: { provider: cfg.provider, baseUrl: cfg.baseUrl, model: cfg.model, hasApiKey: !!cfg.apiKey },
  }))

  app.post('/api/config/apply', async c => {
    const { source } = await c.req.json()
    const suggestion = suggestions.find(s => s.source === source)
    if (!suggestion) return c.json({ error: 'Suggestion not found' }, 404)
    if (suggestion.config.provider) cfg.provider = suggestion.config.provider
    if (suggestion.config.baseUrl) cfg.baseUrl = suggestion.config.baseUrl
    if (suggestion.config.apiKey) cfg.apiKey = suggestion.config.apiKey
    if (suggestion.config.model) cfg.model = suggestion.config.model
    return c.json({ success: true, config: { provider: cfg.provider, model: cfg.model, hasApiKey: !!cfg.apiKey } })
  })

  // ---- Providers & Models ----

  app.get('/api/providers', c => c.json([
    { id: 'anthropic', name: 'Anthropic' },
    { id: 'openai', name: 'OpenAI' },
    { id: 'google', name: 'Google' },
    { id: 'minimaxi', name: 'MiniMax' },
  ]))

  app.get('/api/models', async c => {
    const provider = c.req.query('provider') ?? cfg.provider
    const models = await getModelsForProvider(provider, cfg.model)
    return c.json(models)
  })

  app.post('/api/models/refresh', async c => {
    modelsDevCacheTime = 0
    const models = await fetchModelsFromModelsDev()
    return c.json({ success: true, providers: Object.keys(models).length })
  })

  app.post('/api/models', async c => {
    const { provider, modelId, modelName } = await c.req.json()
    if (!provider || !modelId) return c.json({ error: 'provider and modelId are required' }, 400)
    const info: ModelInfo = { id: modelId, name: modelName || modelId, context: 100000, provider, addedAt: Date.now() }
    customModels.set(`${provider}:${modelId}`, info)
    return c.json(info, 201)
  })

  app.delete('/api/models', async c => {
    const { provider, modelId } = await c.req.json()
    const key = `${provider}:${modelId}`
    if (!customModels.has(key)) return c.json({ error: 'Model not found' }, 404)
    customModels.delete(key)
    return c.json({ success: true })
  })

  app.get('/api/model/current', c => c.json({ provider: cfg.provider, model: cfg.model }))

  app.put('/api/model/current', async c => {
    const { provider, model } = await c.req.json()
    if (provider) cfg.provider = provider
    if (model) cfg.model = model
    return c.json({ provider: cfg.provider, model: cfg.model })
  })

  // ---- Permission ----

  app.post('/api/permission/check', async c => {
    const { path } = await c.req.json()
    return c.json(checkPathSafety(path))
  })

  app.post('/api/permission/check-command', async c => {
    const { command } = await c.req.json()
    return c.json(checkCommandSafety(command))
  })

  // ---- Sessions ----

  app.post('/api/sessions', async c => {
    const body = await c.req.json()
    const id = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const session: Session = { id, messages: [], model: body.model ?? cfg.model, provider: body.provider ?? cfg.provider, createdAt: Date.now(), updatedAt: Date.now() }
    sessions.set(id, session)
    return c.json(session, 201)
  })

  app.get('/api/sessions', c => c.json(Array.from(sessions.values())))

  app.get('/api/sessions/:id', c => {
    const session = sessions.get(c.req.param('id'))
    return session ? c.json(session) : c.json({ error: 'Session not found' }, 404)
  })

  app.delete('/api/sessions/:id', c => {
    sessions.delete(c.req.param('id'))
    return c.json({ success: true })
  })

  app.post('/api/sessions/:id/messages', async c => {
    const session = sessions.get(c.req.param('id'))
    if (!session) return c.json({ error: 'Session not found' }, 404)
    const body = await c.req.json()
    const message = { id: `msg_${Date.now()}`, role: body.role ?? 'user', content: body.content ?? '', timestamp: Date.now() }
    session.messages.push(message)
    session.updatedAt = Date.now()
    return c.json(message, 201)
  })

  app.get('/api/sessions/:id/messages', c => {
    const session = sessions.get(c.req.param('id'))
    return session ? c.json(session.messages) : c.json({ error: 'Session not found' }, 404)
  })

  // ---- Tools ----

  app.post('/api/tools/execute', async c => {
    const { tool, input } = await c.req.json()
    try {
      const result = await executeTool(tool, input)
      return c.json(result)
    } catch (e: any) {
      return c.json({ error: e.message }, 500)
    }
  })

  // ---- Agent: blocking ----

  app.post('/api/agent/execute', async c => {
    const { task, maxIterations } = await c.req.json()
    if (!task) return c.json({ error: 'task is required' }, 400)
    try {
      const result = await runAgentLoop(task, agentCfg(), maxIterations ?? 30)
      return c.json(result)
    } catch (e: any) {
      return c.json({ error: e.message, success: false }, 500)
    }
  })

  // ---- Agent: SSE streaming ----

  app.get('/api/agent/stream', async c => {
    const task = c.req.query('task')
    const maxIterations = Number(c.req.query('maxIterations') ?? 30)
    if (!task) return c.json({ error: 'task query param is required' }, 400)

    return streamSSE(c, async stream => {
      for await (const event of runAgentLoopStream(task, agentCfg(), maxIterations)) {
        await stream.writeSSE({ data: JSON.stringify(event) })
        if (event.type === 'done' || event.type === 'error') break
      }
    })
  })

  // POST variant for streaming (task in body)
  app.post('/api/agent/stream', async c => {
    const { task, maxIterations } = await c.req.json()
    if (!task) return c.json({ error: 'task is required' }, 400)

    return streamSSE(c, async stream => {
      for await (const event of runAgentLoopStream(task, agentCfg(), maxIterations ?? 30)) {
        await stream.writeSSE({ data: JSON.stringify(event) })
        if (event.type === 'done' || event.type === 'error') break
      }
    })
  })

  // ---- Chat (simple, no tools) ----

  app.post('/api/chat', async c => {
    const { sessionId, messages, model } = await c.req.json()
    const targetModel = model ?? cfg.model
    const baseUrl = cfg.baseUrl.replace(/\/v1$/, '')

    const apiMessages = (messages ?? []).map((m: any) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : m.content?.[0]?.text ?? '',
    }))
    if (apiMessages.length > 0 && apiMessages[0].role !== 'system') {
      apiMessages.unshift({ role: 'system', content: 'You are a helpful AI coding assistant.' })
    }

    try {
      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cfg.apiKey}`,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({ model: targetModel, max_tokens: 4096, messages: apiMessages }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        return c.json({ error: `API Error: ${response.status}`, details: errorText })
      }

      const data = await response.json() as any
      const textContent = data.content?.find((b: any) => b.type === 'text')
      const content = textContent?.text ?? '[No text response]'

      const msg = { id: `msg_${Date.now()}`, role: 'assistant', content, timestamp: Date.now() }
      if (sessionId) {
        const session = sessions.get(sessionId)
        if (session) { session.messages.push(msg); session.updatedAt = Date.now() }
      }
      return c.json({ message: msg, usage: data.usage ?? {} })
    } catch (e: any) {
      return c.json({ error: e.message }, 500)
    }
  })

  // ---- Chat with Agent (continuous conversation, tools enabled) ----

  // Send a message in an existing session — agent can use tools and sees full history
  app.post('/api/chat/:sessionId', async c => {
    const session = sessions.get(c.req.param('sessionId'))
    if (!session) return c.json({ error: 'Session not found' }, 404)

    const { content, maxIterations } = await c.req.json()
    if (!content) return c.json({ error: 'content is required' }, 400)

    // Convert session messages to the format expected by runAgentLoop
    const history: Message[] = session.messages.map((m: any) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : m.content,
    }))

    // Add user message to session
    const userMsg = { id: `msg_${Date.now()}`, role: 'user' as const, content, timestamp: Date.now() }
    session.messages.push(userMsg)

    // Run agent loop with session history
    const result = await runAgentLoop(content, agentCfg(), maxIterations ?? 30, history)

    // Append assistant messages from the loop to session
    // The loop returned the result; we need to add the assistant turn(s)
    // Build assistant message from the result content
    if (result.content) {
      session.messages.push({
        id: `msg_${Date.now()}`,
        role: 'assistant',
        content: result.content,
        timestamp: Date.now(),
      })
    }

    session.updatedAt = Date.now()

    return c.json({
      sessionId: session.id,
      message: result.content,
      iterations: result.iterations,
      success: result.success,
      error: result.error,
    })
  })

  // SSE streaming version of chat with session
  app.get('/api/chat/:sessionId/stream', async c => {
    const session = sessions.get(c.req.param('sessionId'))
    if (!session) return c.json({ error: 'Session not found' }, 404)

    const task = c.req.query('task') ?? c.req.query('content')
    if (!task) return c.json({ error: 'task or content query param is required' }, 400)

    const history: Message[] = session.messages.map((m: any) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : m.content,
    }))

    const userMsg = { id: `msg_${Date.now()}`, role: 'user' as const, content: task, timestamp: Date.now() }
    session.messages.push(userMsg)
    session.updatedAt = Date.now()

    return streamSSE(c, async stream => {
      for await (const event of runAgentLoopStream(task, agentCfg(), 30, history)) {
        await stream.writeSSE({ data: JSON.stringify(event) })
        // On completion, append the assistant message to session
        if (event.type === 'done' && event.content) {
          session.messages.push({
            id: `msg_${Date.now()}`,
            role: 'assistant',
            content: event.content,
            timestamp: Date.now(),
          })
        }
        if (event.type === 'done' || event.type === 'error') break
      }
    })
  })

  // ---- Coordinator (stub — real implementation via agent loop) ----

  app.post('/api/coordinator/spawn', async c => {
    const body = await c.req.json()
    const id = `worker_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const worker: Worker = { id, name: body.name ?? 'worker', status: 'pending' }
    workers.set(id, worker)
    // Kick off real agent loop in background
    worker.status = 'running'
    runAgentLoop(body.task ?? '', agentCfg()).then(result => {
      worker.status = result.success ? 'completed' : 'failed'
      worker.result = result.content
    }).catch(e => {
      worker.status = 'failed'
      worker.result = e.message
    })
    return c.json({ workerId: id, status: 'running' }, 201)
  })

  app.get('/api/coordinator/workers', c => c.json(Array.from(workers.values())))

  app.get('/api/coordinator/workers/:id', c => {
    const worker = workers.get(c.req.param('id'))
    return worker ? c.json(worker) : c.json({ error: 'Worker not found' }, 404)
  })

  app.post('/api/coordinator/workers/:id/kill', c => {
    const worker = workers.get(c.req.param('id'))
    if (worker) worker.status = 'failed'
    return c.json({ success: true })
  })

  return app
}
