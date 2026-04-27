import { describe, it, expect } from 'vitest'
import { detectDoomLoop, hasSubstantialText, createProgressTracker, trackToolCall, isProgressStalling, type DoomDetectResult } from '../../src/agent/doomDetect.js'
import type { Message } from '../../src/session/types.js'

function createMessage(role: 'user' | 'assistant', parts: Message['parts'], id = 'default'): Message {
  return { id, role, parts, timestamp: Date.now() }
}

function createToolUse(tool: string, input: unknown, callID = 'call-1') {
  return { type: 'tool_use' as const, tool, input, callID }
}

function createToolResult(callID: string, content: string) {
  return { type: 'tool_result' as const, callID, content }
}

function createTextPart(content: string) {
  return { type: 'text' as const, content }
}

describe('detectDoomLoop', () => {
  describe('exact loop detection', () => {
    it('should detect exact same tool with same input repeated 3 times', () => {
      // The detectDoomLoop only looks at the last `threshold` messages
      // AND they must ALL be assistant messages with tool_use parts
      // So we need exactly 3 consecutive assistant messages at the END
      const messages: Message[] = [
        createMessage('user', [createTextPart('Read a file')]),
        createMessage('assistant', [createToolUse('read', { path: '/other.txt' }), createTextPart('Reading')]),
        createMessage('user', [createToolResult('call-0', 'Other content')]),
        // The last 3 messages MUST all be assistant with the same tool+input
        createMessage('assistant', [createToolUse('read', { path: '/file.txt' }), createTextPart('Reading')]),
        createMessage('assistant', [createToolUse('read', { path: '/file.txt' }), createTextPart('Reading')]),
        createMessage('assistant', [createToolUse('read', { path: '/file.txt' }), createTextPart('Reading')]),
      ]

      const result = detectDoomLoop(messages, 3)
      expect(result.isDoomLoop).toBe(true)
      expect(result.type).toBe('exact')
      expect(result.toolName).toBe('read')
      expect(result.consecutiveCount).toBe(3)
    })

    it('should not flag different inputs as exact loop', () => {
      const messages: Message[] = [
        createMessage('assistant', [createToolUse('read', { path: '/file1.txt' }), createTextPart('Reading')]),
        createMessage('user', [createToolResult('call-1', 'Content 1')]),
        createMessage('assistant', [createToolUse('read', { path: '/file2.txt' }), createTextPart('Reading')]),
        createMessage('user', [createToolResult('call-2', 'Content 2')]),
        createMessage('assistant', [createToolUse('read', { path: '/file3.txt' }), createTextPart('Reading')]),
        createMessage('user', [createToolResult('call-3', 'Content 3')]),
      ]

      const result = detectDoomLoop(messages, 3)
      expect(result.isDoomLoop).toBe(false)
    })

    it('should not flag different tools as exact loop', () => {
      const messages: Message[] = [
        createMessage('assistant', [createToolUse('read', { path: '/file.txt' }), createTextPart('Reading')]),
        createMessage('user', [createToolResult('call-1', 'Content')]),
        createMessage('assistant', [createToolUse('edit', { path: '/file.txt' }), createTextPart('Editing')]),
        createMessage('user', [createToolResult('call-2', 'Edited')]),
        createMessage('assistant', [createToolUse('bash', { command: 'ls' }), createTextPart('Running')]),
        createMessage('user', [createToolResult('call-3', 'Files listed')]),
      ]

      const result = detectDoomLoop(messages, 3)
      expect(result.isDoomLoop).toBe(false)
    })

    it('should require threshold number of messages', () => {
      const messages: Message[] = [
        createMessage('assistant', [createToolUse('read', { path: '/file.txt' })]),
        createMessage('user', [createToolResult('call-1', 'Content')]),
        createMessage('assistant', [createToolUse('read', { path: '/file.txt' })]),
        createMessage('user', [createToolResult('call-2', 'Content')]),
      ]

      const result = detectDoomLoop(messages, 3)
      expect(result.isDoomLoop).toBe(false)
    })
  })

  describe('pattern loop detection', () => {
    it('should detect read with similar inputs (different offset/limit)', () => {
      // Pattern detection also requires last threshold messages to be ALL assistant
      const messages: Message[] = [
        createMessage('user', [createTextPart('Initial request')]),
        createMessage('assistant', [createToolUse('read', { path: '/large.txt', offset: 0, limit: 100 }), createTextPart('Reading')]),
        createMessage('user', [createToolResult('call-1', 'Lines 1-100')]),
        // Last 3 must be all assistant
        createMessage('assistant', [createToolUse('read', { path: '/large.txt', offset: 100, limit: 100 }), createTextPart('Reading')]),
        createMessage('assistant', [createToolUse('read', { path: '/large.txt', offset: 200, limit: 100 }), createTextPart('Reading')]),
        createMessage('assistant', [createToolUse('read', { path: '/large.txt', offset: 300, limit: 100 }), createTextPart('Reading')]),
      ]

      const result = detectDoomLoop(messages, 3)
      expect(result.isDoomLoop).toBe(true)
      expect(result.type).toBe('pattern')
      expect(result.toolName).toBe('read')
    })

    it('should not flag pattern loop for non-read/edit tools', () => {
      const messages: Message[] = [
        createMessage('assistant', [createToolUse('bash', { command: 'ls /dir1' }), createTextPart('Listing')]),
        createMessage('user', [createToolResult('call-1', 'dir1 contents')]),
        createMessage('assistant', [createToolUse('bash', { command: 'ls /dir2' }), createTextPart('Listing')]),
        createMessage('user', [createToolResult('call-2', 'dir2 contents')]),
        createMessage('assistant', [createToolUse('bash', { command: 'ls /dir3' }), createTextPart('Listing')]),
        createMessage('user', [createToolResult('call-3', 'dir3 contents')]),
      ]

      const result = detectDoomLoop(messages, 3)
      expect(result.isDoomLoop).toBe(false)
    })
  })

  describe('output loop detection', () => {
    it('should detect identical tool outputs repeated', () => {
      const messages: Message[] = [
        createMessage('assistant', [createToolUse('bash', { command: 'cat /file.txt' }), createTextPart('Running')]),
        createMessage('user', [createToolResult('call-1', 'Error: File not found at 2024-01-01 12:00:00')]),
        createMessage('assistant', [createToolUse('bash', { command: 'cat /file.txt' }), createTextPart('Running')]),
        createMessage('user', [createToolResult('call-2', 'Error: File not found at 2024-01-01 12:00:01')]),
        createMessage('assistant', [createToolUse('bash', { command: 'cat /file.txt' }), createTextPart('Running')]),
        createMessage('user', [createToolResult('call-3', 'Error: File not found at 2024-01-01 12:00:02')]),
      ]

      const result = detectDoomLoop(messages, 3)
      expect(result.isDoomLoop).toBe(true)
      expect(result.type).toBe('output')
    })
  })

  describe('no loop detection', () => {
    it('should not flag normal conversation', () => {
      const messages: Message[] = [
        createMessage('user', [createTextPart('Read the file')]),
        createMessage('assistant', [createToolUse('read', { path: '/file.txt' }), createTextPart('Reading')]),
        createMessage('user', [createToolResult('call-1', 'File content here')]),
        createMessage('assistant', [createTextPart('The file contains some content. I can see it says hello world.')]),
        createMessage('user', [createTextPart('Good, now edit it')]),
        createMessage('assistant', [createToolUse('edit', { path: '/file.txt', oldString: 'hello', newString: 'hi' }), createTextPart('Editing')]),
        createMessage('user', [createToolResult('call-2', 'File edited')]),
        createMessage('assistant', [createTextPart('Done!')]),
      ]

      const result = detectDoomLoop(messages, 3)
      expect(result.isDoomLoop).toBe(false)
    })
  })
})

