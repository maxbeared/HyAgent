/**
 * Minimal REPL with slash command autocomplete.
 */

import * as readline from 'readline'
import { stdin, stdout } from 'process'

const DEFAULT_BASE_URL = process.env.HYAGENT_URL ?? 'http://localhost:3001'

// ---- Command definitions ----

interface Command {
  name: string
  description: string
  subcommands?: string[]
}

const COMMANDS: Command[] = [
  { name: 'session', description: 'Switch to session /session <id>' },
  { name: 'sessions', description: 'List all sessions' },
  { name: 'new', description: 'Create a new session' },
  { name: 'mode', description: 'Show or set permission mode', subcommands: ['permissive', 'default', 'askAll', 'plan'] },
  { name: 'info', description: 'Show current session info' },
  { name: 'checkpoint', description: 'Show checkpoint for current session' },
  { name: 'help', description: 'Show this help' },
  { name: 'quit', description: 'Exit REPL' },
]

function buildSlashChoices(): Array<{ name: string; value: string }> {
  const choices: Array<{ name: string; value: string }> = []
  for (const cmd of COMMANDS) {
    if (!cmd.subcommands) {
      choices.push({ name: `/${cmd.name}  - ${cmd.description}`, value: `/${cmd.name}` })
    } else {
      for (const sub of cmd.subcommands) {
        choices.push({ name: `/${cmd.name} ${sub}  - ${cmd.description}`, value: `/${cmd.name} ${sub}` })
      }
    }
  }
  return choices
}

const SLASH_CHOICES = buildSlashChoices()

// ---- Helpers ----

function promptStr(sessionId?: string): string {
  return `${sessionId ? `[${sessionId.slice(0, 8)}]` : '[no-session]'} > `
}

async function apiFetch(path: string, method = 'GET', body?: unknown): Promise<any> {
  const url = `${DEFAULT_BASE_URL}${path}`
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const data = await res.json()
  if (!res.ok) throw new Error((data as any).error ?? `HTTP ${res.status}`)
  return data
}

// ---- Execute commands ----

async function executeCommand(cmd: string, args: string[], currentSessionId: string | undefined): Promise<{ output?: string; newSessionId?: string }> {
  switch (cmd) {
    case 'session':
      if (!args[0]) return { output: 'Usage: /session <id>' }
      try {
        await apiFetch(`/api/sessions/${args[0]}`)
        return { output: `Switched to session ${args[0]}`, newSessionId: args[0] }
      } catch {
        return { output: `Session not found: ${args[0]}` }
      }

    case 'sessions': {
      const sessions = await apiFetch('/api/sessions')
      if (sessions.length === 0) return { output: 'No sessions.' }
      return { output: sessions.map((s: any) => `  ${s.id} (created: ${new Date(s.createdAt).toLocaleString()})`).join('\n') }
    }

    case 'new': {
      const sess = await apiFetch('/api/sessions', 'POST', { model: 'MiniMax-M2.7', provider: 'minimaxi' })
      return { output: `Created session ${sess.id}`, newSessionId: sess.id }
    }

    case 'mode': {
      if (!currentSessionId) return { output: 'No session selected.' }
      if (!args[0]) {
        const info = await apiFetch(`/api/sessions/${currentSessionId}/permission-mode`)
        return { output: `Current permission mode: ${info.permissionMode}\n\nAvailable modes:\n  permissive - Allow all operations (dangerous)\n  default    - Safe ops allowed, dangerous ops ask\n  askAll     - Ask for confirmation before every operation\n  plan       - Read-only, can create plans but cannot modify files` }
      }
      const mode = args[0].toLowerCase()
      const validModes = ['permissive', 'default', 'askAll', 'plan']
      if (!validModes.includes(mode)) return { output: `Invalid mode. Use: ${validModes.join(' | ')}` }
      const result = await apiFetch(`/api/sessions/${currentSessionId}/permission-mode`, 'PUT', { permissionMode: mode })
      return { output: `Permission mode set to: ${result.permissionMode}` }
    }

    case 'info': {
      if (!currentSessionId) return { output: 'No session selected.' }
      const sess = await apiFetch(`/api/sessions/${currentSessionId}`)
      const modeInfo = await apiFetch(`/api/sessions/${currentSessionId}/permission-mode`).catch(() => ({ permissionMode: 'unknown' }))
      return { output: `Session: ${sess.id}\nPermission Mode: ${modeInfo.permissionMode}\nMessages: ${sess.messages?.length ?? 0}\nCreated: ${new Date(sess.createdAt).toLocaleString()}` }
    }

    case 'checkpoint': {
      if (!currentSessionId) return { output: 'No session selected.' }
      const info = await apiFetch(`/api/sessions/${currentSessionId}/resume`).catch(() => null)
      if (!info || !info.canResume) return { output: 'No checkpoint.' }
      const cp = info.checkpoint
      return { output: `Checkpoint:\n  Task: ${cp.task.slice(0, 80)}...\n  Iterations: ${cp.iterations}\n  Messages: ${cp.messages.length}` }
    }

    case 'help':
      return { output: `
Commands:
  /session <id>   Switch to session
  /sessions       List all sessions
  /new            Create a new session
  /mode           Show/set permission mode
  /info           Show session info
  /checkpoint     Show checkpoint
  /help           Show this help
  /quit           Exit

Permission Modes: permissive | default | askAll | plan` }

    case 'quit':
      stdout.write('Goodbye!\n')
      process.exit(0)

    default:
      return { output: `Unknown command: /${cmd}` }
  }
}

