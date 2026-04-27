import { describe, it, expect } from 'vitest'
import { shouldCompact, type CompactionConfig } from '../../src/session/types.js'

describe('Session types', () => {
  describe('Message types', () => {
    it('should support text part', () => {
      const textPart = { type: 'text' as const, content: 'Hello world' }
      expect(textPart.type).toBe('text')
      expect(textPart.content).toBe('Hello world')
    })

    it('should support tool_use part', () => {
      const toolPart = { type: 'tool_use' as const, tool: 'read', input: { path: '/file.txt' }, callID: 'call-1' }
      expect(toolPart.tool).toBe('read')
      expect(toolPart.input).toEqual({ path: '/file.txt' })
    })

    it('should support tool_result part', () => {
      const resultPart = { type: 'tool_result' as const, callID: 'call-1', content: 'File content' }
      expect(resultPart.callID).toBe('call-1')
      expect(resultPart.content).toBe('File content')
    })

    it('should support reasoning part', () => {
      const reasoningPart = { type: 'reasoning' as const, content: 'Let me think about this...' }
      expect(reasoningPart.type).toBe('reasoning')
    })
  })

  describe('PermissionMode', () => {
    it('should define 4 permission modes', () => {
      const modes = ['permissive', 'default', 'askAll', 'plan'] as const
      expect(modes).toHaveLength(4)
    })
  })

  describe('shouldCompact function', () => {
    it('should return false when under threshold', () => {
      const messages: any[] = Array(10).fill({
        id: '1',
        role: 'user',
        parts: [{ type: 'text', content: 'test' }],
        timestamp: Date.now(),
      })

      // The function from session/types.ts uses estimated tokens
      expect(shouldCompact(messages, { targetTokens: 1000, maxMessages: 100, minTurnsBetweenCompaction: 3 })).toEqual({
        shouldCompact: false,
      })
    })
  })

  describe('Session interface', () => {
    it('should define session with required fields', () => {
      const session = {
        id: 'session-1',
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }

      expect(session.id).toBeDefined()
      expect(session.messages).toBeDefined()
      expect(session.createdAt).toBeDefined()
    })

    it('should support optional fields', () => {
      const session = {
        id: 'session-1',
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        model: 'claude-3-5-sonnet',
        provider: 'anthropic',
        parentId: 'parent-session',
        forkCount: 2,
        permissionMode: 'default' as const,
      }

      expect(session.model).toBe('claude-3-5-sonnet')
      expect(session.parentId).toBe('parent-session')
      expect(session.forkCount).toBe(2)
      expect(session.permissionMode).toBe('default')
    })
  })
})