describe('hasSubstantialText', () => {
  it('should return true for strings > 10 chars', () => {
    expect(hasSubstantialText('Hello world! This is a test.')).toBe(true)
    expect(hasSubstantialText('这是一个超过十个字符的中文字符串')).toBe(true)
  })

  it('should return false for strings <= 10 chars', () => {
    expect(hasSubstantialText('Hello worl')).toBe(false)  // 10 chars
    expect(hasSubstantialText('好的，继续')).toBe(false)  // 5 chars
    expect(hasSubstantialText('')).toBe(false)
  })

  it('should handle array content', () => {
    expect(hasSubstantialText([
      { type: 'text', text: 'Hello world!' }
    ])).toBe(true)
    expect(hasSubstantialText([
      { type: 'text', text: 'Hi' }
    ])).toBe(false)
  })

  it('should handle null/undefined', () => {
    expect(hasSubstantialText(null)).toBe(false)
    expect(hasSubstantialText(undefined)).toBe(false)
  })
})

describe('Progress tracking', () => {
  it('should create a progress tracker', () => {
    const tracker = createProgressTracker()
    expect(tracker.toolCalls).toHaveLength(0)
    expect(tracker.totalOutputLength).toBe(0)
  })

  it('should track tool calls', () => {
    const tracker = createProgressTracker()
    trackToolCall(tracker, 'read', { path: '/file.txt' }, true, 100)
    expect(tracker.toolCalls).toHaveLength(1)
    expect(tracker.totalOutputLength).toBe(100)
  })

  it('should detect stalling when same tool dominates', () => {
    const tracker = createProgressTracker()
    // Add 6 successful read calls with output (more than half of windowSize=10)
    // All must succeed and outputGrowing must be false (totalOutputLength = 0)
    for (let i = 0; i < 6; i++) {
      trackToolCall(tracker, 'read', { path: '/file.txt' }, true, 0)  // 0 output length = no growth
    }
    // Add 4 other successful calls
    for (let i = 0; i < 4; i++) {
      trackToolCall(tracker, 'bash', { command: 'ls' }, true, 0)
    }

    expect(isProgressStalling(tracker, 10)).toBe(true)
  })

  it('should not detect stalling with diverse tools', () => {
    const tracker = createProgressTracker()
    for (let i = 0; i < 10; i++) {
      trackToolCall(tracker, ['read', 'edit', 'bash', 'glob'][i % 4], {}, true, 10)
    }

    expect(isProgressStalling(tracker, 10)).toBe(false)
  })

  it('should not flag if not enough data', () => {
    const tracker = createProgressTracker()
    trackToolCall(tracker, 'read', {}, true, 10)

    expect(isProgressStalling(tracker, 10)).toBe(false)
  })
})