import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { AgentService, agentService, type Session } from '../../src/lib/services/agentService'
import type { AgentConfig, AgentStreamEvent } from '@hyagent/core'

describe('AgentService', () => {
  let service: AgentService

  beforeEach(() => {
    // Create a fresh instance for each test to avoid state pollution
    service = new AgentService()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('configure', () => {
    it('should store configuration', () => {
      const config: AgentConfig = {
        apiKey: 'test-key',
        baseUrl: 'https://api.test.com',
        model: 'test-model',
      }

      service.configure(config)

      expect(service.isConfigured()).toBe(true)
      expect(service.getConfig()).toEqual(config)
    })

    it('should log configuration (without apiKey)', () => {
      const config: AgentConfig = {
        apiKey: 'test-key',
        baseUrl: 'https://api.test.com',
        model: 'test-model',
      }
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      service.configure(config)

      expect(consoleSpy).toHaveBeenCalledWith(
        '[AgentService] Configured with:',
        expect.objectContaining({
          baseUrl: 'https://api.test.com',
          model: 'test-model',
          hasApiKey: true,
        })
      )
      consoleSpy.mockRestore()
    })
  })

  describe('isConfigured', () => {
    it('should return false when not configured', () => {
      expect(service.isConfigured()).toBe(false)
    })

    it('should return false when apiKey is empty', () => {
      service.configure({
        apiKey: '',
        baseUrl: 'https://api.test.com',
        model: 'test-model',
      })

      expect(service.isConfigured()).toBe(false)
    })

    it('should return true when configured with valid apiKey', () => {
      service.configure({
        apiKey: 'valid-key',
        baseUrl: 'https://api.test.com',
        model: 'test-model',
      })

      expect(service.isConfigured()).toBe(true)
    })
  })

  describe('getConfig', () => {
    it('should return null when not configured', () => {
      expect(service.getConfig()).toBeNull()
    })

    it('should return config when configured', () => {
      const config: AgentConfig = {
        apiKey: 'test-key',
        baseUrl: 'https://api.test.com',
        model: 'test-model',
      }

      service.configure(config)

      expect(service.getConfig()).toEqual(config)
    })
  })

  describe('streamChat', () => {
    it('should yield error when not configured', async () => {
      const events: AgentStreamEvent[] = []

      for await (const event of service.streamChat('session-1', [], 'Hello')) {
        events.push(event)
      }

      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({
        type: 'error',
        error: 'Agent not configured. Please set API key in Settings.',
      })
    })

    it('should yield text events when configured', async () => {
      service.configure({
        apiKey: 'valid-key',
        baseUrl: 'https://api.test.com',
        model: 'test-model',
      })

      const events: AgentStreamEvent[] = []

      for await (const event of service.streamChat('session-1', [], 'Hello')) {
        events.push(event)
      }

      expect(events.length).toBeGreaterThan(0)
      expect(events[0]).toEqual({ type: 'text', content: '' })
      expect(events[events.length - 1].type).toBe('done')
    })

    it('should include user message in conversation', async () => {
      service.configure({
        apiKey: 'valid-key',
        baseUrl: 'https://api.test.com',
        model: 'test-model',
      })

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      for await (const _ of service.streamChat('session-1', [], 'Test message')) {
        // consume the stream
      }

      expect(consoleSpy).toHaveBeenCalledWith(
        '[AgentService] Sending message:',
        expect.stringContaining('Test message')
      )
      consoleSpy.mockRestore()
    })

    it('should pass previous messages to conversation', async () => {
      service.configure({
        apiKey: 'valid-key',
        baseUrl: 'https://api.test.com',
        model: 'test-model',
      })

      const previousMessages = [
        { role: 'user' as const, content: 'Previous message' },
        { role: 'agent' as const, content: 'Previous response' },
      ]

      const events: AgentStreamEvent[] = []
      for await (const event of service.streamChat('session-1', previousMessages, 'New message')) {
        events.push(event)
      }

      expect(events.length).toBeGreaterThan(0)
    })
  })

  describe('createSession', () => {
    it('should create a new session with unique id', () => {
      const session = service.createSession()

      expect(session.id).toBeTruthy()
      expect(session.messages).toEqual([])
      expect(session.createdAt).toBeDefined()
      expect(session.updatedAt).toBeDefined()
    })

    it('should create sessions with valid id format', () => {
      const session = service.createSession()

      expect(session.id).toMatch(/^session_\d+$/)
    })
  })

  describe('getSession', () => {
    it('should return undefined for non-existent session', () => {
      expect(service.getSession('non-existent')).toBeUndefined()
    })

    it('should return created session', () => {
      const created = service.createSession()

      const retrieved = service.getSession(created.id)

      expect(retrieved).toEqual(created)
    })
  })

  describe('getAllSessions', () => {
    it('should return empty array initially for fresh service', () => {
      // Each test gets a fresh service instance
      expect(service.getAllSessions()).toEqual([])
    })

    it('should return created sessions', () => {
      const session1 = service.createSession()

      const sessions = service.getAllSessions()

      expect(sessions.length).toBeGreaterThanOrEqual(1)
      expect(sessions.map((s) => s.id)).toContain(session1.id)
    })
  })

  describe('deleteSession', () => {
    it('should return false for non-existent session', () => {
      expect(service.deleteSession('non-existent')).toBe(false)
    })

    it('should delete existing session', () => {
      const session = service.createSession()

      const result = service.deleteSession(session.id)

      expect(result).toBe(true)
      expect(service.getSession(session.id)).toBeUndefined()
    })
  })

  describe('getAgentState', () => {
    it('should return default agent state', () => {
      const state = service.getAgentState('session-1')

      expect(state.sessionId).toBe('session-1')
      expect(state.status).toBe('idle')
      expect(state.currentTask).toBe('')
      expect(state.iterations).toBe(0)
      expect(state.totalTokens).toBe(0)
    })
  })

  describe('Session interface', () => {
    it('should create session with required fields', () => {
      const session: Session = {
        id: 'session-1',
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }

      expect(session.id).toBe('session-1')
      expect(session.messages).toEqual([])
      expect(session.createdAt).toBeDefined()
      expect(session.updatedAt).toBeDefined()
    })
  })
})

describe('agentService singleton', () => {
  it('should be an instance of AgentService', () => {
    expect(agentService).toBeInstanceOf(AgentService)
  })

  it('should not be configured initially', () => {
    expect(agentService.isConfigured()).toBe(false)
  })
})