// ---- SSE Parser ----

async function* SSEParse(stream: ReadableStream<Uint8Array>): AsyncGenerator<any> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6)
          if (data === '[DONE]') return
          try { yield JSON.parse(data) } catch {}
        }
      }
    }
  } finally { reader.releaseLock() }
}

// ---- Send message ----

async function sendMessage(content: string, currentSessionId: string | undefined): Promise<string | undefined> {
  let sessionId = currentSessionId

  if (!sessionId) {
    const sess = await apiFetch('/api/sessions', 'POST', { model: 'MiniMax-M2.7', provider: 'minimaxi' })
    sessionId = sess.id
    stdout.write(`[Created session ${sessionId}]\n`)
  }

  stdout.write('\n[Agent thinking...]\n')

  try {
    const res = await fetch(`${DEFAULT_BASE_URL}/api/chat/${sessionId}/stream?task=${encodeURIComponent(content)}`, {
      method: 'GET', signal: AbortSignal.timeout(300000),
    })

    if (!res.ok) {
      stdout.write(`\n[HTTP Error ${res.status}]\n`)
      return sessionId
    }

    for await (const event of SSEParse(res.body!)) {
      switch (event.type) {
        case 'text':
          if (event.content) stdout.write(event.content)
          break
        case 'tool_start':
          stdout.write(`\n🔧 ${event.toolName}: ${JSON.stringify(event.toolInput).slice(0, 80)}\n`)
          break
        case 'tool_result':
          stdout.write(`  → ${event.success ? '✓' : '✗'} ${(event.toolOutput ?? '').slice(0, 200)}\n`)
          break
        case 'permission_required':
          stdout.write(`\n⚠️ PERMISSION REQUIRED ⚠️\nTool: ${event.toolName}\n`)
          if (event.permissionReasons) stdout.write(`Reasons: ${event.permissionReasons.join('; ')}\n`)
          stdout.write(`Input: ${JSON.stringify(event.toolInput).slice(0, 200)}\n`)
          break
        case 'done':
          stdout.write('\n')
          break
        case 'error':
          stdout.write(`\n[Error] ${event.error}\n`)
          break
        case 'compaction':
          stdout.write('\n[Compacting...]\n')
          break
        case 'retry':
          stdout.write(`\n[Retry] ${event.content}\n`)
          break
      }
    }
  } catch (e: any) {
    stdout.write(`\n[Request failed] ${e.message}\n`)
  }

  return sessionId
}

// ---- Main REPL loop ----

function createREPL(): readline.Interface {
  const rl = readline.createInterface({
    input: stdin,
    output: stdout,
    completer: (line: string): [string[], string] => {
      if (!line.startsWith('/')) return [[], line]
      const hits = SLASH_CHOICES.filter(c => c.name.toLowerCase().startsWith(line.toLowerCase()))
      return [hits.map(c => c.name), line]
    },
  })

  // Enable keypress events for autocomplete
  readline.emitKeypressEvents(stdin, rl)

  return rl
}

function question(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, resolve)
  })
}

// ---- Main REPL loop ----

async function runREPL() {
  let currentSessionId: string | undefined

  stdout.write('HyAgent REPL\n')
  stdout.write('Type / for slash commands, /help for available commands.\n\n')

  const rl = createREPL()

  while (true) {
    try {
      const input = await question(rl, promptStr(currentSessionId))

      if (!input.trim()) continue

      if (input.startsWith('/')) {
        const parts = input.slice(1).split(/\s+/)
        const cmdName = parts[0]?.toLowerCase()
        const args = parts.slice(1)

        const result = await executeCommand(cmdName || '', args, currentSessionId)
        if (result.output) stdout.write(result.output + '\n')
        if (result.newSessionId) currentSessionId = result.newSessionId
      } else {
        const newSessionId = await sendMessage(input, currentSessionId)
        if (newSessionId) currentSessionId = newSessionId
      }
    } catch (e: any) {
      if (e.message?.includes('exit')) {
        stdout.write('Goodbye!\n')
        break
      }
      stdout.write(`\n[Error] ${e.message}\n`)
    }
  }

  rl.close()
}

runREPL().catch(e => { console.error('Error:', e); process.exit(1) })