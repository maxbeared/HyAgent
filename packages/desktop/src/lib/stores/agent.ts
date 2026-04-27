import { createStore } from 'solid-js/store'
import type { AgentStreamEvent, AgentResult } from '@hybrid-agent/core'
import type { AgentConfig } from '@hybrid-agent/core'

export interface Message {
  id: string
  role: 'user' | 'agent' | 'system'
  content: string
  timestamp: number
  toolCalls?: Array<{
    id: string
    name: string
    input: any
    result?: string
    status: 'pending' | 'success' | 'error'
  }>
}

export interface AgentSession {
  id: string
  messages: Message[]
  createdAt: number
  updatedAt: number
  status: 'idle' | 'running' | 'paused'
}

export interface AgentState {
  sessions: Map<string, AgentSession>
  activeSessionId: string | null
  config: AgentConfig | null
}

const [state, setState] = createStore<AgentState>({
  sessions: new Map(),
  activeSessionId: null,
  config: null,
})

export function useAgent() {
  const setConfig = (config: AgentConfig | null) => {
    setState('config', config)
  }

  const createSession = (): string => {
    const id = `session_${Date.now()}`
    const session: AgentSession = {
      id,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'idle',
    }
    setState('sessions', new Map(state.sessions).set(id, session))
    return id
  }

  const setActiveSession = (id: string) => {
    setState('activeSessionId', id)
  }

  const getActiveSession = (): AgentSession | null => {
    if (!state.activeSessionId) return null
    return state.sessions.get(state.activeSessionId) || null
  }

  const addMessage = (sessionId: string, message: Message) => {
    const sessions = new Map(state.sessions)
    const session = sessions.get(sessionId)
    if (session) {
      session.messages.push(message)
      session.updatedAt = Date.now()
      sessions.set(sessionId, session)
      setState('sessions', sessions)
    }
  }

  const updateMessage = (sessionId: string, messageId: string, updates: Partial<Message>) => {
    const sessions = new Map(state.sessions)
    const session = sessions.get(sessionId)
    if (session) {
      const msgIndex = session.messages.findIndex(m => m.id === messageId)
      if (msgIndex >= 0) {
        session.messages[msgIndex] = { ...session.messages[msgIndex], ...updates }
        sessions.set(sessionId, session)
        setState('sessions', sessions)
      }
    }
  }

  const setSessionStatus = (sessionId: string, status: AgentSession['status']) => {
    const sessions = new Map(state.sessions)
    const session = sessions.get(sessionId)
    if (session) {
      session.status = status
      sessions.set(sessionId, session)
      setState('sessions', sessions)
    }
  }

  return {
    state,
    setConfig,
    createSession,
    setActiveSession,
    getActiveSession,
    addMessage,
    updateMessage,
    setSessionStatus,
  }
}

export type { AgentStreamEvent, AgentResult }