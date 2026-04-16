/**
 * Minimal REPL (Read-Eval-Print Loop) for the agent.
 *
 * Provides a CLI interface to chat with the agent via SSE streaming.
 * Allows testing the agent core without a browser.
 *
 * Usage:
 *   pnpm repl
 *   npx tsx src/repl.ts
 *
 * Commands:
 *   :session <id>  — switch to a session
 *   :sessions       — list all sessions
 *   :new            — create a new session
 *   :quit / Ctrl+D  — exit
 *   Ctrl+C          — interrupt current agent turn
 *   Ctrl+L          — clear screen
 */

import * as readline from 'readline'
import { stdin, stdout } from 'process'

const DEFAULT_BASE_URL = process.env.HYBRID_AGENT_URL ?? 'http://localhost:3001'

interface Session {
  id: string
  createdAt: number
}

// ---- Helpers ----

function prompt(sessionId?: string): string {
  const prefix = sessionId ? `[${sessionId.slice(0, 8)}]` : '[no-session]'
  return `${prefix} > `
}

function parseArgs(input: string): { cmd: string; args: string[] } {
  const parts = input.trim().split(/\s+/)
  return { cmd: parts[0]?.toLowerCase() ?? '', args: parts.slice(1) }
}

async function apiFetch(
  path: string,
  method = 'GET',
  body?: unknown,
  baseUrl = DEFAULT_BASE_URL,
): Promise<any> {
  const url = `${baseUrl}${path}`
  const opts: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  }
  if (body) opts.body = JSON.stringify(body)
  const res = await fetch(url, opts)
  const data = await res.json()
  if (!res.ok) throw new Error((data as any).error ?? `HTTP ${res.status}`)
  return data
}

