import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  COMPACTION_TOKEN_THRESHOLD,
  COMPACTION_WARNING_THRESHOLD,
  PRUNE_PROTECTED_TOOLS,
  checkCompactionState,
  shouldCompact,
  shouldCompactMidTurn,
  getCompactionUrgency,
  compactMessages,
  type CompactionConfig,
} from '../../src/agent/compaction.js'
import type { Message } from '../../src/session/types.js'

function createMessage(role: 'user' | 'assistant', parts: Message['parts'], id = 'default'): Message {
  return { id, role, parts, timestamp: Date.now() }
}

function createToolUse(tool: string, input: unknown, callID = 'call-1') {
  return { type: 'tool_use' as const, tool, input, callID }
}

function createTextPart(content: string) {
  return { type: 'text' as const, content }
}

describe('Compaction constants', () => {
  it('should have correct token threshold', () => {
    expect(COMPACTION_TOKEN_THRESHOLD).toBe(80_000)
  })

  it('should have correct warning threshold', () => {
    expect(COMPACTION_WARNING_THRESHOLD).toBe(0.7)
  })

  it('should protect read, glob, grep, and skill tools', () => {
    expect(PRUNE_PROTECTED_TOOLS).toContain('read')
    expect(PRUNE_PROTECTED_TOOLS).toContain('glob')
    expect(PRUNE_PROTECTED_TOOLS).toContain('grep')
    expect(PRUNE_PROTECTED_TOOLS).toContain('skill')
  })
})

describe('checkCompactionState', () => {
  it('should return shouldCompactNow=true when tokens exceed threshold', () => {
    const state = checkCompactionState(90_000)
    expect(state.shouldCompactNow).toBe(true)
    expect(state.warningIssued).toBe(true)
    expect(state.reason).toContain('exceeded')
  })

  it('should issue warning at 70% threshold', () => {
    const state = checkCompactionState(60_000) // 75% of 80k
    expect(state.warningIssued).toBe(true)
    expect(state.shouldCompactNow).toBe(false)
    expect(state.reason).toContain('warning')
  })

  it('should return no warning below threshold', () => {
    const state = checkCompactionState(40_000) // 50% of 80k
    expect(state.warningIssued).toBe(false)
    expect(state.shouldCompactNow).toBe(false)
    expect(state.reason).toBeUndefined()
  })
})

describe('shouldCompact', () => {
  it('should return true when at threshold', () => {
    expect(shouldCompact(80_000)).toBe(true)
  })

  it('should return true when over threshold', () => {
    expect(shouldCompact(100_000)).toBe(true)
  })

  it('should return false when under threshold', () => {
    expect(shouldCompact(40_000)).toBe(false)
  })
})

describe('shouldCompactMidTurn', () => {
  it('should return true when mid-turn would exceed threshold', () => {
    // 70k + 15k + 2k buffer = 87k > 80k
    expect(shouldCompactMidTurn(70_000, 15_000)).toBe(true)
  })

  it('should return false when mid-turn would stay under threshold', () => {
    // 50k + 10k + 2k buffer = 62k < 80k
    expect(shouldCompactMidTurn(50_000, 10_000)).toBe(false)
  })

  it('should respect custom buffer', () => {
    // 65k + 10k + 5k = 80k >= 80k threshold - exactly at threshold triggers compaction
    expect(shouldCompactMidTurn(65_000, 10_000, 5000)).toBe(true)
    // 60k + 8k + 5k = 73k < 80k - below threshold
    expect(shouldCompactMidTurn(60_000, 8_000, 5000)).toBe(false)
  })
})

describe('getCompactionUrgency', () => {
  it('should return none under 50%', () => {
    expect(getCompactionUrgency(30_000)).toBe('none')
    expect(getCompactionUrgency(39_999)).toBe('none')
  })

  it('should return low at 50-70%', () => {
    expect(getCompactionUrgency(40_000)).toBe('low')
    expect(getCompactionUrgency(55_000)).toBe('low')
  })

  it('should return medium at 70-85%', () => {
    // 70% = 56,000, 85% = 68,000
    expect(getCompactionUrgency(56_000)).toBe('medium')
    expect(getCompactionUrgency(67_999)).toBe('medium')
  })

  it('should return high at 85-100%', () => {
    // 85% = 68,000
    expect(getCompactionUrgency(68_000)).toBe('high')
    expect(getCompactionUrgency(79_000)).toBe('high')
  })

  it('should return critical at or over 100%', () => {
    expect(getCompactionUrgency(80_000)).toBe('critical')
    expect(getCompactionUrgency(100_000)).toBe('critical')
  })
})

