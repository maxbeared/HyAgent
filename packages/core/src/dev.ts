/**
 * Hybrid Agent - Development Entry Point
 *
 * Run with: pnpm dev
 */

import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { existsSync, readFileSync } from 'fs'
import path from 'path'
import os from 'os'

// ============================================================================
// Load Config - Priority: user's local config > imported config > env vars
// ============================================================================

interface Config {
  provider: string
  baseUrl: string
  apiKey: string
  model: string
}

function getConfigPath(): string | null {
  // Priority: user's local config > OpenCode/Claude Code config > local project config > env vars
  const candidates = [
    // User's own hybrid-agent config (highest priority)
    path.join(os.homedir(), '.hybrid-agent', 'config.json'),
    path.join(os.homedir(), '.config', 'hybrid-agent', 'config.json'),
    // Windows: AppData
    path.join(process.env.APPDATA || '', 'hybrid-agent', 'config.json'),
    // OpenCode user config (import if exists)
    path.join(os.homedir(), '.config', 'opencode', 'opencode.jsonc'),
    path.join(os.homedir(), '.config', 'opencode', 'opencode.json'),
    path.join(os.homedir(), '.config', 'opencode', 'config.json'),
    // OpenCode Windows AppData
    path.join(process.env.APPDATA || '', 'opencode', 'opencode.jsonc'),
    path.join(process.env.APPDATA || '', 'opencode', 'opencode.json'),
    path.join(process.env.APPDATA || '', 'opencode', 'config.json'),
    // Claude Code user config (import if exists)
    path.join(os.homedir(), '.claude', 'settings.json'),
    // Claude Code Windows AppData
    path.join(process.env.APPDATA || '', 'Claude', 'settings.json'),
    path.join(process.env.LOCALAPPDATA || '', 'Claude', 'settings.json'),
    // Local project config
    path.join(process.cwd(), 'config.json'),
    path.join(process.cwd(), 'config.local.json'),
  ]

  for (const configPath of candidates) {
    if (existsSync(configPath)) {
      return configPath
    }
  }
  return null
}

/**
 * Import and normalize config from different sources (OpenCode, Claude Code, hybrid-agent).
 * Each has different structure:
 * - hybrid-agent: { provider, baseUrl, apiKey, model }
 * - OpenCode: { provider: { providerId: { apiKey, options: { baseURL } } }, model: "provider/model" }
 * - Claude Code: uses env vars mainly, settings.json has other settings
 */
function importConfig(configPath: string, config: Config): Config {
  try {
    const content = readFileSync(configPath, 'utf-8')

    let data: any
    // Handle JSONC comments (OpenCode uses jsonc format)
    try {
      data = JSON.parse(content)
    } catch {
      // Try removing comments for JSONC format
      const jsonContent = content
        .replace(/\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
      data = JSON.parse(jsonContent)
    }

    // hybrid-agent native format
    if (data.provider && data.apiKey) {
      return { ...config, ...data }
    }

    // OpenCode format: { provider: { "provider-id": { options: { apiKey, baseURL } } }, model: "anthropic/claude-..." }
    if (data.provider && typeof data.provider === 'object') {
      // Find first provider with apiKey
      for (const [providerName, providerData] of Object.entries(data.provider) as [string, any][]) {
        if (providerData?.options?.apiKey) {
          const imported: Partial<Config> = {
            provider: providerName,
            apiKey: providerData.options.apiKey,
          }
          if (providerData.options.baseURL) {
            imported.baseUrl = providerData.options.baseURL
          }
          // Parse model from "provider/model" format
          if (data.model && typeof data.model === 'string' && data.model.includes('/')) {
            imported.model = data.model.split('/')[1]
            if (!imported.provider) {
              imported.provider = data.model.split('/')[0]
            }
          }
          return { ...config, ...imported }
        }
      }
    }

    // Claude Code settings.json - uses env vars
    // ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY
    if (data.env?.ANTHROPIC_API_KEY || data.env?.ANTHROPIC_AUTH_TOKEN) {
      return {
        ...config,
        apiKey: data.env.ANTHROPIC_API_KEY || data.env.ANTHROPIC_AUTH_TOKEN,
        baseUrl: data.env.ANTHROPIC_BASE_URL || config.baseUrl,
        model: data.env.ANTHROPIC_MODEL || config.model,
      }
    }

    // Fallback: try direct merge for any other format
    return { ...config, ...data }
  } catch (e: any) {
    console.log(`Failed to parse config from ${configPath}: ${e.message}`)
    return config
  }
}

let config: Config = {
  provider: 'minimaxi',
  baseUrl: 'https://api.minimaxi.com/anthropic',
  apiKey: process.env.ANTHROPIC_API_KEY ?? '',
  model: 'MiniMax-M2.7',
}

const configPath = getConfigPath()
if (configPath) {
  config = importConfig(configPath, config)
  console.log(`Loaded config from: ${configPath}`)
} else {
  console.log('No config file found, using environment/defaults')
}

// ============================================================================
// App Setup
// ============================================================================

const app = new Hono()

app.use('*', logger())
app.use('*', cors())

// ============================================================================
// In-Memory Stores
// ============================================================================

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

const sessions = new Map<string, Session>()
const workers = new Map<string, Worker>()

// 动态模型列表 - 用户可以添加
const customModels = new Map<string, ModelInfo>()

// 从配置导入的模型映射
const configModels: Record<string, string[]> = {
  anthropic: ['claude-opus-4-6', 'claude-sonnet-4-6'],
  openai: ['gpt-4o', 'gpt-4o-mini'],
  google: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  minimaxi: [config.model],
}

// models.dev 模型缓存
let modelsDevCache: Record<string, any> = {}
let modelsDevCacheTime = 0
const MODELS_DEV_TTL = 5 * 60 * 1000 // 5分钟缓存

// 从 models.dev 获取模型列表
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
  } catch (e) {
    console.log('Failed to fetch models.dev:', e)
  }
  return modelsDevCache
}