// ---- SSE EventSource (minimal, no external deps) ----

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
          try {
            yield JSON.parse(data)
          } catch {
            // skip malformed JSON
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

// ---- REPL Core ----

async function runREPL() {
  const rl = readline.createInterface({ input: stdin, output: stdout, prompt: prompt() })

  let currentSessionId: string | undefined
  let agentTask: string | undefined

  // Ctrl+C to interrupt
  rl.on('SIGINT', () => {
    if (agentTask) {
      agentTask = undefined
      stdout.write('\n[Interrupted]\n')
      rl.prompt()
    } else {
      rl.close()
    }
  })

  // Ctrl+D to exit
  rl.on('close', () => {
    stdout.write('\nGoodbye!\n')
    process.exit(0)
  })

  const printHelp = () => {
    stdout.write(`
Commands:
  :session <id>   Switch to session <id>
  :sessions        List all sessions
  :new             Create a new session
  :info            Show current session info
  :checkpoint      Show checkpoint for current session (if any)
  :quit            Exit REPL

Any other input is sent as a message to the agent.
`)
  }

  const sendMessage = async (content: string): Promise<void> => {
    if (!currentSessionId) {
      // Auto-create a session
      const sess = await apiFetch('/api/sessions', 'POST', {
        model: 'MiniMax-M2.7',
        provider: 'minimaxi',
      })
      currentSessionId = sess.id
      stdout.write(`[Created session ${currentSessionId}]\n`)
    }

    const history: any[] = []
    const messagesRes = await apiFetch(`/api/sessions/${currentSessionId}/messages`)
    for (const m of messagesRes) {
      history.push({ role: m.role, content: m.content })
    }

    agentTask = content
    stdout.write('\n[Agent thinking...]\n')

    try {
      // Use streaming endpoint (GET - task is in query param)
      const res = await fetch(
        `${DEFAULT_BASE_URL}/api/chat/${currentSessionId}/stream?task=${encodeURIComponent(content)}`,
        {
          method: 'GET',
          signal: AbortSignal.timeout(300000),
        },
      )

      // If the response itself is an error (non-200), read the error body and yield
      if (!res.ok) {
        const errBody = await res.text()
        stdout.write(`\n[HTTP Error ${res.status}] ${errBody}\n`)
        return
      }

      let lastEvent: any = null
      for await (const event of SSEParse(res.body!)) {
        if (!agentTask) break // interrupted

        switch (event.type) {
          case 'text':
            if (event.content) {
              stdout.write(event.content)
            }
            break
          case 'tool_start':
            stdout.write(`\n🔧 ${event.toolName}: ${JSON.stringify(event.toolInput).slice(0, 80)}\n`)
            break
          case 'tool_result':
            stdout.write(`  → ${event.success ? '✓' : '✗'} ${(event.toolOutput ?? '').slice(0, 200)}\n`)
            break
          case 'compaction':
            stdout.write(`\n[Compacting session...]\n`)
            break
          case 'retry':
            stdout.write(`\n[Retry] ${event.content}\n`)
            break
          case 'done':
            stdout.write('\n')
            lastEvent = event
            break
          case 'error':
            stdout.write(`\n[Error] ${event.error}\n`)
            lastEvent = event
            break
        }

        // Only exit the SSE loop for terminal stop reasons.
        // 'tool_execution_error' is NOT terminal — the agent should continue.
        if (lastEvent?.stopReason) {
          const terminalReasons = new Set([
            'completed', 'max_iterations', 'api_error',
            'doom_loop_detected', 'consecutive_tool_only', 'token_budget_exceeded',
          ])
          if (terminalReasons.has(lastEvent.stopReason)) {
            break // exit the for loop
          }
          // Non-terminal: keep receiving events
          lastEvent = null
        }
      }
    } catch (e: any) {
      stdout.write(`\n[Request failed] ${e.message}\n`)
    } finally {
      agentTask = undefined
    }
  }

  const listSessions = async (): Promise<void> => {
    const sessions = await apiFetch('/api/sessions')
    if (sessions.length === 0) {
      stdout.write('No sessions.\n')
      return
    }
    for (const s of sessions) {
      const marker = s.id === currentSessionId ? ' *' : ''
      stdout.write(`  ${s.id} (created: ${new Date(s.createdAt).toLocaleString()})${marker}\n`)
    }
  }

  const showCheckpoint = async (): Promise<void> => {
    if (!currentSessionId) {
      stdout.write('No session selected.\n')
      return
    }
    const info = await apiFetch(`/api/sessions/${currentSessionId}/resume`).catch(() => null)
    if (!info || !info.canResume) {
      stdout.write('No checkpoint for current session.\n')
      return
    }
    const cp = info.checkpoint
    stdout.write(`Checkpoint for session ${currentSessionId}:\n`)
    stdout.write(`  Task: ${cp.task.slice(0, 80)}...\n`)
    stdout.write(`  Iterations: ${cp.iterations}\n`)
    stdout.write(`  Messages: ${cp.messages.length}\n`)
    stdout.write(`  Updated: ${new Date(cp.updatedAt).toLocaleString()}\n`)
  }

  const switchSession = async (id: string): Promise<void> => {
    const session = await apiFetch(`/api/sessions/${id}`)
    currentSessionId = session.id
    stdout.write(`Switched to session ${id}\n`)
  }

  // Main input loop
  rl.prompt()

  for await (const line of rl) {
    const trimmed = line.trim()
    if (!trimmed) {
      rl.prompt()
      continue
    }

    if (trimmed.startsWith(':')) {
      const { cmd, args } = parseArgs(trimmed)
      switch (cmd) {
        case ':quit':
        case ':q':
          rl.close()
          break
        case ':help':
        case ':h':
          printHelp()
          break
        case ':sessions':
          await listSessions()
          break
        case ':new':
          try {
            const sess = await apiFetch('/api/sessions', 'POST', {
              model: 'MiniMax-M2.7',
              provider: 'minimaxi',
            })
            currentSessionId = sess.id
            stdout.write(`Created session ${currentSessionId}\n`)
          } catch (e: any) {
            stdout.write(`Error: ${e.message}\n`)
          }
          break
        case ':session':
          if (args[0]) {
            await switchSession(args[0])
          } else {
            stdout.write('Usage: :session <id>\n')
          }
          break
        case ':info':
          if (currentSessionId) {
            const sess = await apiFetch(`/api/sessions/${currentSessionId}`)
            stdout.write(`Session: ${sess.id}\n`)
            stdout.write(`Messages: ${sess.messages?.length ?? 0}\n`)
            stdout.write(`Created: ${new Date(sess.createdAt).toLocaleString()}\n`)
          } else {
            stdout.write('No session selected.\n')
          }
          break
        case ':checkpoint':
          await showCheckpoint()
          break
        default:
          stdout.write(`Unknown command: ${cmd}. Try :help\n`)
      }
    } else {
      await sendMessage(trimmed)
    }

    rl.prompt()
  }
}

// ---- Entry point ----

runREPL().catch(e => {
  console.error('REPL error:', e)
  process.exit(1)
})