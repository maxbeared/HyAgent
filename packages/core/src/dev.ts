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
// Load Config - Priority: local config.json > user's home config > env vars
// ============================================================================

interface Config {
  provider: string
  baseUrl: string
  apiKey: string
  model: string
}

function getConfigPath(): string | null {
  // Priority: user's local config > OpenCode config > local project config > env vars
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

let config: Config = {
  provider: 'minimaxi',
  baseUrl: 'https://api.minimaxi.com/anthropic',
  apiKey: process.env.ANTHROPIC_API_KEY ?? '',
  model: 'MiniMax-M2.7',
}

const configPath = getConfigPath()
if (configPath) {
  try {
    const configFile = readFileSync(configPath, 'utf-8')
    config = { ...config, ...JSON.parse(configFile) }
    console.log(`Loaded config from: ${configPath}`)
  } catch (e: any) {
    console.log(`Failed to load config from ${configPath}: ${e.message}`)
    console.log('Using default/config from environment')
  }
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

const sessions = new Map<string, Session>()
const workers = new Map<string, Worker>()

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
    { id: 'anthropic', name: 'Anthropic', models: ['claude-opus-4-6', 'claude-sonnet-4-6'] },
    { id: 'openai', name: 'OpenAI', models: ['gpt-4o', 'gpt-4o-mini'] },
    { id: 'google', name: 'Google', models: ['gemini-2.5-pro', 'gemini-2.5-flash'] },
    { id: 'minimaxi', name: 'MiniMax', models: [config.model] },
  ])
})

app.get('/api/models', (c) => {
  const provider = c.req.query('provider') ?? 'anthropic'
  const models: Record<string, any[]> = {
    anthropic: [
      { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', context: 200000 },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', context: 200000 },
    ],
    openai: [
      { id: 'gpt-4o', name: 'GPT-4o', context: 128000 },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', context: 128000 },
    ],
    google: [
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', context: 1000000 },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', context: 1000000 },
    ],
    minimaxi: [
      { id: config.model, name: 'MiniMax M2', context: 100000 },
    ],
  }
  return c.json(models[provider] ?? [])
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
