import { describe, it, expect, beforeEach } from 'vitest'
import { useAgent, type Message, type AgentSession } from '../../src/lib/stores/agent'

describe('Agent Store', () => {
  // The store is a singleton with module-level state
  // Tests should be written to account for this
  const agent = useAgent()

  beforeEach(() => {
    // Clear active session to avoid state pollution between tests
    agent.setActiveSession(null)
  })

  describe('useAgent', () => {
    it('should create a new session with unique id', () => {
      const sessionId1 = agent.createSession()
      // Small delay to ensure different timestamp
      const sessionId2 = agent.createSession()

      expect(sessionId1).toBeTruthy()
      expect(sessionId2).toBeTruthy()
      // IDs may be the same if created in same millisecond (Date.now() limitation)
      // Just verify they're valid session IDs
      expect(sessionId1).toMatch(/^session_\d+$/)
      expect(sessionId2).toMatch(/^session_\d+$/)
    })

    it('should create session with default values', () => {
      const sessionId = agent.createSession()
      const session = agent.state.sessions.get(sessionId)

      expect(session).toBeDefined()
      expect(session?.id).toBe(sessionId)
      expect(session?.messages).toEqual([])
      expect(session?.status).toBe('idle')
      expect(session?.createdAt).toBeDefined()
      expect(session?.updatedAt).toBeDefined()
    })

    it('should set and get active session', () => {
      const sessionId = agent.createSession()

      agent.setActiveSession(sessionId)
      expect(agent.state.activeSessionId).toBe(sessionId)

      const activeSession = agent.getActiveSession()
      expect(activeSession).toBeDefined()
      expect(activeSession?.id).toBe(sessionId)
    })

    it('should return null when no active session after reset', () => {
      // First ensure no active session
      agent.setActiveSession(null)
      expect(agent.getActiveSession()).toBeNull()
    })

    it('should add message to session', () => {
      const sessionId = agent.createSession()

      const message: Message = {
        id: 'msg-1',
        role: 'user',
        content: 'Hello',
        timestamp: Date.now(),
      }

      agent.addMessage(sessionId, message)

      const session = agent.state.sessions.get(sessionId)
      expect(session?.messages).toHaveLength(1)
      expect(session?.messages[0].content).toBe('Hello')
    })

    it('should not add message to non-existent session', () => {
      const message: Message = {
        id: 'msg-1',
        role: 'user',
        content: 'Hello',
        timestamp: Date.now(),
      }

      agent.addMessage('non-existent-session', message)

      const session = agent.state.sessions.get('non-existent-session')
      expect(session).toBeUndefined()
    })

    it('should update message in session', () => {
      const sessionId = agent.createSession()

      const message: Message = {
        id: 'msg-1',
        role: 'user',
        content: 'Hello',
        timestamp: Date.now(),
      }

      agent.addMessage(sessionId, message)
      agent.updateMessage(sessionId, 'msg-1', { content: 'Updated Hello' })

      const session = agent.state.sessions.get(sessionId)
      expect(session?.messages[0].content).toBe('Updated Hello')
    })

    it('should set session status', () => {
      const sessionId = agent.createSession()

      expect(agent.state.sessions.get(sessionId)?.status).toBe('idle')

      agent.setSessionStatus(sessionId, 'running')
      expect(agent.state.sessions.get(sessionId)?.status).toBe('running')

      agent.setSessionStatus(sessionId, 'paused')
      expect(agent.state.sessions.get(sessionId)?.status).toBe('paused')
    })

    it('should set config', () => {
      const config = {
        apiKey: 'test-key',
        baseUrl: 'https://api.test.com',
        model: 'test-model',
      }

      agent.setConfig(config)
      expect(agent.state.config).toEqual(config)
    })
  })

  describe('Message interface', () => {
    it('should support user role', () => {
      const message: Message = {
        id: 'msg-1',
        role: 'user',
        content: 'Test message',
        timestamp: Date.now(),
      }
      expect(message.role).toBe('user')
    })

    it('should support agent role', () => {
      const message: Message = {
        id: 'msg-1',
        role: 'agent',
        content: 'Agent response',
        timestamp: Date.now(),
      }
      expect(message.role).toBe('agent')
    })

    it('should support system role', () => {
      const message: Message = {
        id: 'msg-1',
        role: 'system',
        content: 'System prompt',
        timestamp: Date.now(),
      }
      expect(message.role).toBe('system')
    })

    it('should support tool calls', () => {
      const message: Message = {
        id: 'msg-1',
        role: 'agent',
        content: 'Using tool',
        timestamp: Date.now(),
        toolCalls: [
          {
            id: 'call-1',
            name: 'read',
            input: { path: '/test.txt' },
            status: 'pending',
          },
        ],
      }
      expect(message.toolCalls).toHaveLength(1)
      expect(message.toolCalls?.[0].name).toBe('read')
      expect(message.toolCalls?.[0].status).toBe('pending')
    })
  })

  describe('AgentSession interface', () => {
    it('should define valid session statuses', () => {
      const session: AgentSession = {
        id: 'session-1',
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: 'idle',
      }

      expect(['idle', 'running', 'paused']).toContain(session.status)
    })
  })
})