// 添加自定义模型
function addModel(provider: string, modelId: string, modelName?: string): ModelInfo {
  const info: ModelInfo = {
    id: modelId,
    name: modelName || modelId,
    context: 100000,
    provider,
    addedAt: Date.now(),
  }
  customModels.set(`${provider}:${modelId}`, info)
  return info
}

// 获取所有可用模型（合并配置模型和自定义模型）
async function getModelsForProvider(provider: string): Promise<ModelInfo[]> {
  const result: ModelInfo[] = []

  // 先从 models.dev 获取（如果可用）
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

  // 添加配置中的模型（如果models.dev没有提供）
  const configProviderModels = configModels[provider] || []
  const existingIds = new Set(result.map(m => m.id))
  for (const modelId of configProviderModels) {
    if (!existingIds.has(modelId)) {
      result.push({
        id: modelId,
        name: modelId,
        context: 100000,
        provider,
        addedAt: 0,
      })
    }
  }

  // 添加自定义模型
  for (const model of customModels.values()) {
    if (model.provider === provider) {
      result.push(model)
    }
  }

  return result
}

// ============================================================================
// Health & Info
// ============================================================================

app.get('/health', (c) => c.json({
  status: 'ok',
  timestamp: Date.now(),
  version: '0.1.0',
  uptime: process.uptime(),
}))

app.get('/api/info', (c) => c.json({
  name: 'Hybrid Agent',
  version: '0.1.0',
  config: {
    provider: config.provider,
    model: config.model,
    hasApiKey: !!config.apiKey,
  },
}))

// ============================================================================
// Provider Routes
// ============================================================================

app.get('/api/providers', (c) => {
  return c.json([
    { id: 'anthropic', name: 'Anthropic' },
    { id: 'openai', name: 'OpenAI' },
    { id: 'google', name: 'Google' },
    { id: 'minimaxi', name: 'MiniMax' },
  ])
})

app.get('/api/models', async (c) => {
  const provider = c.req.query('provider') ?? config.provider
  const models = await getModelsForProvider(provider)
  return c.json(models)
})

// 刷新 models.dev 缓存
app.post('/api/models/refresh', async (c) => {
  modelsDevCacheTime = 0 // 强制刷新
  const models = await fetchModelsFromModelsDev()
  return c.json({ success: true, providers: Object.keys(models).length })
})

// 添加自定义模型
app.post('/api/models', async (c) => {
  const { provider, modelId, modelName } = await c.req.json()
  if (!provider || !modelId) {
    return c.json({ error: 'provider and modelId are required' }, 400)
  }
  const model = addModel(provider, modelId, modelName)
  return c.json(model, 201)
})

// 删除自定义模型
app.delete('/api/models', async (c) => {
  const { provider, modelId } = await c.req.json()
  const key = `${provider}:${modelId}`
  if (customModels.has(key)) {
    customModels.delete(key)
    return c.json({ success: true })
  }
  return c.json({ error: 'Model not found' }, 404)
})

// 获取/设置当前模型
app.get('/api/model/current', (c) => {
  return c.json({ provider: config.provider, model: config.model })
})