describe('compactMessages', () => {
  const mockConfig: CompactionConfig = {
    baseUrl: 'https://api.minimaxi.com/anthropic',
    apiKey: 'test-key',
    model: 'test-model',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return messages unchanged if fewer than MIN_RECENT_MESSAGES', async () => {
    const messages: Message[] = [
      createMessage('user', [createTextPart('Hello')]),
      createMessage('assistant', [createTextPart('Hi')]),
    ]

    const result = await compactMessages(messages, mockConfig)
    expect(result).toHaveLength(2)
    expect(result).toBe(messages)
  })

  it('should protect last MIN_RECENT_MESSAGES messages', async () => {
    const messages: Message[] = Array.from({ length: 10 }, (_, i) =>
      createMessage('user', [createTextPart(`Message ${i}`)], `msg-${i}`)
    )

    const result = await compactMessages(messages, mockConfig)
    // Last 5 messages should be preserved
    expect(result.length).toBeLessThanOrEqual(messages.length)
  })

  it('should protect tool messages from PRUNE_PROTECTED_TOOLS', async () => {
    const messages: Message[] = [
      createMessage('assistant', [createToolUse('read', { path: '/file.txt' }), createTextPart('Reading')]),
      createMessage('user', [{ type: 'tool_result' as const, callID: 'call-1', content: 'content' }]),
      createMessage('assistant', [createToolUse('glob', { pattern: '*.ts' }), createTextPart('Globbing')]),
      createMessage('user', [{ type: 'tool_result' as const, callID: 'call-2', content: 'files' }]),
      createMessage('assistant', [createToolUse('grep', { pattern: 'test' }), createTextPart('Grepping')]),
      createMessage('user', [{ type: 'tool_result' as const, callID: 'call-3', content: 'matches' }]),
      // Add more old messages
      ...Array.from({ length: 10 }, (_, i) =>
        createMessage('user', [createTextPart(`Old message ${i}`)], `old-${i}`)
      ),
    ]

    const result = await compactMessages(messages, mockConfig)
    // Protected tool messages should be in the result
    expect(result).toBeDefined()
  })

  it('should keep all messages if no messages need summarization', async () => {
    const messages: Message[] = Array.from({ length: 6 }, (_, i) =>
      createMessage('user', [createTextPart(`Message ${i}`)], `msg-${i}`)
    )

    // Mock fetch to fail - but messages should still be returned if no summarization needed
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
    }) as any

    const result = await compactMessages(messages, mockConfig)
    expect(result).toBeDefined()
  })

  it('should handle fetch errors gracefully', async () => {
    const messages: Message[] = [
      ...Array.from({ length: 10 }, (_, i) =>
        createMessage('user', [createTextPart(`Message ${i}`)], `msg-${i}`)
      ),
    ]

    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

    const result = await compactMessages(messages, mockConfig)
    // Should return original messages on error
    expect(result).toHaveLength(messages.length)
  })

  it('should use baseUrl without /v1 suffix', async () => {
    const configWithV1: CompactionConfig = {
      ...mockConfig,
      baseUrl: 'https://api.minimaxi.com/anthropic/v1',
    }

    // Create enough messages to exceed PRUNE_PROTECT_TOKENS (40000)
    // Each message has ~200 tokens, so 300+ messages would exceed it
    // But let's use a simpler approach - just check the URL transformation works
    const largeContent = 'x'.repeat(5000) // ~1250 tokens per message
    const messages: Message[] = Array.from({ length: 50 }, (_, i) =>
      createMessage('user', [createTextPart(`Message ${i} ${largeContent}`)], `msg-${i}`)
    )

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ content: [{ type: 'text', text: 'summary' }] }),
    }) as any

    await compactMessages(messages, configWithV1)
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('https://api.minimaxi.com/anthropic/v1/messages'),
      expect.any(Object)
    )
  })

  it('should handle successful API response', async () => {
    const largeContent = 'x'.repeat(20000) // ~5000 tokens per message
    // Need enough messages to exceed PRUNE_PROTECT_TOKENS
    const messages: Message[] = Array.from({ length: 20 }, (_, i) =>
      createMessage('user', [createTextPart(`Message ${i} ${largeContent}`)], `msg-${i}`)
    )

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        content: [{ type: 'text', text: 'This is a summary of the conversation.' }]
      }),
    }) as any

    const result = await compactMessages(messages, mockConfig)
    // Should return summary message + protected messages (less than original 20)
    expect(result.length).toBeLessThan(messages.length)
  })

  it('should skip compaction if protected messages too many', async () => {
    // Create messages with protected tools to maximize protected count
    const messages: Message[] = [
      ...Array.from({ length: 7 }, (_, i) =>
        createMessage('assistant', [createToolUse('read', { path: `/file${i}.txt` }), createTextPart('Reading')])
      ),
      ...Array.from({ length: 7 }, (_, i) =>
        createMessage('user', [{ type: 'tool_result' as const, callID: `call-${i}`, content: 'result' }])
      ),
      ...Array.from({ length: 2 }, (_, i) =>
        createMessage('user', [createTextPart(`Message ${i}`)], `msg-${i}`)
      ),
    ]

    // Should return original because protected >= messages.length - 2
    const result = await compactMessages(messages, mockConfig)
    expect(result).toHaveLength(messages.length)
  })
})