app.put('/api/model/current', async (c) => {
  const { provider, model } = await c.req.json()
  if (provider) config.provider = provider
  if (model) config.model = model
  return c.json({ provider: config.provider, model: config.model })
})

// ============================================================================
// Permission Routes
// ============================================================================

app.post('/api/permission/check', async (c) => {
  const { path } = await c.req.json()
  const result = checkPathSafety(path)
  return c.json(result)
})

app.post('/api/permission/check-command', async (c) => {
  const { command } = await c.req.json()
  const result = checkCommandSafety(command)
  return c.json(result)
})

// ============================================================================
// Session Routes
// ============================================================================

app.post('/api/sessions', async (c) => {
  const body = await c.req.json()
  const id = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const session: Session = {
    id,
    messages: [],
    model: body.model ?? config.model,
    provider: body.provider ?? config.provider,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  sessions.set(id, session)
  return c.json(session, 201)
})

app.get('/api/sessions', (c) => c.json(Array.from(sessions.values())))

app.get('/api/sessions/:id', (c) => {
  const id = c.req.param('id')
  const session = sessions.get(id)
  if (!session) return c.json({ error: 'Session not found' }, 404)
  return c.json(session)
})

app.delete('/api/sessions/:id', (c) => {
  sessions.delete(c.req.param('id'))
  return c.json({ success: true })
})

app.post('/api/sessions/:id/messages', async (c) => {
  const id = c.req.param('id')
  const session = sessions.get(id)
  if (!session) return c.json({ error: 'Session not found' }, 404)

  const body = await c.req.json()
  const message = {
    id: `msg_${Date.now()}`,
    role: body.role ?? 'user',
    content: body.content ?? '',
    parts: body.parts ?? [{ type: 'text', content: body.content ?? '' }],
    timestamp: Date.now(),
  }

  session.messages.push(message)
  session.updatedAt = Date.now()
  return c.json(message, 201)
})

app.get('/api/sessions/:id/messages', (c) => {
  const session = sessions.get(c.req.param('id'))
  if (!session) return c.json({ error: 'Session not found' }, 404)
  return c.json(session.messages)
})

// ============================================================================
// Tool Execution Routes
// ============================================================================

app.post('/api/tools/execute', async (c) => {
  const { tool, input } = await c.req.json()
  try {
    let result: any
    switch (tool) {
      case 'bash': result = await executeBash(input.command, input); break
      case 'read': result = await executeRead(input.path, input); break
      case 'edit': result = await executeEdit(input.path, input.oldString, input.newString); break
      case 'glob': result = await executeGlob(input.pattern, input); break
      case 'grep': result = await executeGrep(input.pattern, input); break
      default: return c.json({ error: `Unknown tool: ${tool}` }, 400)
    }
    return c.json(result)
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

// ============================================================================
// Coordinator Routes
// ============================================================================

app.post('/api/coordinator/spawn', async (c) => {
  const body = await c.req.json()
  const id = `worker_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const worker: Worker = { id, name: body.name ?? 'worker', status: 'pending' }
  workers.set(id, worker)

  setTimeout(() => {
    worker.status = 'running'
    setTimeout(() => {
      worker.status = 'completed'
      worker.result = `Task completed for: ${body.task ?? 'unknown'}`
    }, 1000)
  }, 100)

  return c.json({ workerId: id, status: 'pending' }, 201)
})

app.get('/api/coordinator/workers', (c) => c.json(Array.from(workers.values())))

app.get('/api/coordinator/workers/:id', (c) => {
  const worker = workers.get(c.req.param('id'))
  if (!worker) return c.json({ error: 'Worker not found' }, 404)
  return c.json(worker)
})

app.post('/api/coordinator/workers/:id/send', async (c) => {
  const worker = workers.get(c.req.param('id'))
  if (!worker) return c.json({ error: 'Worker not found' }, 404)
  return c.json({ success: true })
})

app.post('/api/coordinator/workers/:id/kill', (c) => {
  const worker = workers.get(c.req.param('id'))
  if (worker) worker.status = 'failed'
  return c.json({ success: true })
})

// ============================================================================
// Chat Completion (Real API - MiniMax)
// ============================================================================

app.post('/api/chat', async (c) => {
  const body = await c.req.json()
  const { sessionId, messages, model, provider } = body

  const targetModel = model ?? config.model

  // Build messages for API
  const apiMessages = (messages ?? []).map((m: any) => ({
    role: m.role,
    content: typeof m.content === 'string' ? m.content : m.content?.[0]?.text ?? '',
  }))

  // Add system prompt if first message is not system
  if (apiMessages.length > 0 && apiMessages[0].role !== 'system') {
    apiMessages.unshift({
      role: 'system',
      content: 'You are a helpful AI coding assistant.',
    })
  }

  try {
    const response = await fetch(`${config.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: targetModel,
        max_tokens: 4096,
        messages: apiMessages,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      return c.json({
        error: `API Error: ${response.status}`,
        details: errorText,
      })
    }

    const data = await response.json() as any

    // Extract content - MiniMax uses content array with different types
    let content = 'No response'
    if (data.content && Array.isArray(data.content)) {
      // Find the first text type content
      const textContent = data.content.find((c: any) => c.type === 'text')
      if (textContent?.text) {
        content = textContent.text
      } else if (data.content.length > 0 && data.content[0].type === 'thinking') {
        // No text response, only thinking - response may be truncated
        content = '[Thinking only - response may be truncated]'
      }
    } else if (data.result) {
      content = typeof data.result === 'string' ? data.result : data.result.text ?? 'No response'
    } else if (data.message?.content) {
      content = data.message.content
    } else if (typeof data === 'string') {
      content = data
    }

    const assistantMessage = {
      id: `msg_${Date.now()}`,
      role: 'assistant',
      content,
      timestamp: Date.now(),
    }

    if (sessionId) {
      const session = sessions.get(sessionId)
      if (session) {
        session.messages.push(assistantMessage)
        session.updatedAt = Date.now()
      }
    }

    return c.json({
      message: assistantMessage,
      usage: data.usage ?? { inputTokens: 0, outputTokens: 0 },
    })
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

// ============================================================================
// Debug: Raw API Test
// ============================================================================

app.post('/api/debug-minimaxi', async (c) => {
  try {
    const response = await fetch(`${config.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: 100,
        messages: [{ role: 'user', content: 'Say exactly: Hi' }],
      }),
    })

    const text = await response.text()
    let json: any
    try { json = JSON.parse(text) } catch { json = { raw: text } }

    return c.json({
      status: response.status,
      ok: response.ok,
      body: json,
    })
  } catch (error: any) {
    return c.json({ error: error.message })
  }
})

// ============================================================================
// Path Safety Functions
// ============================================================================

function checkPathSafety(path: string): { isSafe: boolean; reason?: string; pathType: string } {
  if (path.startsWith('\\\\') || path.startsWith('//')) {
    return { isSafe: false, reason: 'UNC paths blocked', pathType: 'blocked' }
  }

  const blockedDevicePaths = ['/dev/zero', '/dev/random', '/dev/urandom', '/dev/stdin', '/dev/tty', '/dev/stdout', '/dev/stderr']
  if (blockedDevicePaths.includes(path)) {
    return { isSafe: false, reason: 'Device paths blocked', pathType: 'blocked' }
  }

  const normalized = path.replace(/\\/g, '/')
  if (normalized.includes('../') || normalized.includes('..\\')) {
    return { isSafe: false, reason: 'Path traversal blocked', pathType: 'dangerous' }
  }

  const protectedPatterns = [/\.git\//, /\.claude\//, /\.ssh\//, /\.aws\//]
  for (const pattern of protectedPatterns) {
    if (pattern.test(path)) {
      return { isSafe: false, reason: 'Protected path', pathType: 'dangerous' }
    }
  }

  return { isSafe: true, pathType: 'normal' }
}

function checkCommandSafety(command: string): { isSafe: boolean; reasons: string[] } {
  const reasons: string[] = []
  const dangerousPatterns = [
    { pattern: /rm\s+-rf\s+\//, reason: 'Root delete command' },
    { pattern: /dd\s+if=.*of=\/dev\//, reason: 'Disk dump to device' },
    { pattern: /mkfs\./, reason: 'Filesystem format command' },
  ]

  for (const { pattern, reason } of dangerousPatterns) {
    if (pattern.test(command)) reasons.push(reason)
  }

  const pathRegex = /(['"])([^\1]+?)\1|([\.\/\~a-zA-Z0-9_\-@\/\*][^\s\\]*)/g
  let match
  while ((match = pathRegex.exec(command)) !== null) {
    const path = match[2] ?? match[3]
    if (path && !path.startsWith('-')) {
      const safety = checkPathSafety(path)
      if (!safety.isSafe && safety.reason) reasons.push(`${path}: ${safety.reason}`)
    }
  }

  return { isSafe: reasons.length === 0, reasons }
}

// ============================================================================
// Tool Executors
// ============================================================================

async function executeBash(command: string, input: any): Promise<any> {
  const { spawn } = await import('child_process')
  const safety = checkCommandSafety(command)
  if (!safety.isSafe) {
    return { success: false, title: 'Command Blocked', output: `Safety check failed:\n${safety.reasons.join('\n')}` }
  }

  return new Promise((resolve) => {
    const isWindows = process.platform === 'win32'
    const shell = isWindows ? 'cmd.exe' : '/bin/bash'
    const args = isWindows ? ['/c', command] : ['-c', command]
    const proc = spawn(shell, args, { cwd: input.cwd ?? process.cwd() })
    let stdout = '', stderr = ''

    proc.stdout?.on('data', (data: Buffer) => { stdout += data.toString() })
    proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString() })

    const timeout = setTimeout(() => {
      proc.kill()
      resolve({ success: false, title: 'Bash (timeout)', output: 'Command timed out' })
    }, input.timeout ?? 30000)

    proc.on('close', (code) => {
      clearTimeout(timeout)
      resolve({ success: code === 0, title: `Bash: ${command.slice(0, 50)}...`, output: stdout + (stderr ? `\n[stderr]${stderr}` : ''), exitCode: code })
    })

    proc.on('error', (err) => {
      clearTimeout(timeout)
      resolve({ success: false, title: 'Bash (error)', output: err.message })
    })
  })
}

async function executeRead(path: string, input: any): Promise<any> {
  const fs = await import('fs/promises')
  const safety = checkPathSafety(path)
  if (!safety.isSafe) return { success: false, title: 'Read Blocked', output: safety.reason }

  try {
    const content = await fs.readFile(path, 'utf-8')
    const lines = content.split('\n')
    const offset = input.offset ?? 0
    const limit = input.limit ?? lines.length
    const sliced = lines.slice(offset, offset + limit).join('\n')
    return { success: true, title: `Read: ${path}`, output: sliced + (offset + limit < lines.length ? `\n... (${lines.length - offset - limit} more lines)` : ''), lines: limit, totalLines: lines.length }
  } catch (err: any) {
    return { success: false, title: `Read: ${path}`, output: err.message }
  }
}

async function executeEdit(path: string, oldString: string, newString: string): Promise<any> {
  const fs = await import('fs/promises')
  const safety = checkPathSafety(path)
  if (!safety.isSafe) return { success: false, title: 'Edit Blocked', output: safety.reason }

  try {
    const content = await fs.readFile(path, 'utf-8')
    if (!content.includes(oldString)) return { success: false, title: `Edit: ${path}`, output: 'Text to replace not found' }
    await fs.writeFile(path, content.replace(oldString, newString), 'utf-8')
    return { success: true, title: `Edit: ${path}`, output: 'File edited successfully' }
  } catch (err: any) {
    return { success: false, title: `Edit: ${path}`, output: err.message }
  }
}

async function executeGlob(pattern: string, input: any): Promise<any> {
  const { glob } = await import('glob')
  try {
    const files = await glob(pattern, { cwd: input.cwd ?? process.cwd(), absolute: true })
    return { success: true, title: `Glob: ${pattern}`, output: files.join('\n'), count: files.length }
  } catch (err: any) {
    return { success: false, title: `Glob: ${pattern}`, output: err.message }
  }
}

async function executeGrep(pattern: string, input: any): Promise<any> {
  const fs = await import('fs/promises')
  try {
    const content = await fs.readFile(input.path ?? '.', 'utf-8')
    const lines = content.split('\n')
    const matches = lines.map((line, i) => ({ line, num: i + 1 })).filter(({ line }) => line.includes(pattern))
    return { success: true, title: `Grep: ${pattern} in ${input.path ?? '.'}`, output: matches.map(({ line, num }) => `${num}: ${line}`).join('\n'), count: matches.length }
  } catch (err: any) {
    return { success: false, title: `Grep: ${pattern}`, output: err.message }
  }
}

// ============================================================================
// Start Server
// ============================================================================

const PORT = parseInt(process.env.PORT ?? '3000')
const HOST = process.env.HOST ?? '0.0.0.0'

console.log(`
╔══════════════════════════════════════════════════════════════╗
║                    Hybrid Agent v0.1.0                       ║
║     Claude Code + OpenCode Architecture                       ║
╠══════════════════════════════════════════════════════════════╣
║  Server:  http://${HOST}:${PORT}                              ║
║  Provider: ${config.provider}                                   ║
║  Model:   ${config.model}                                       ║
║  API Key: ${config.apiKey ? '***' + config.apiKey.slice(-8) : 'NOT SET'}     ║
╚══════════════════════════════════════════════════════════════╝
`)

serve({ fetch: app.fetch, port: PORT, hostname: HOST })
