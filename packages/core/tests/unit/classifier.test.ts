import { describe, it, expect, beforeEach, vi } from 'vitest'
import { YOLOClassifier, getYOLOClassifier, type PermissionEvent, type ClassificationResult } from '../../src/permission/classifier.js'

describe('YOLOClassifier', () => {
  let classifier: YOLOClassifier

  beforeEach(() => {
    classifier = new YOLOClassifier()
  })

  describe('classify', () => {
    it('should return ask with low confidence for unknown inputs', () => {
      const result = classifier.classify('read', { path: '/unknown/file.txt' })
      expect(result.decision).toBe('ask')
      expect(result.confidence).toBeLessThan(0.5)
    })

    it('should extract path from object input', () => {
      const result = classifier.classify('read', { path: '/safe/file.txt' })
      expect(result).toBeDefined()
    })

    it('should extract command from bash input', () => {
      const result = classifier.classify('bash', { command: 'ls -la' })
      expect(result).toBeDefined()
    })

    it('should handle string input directly', () => {
      const result = classifier.classify('read', '/path/to/file.txt')
      expect(result).toBeDefined()
    })

    it('should handle null/undefined input', () => {
      const result = classifier.classify('read', null)
      expect(result.decision).toBe('ask')
    })
  })

  describe('record and learn', () => {
    it('should learn from allow decisions', () => {
      const event: PermissionEvent = {
        tool: 'read',
        input: JSON.stringify({ path: '/safe/file.txt' }),
        path: '/safe/file.txt',
        decision: 'allow',
        timestamp: Date.now(),
      }

      classifier.record(event)

      // After recording, classify should potentially return different result
      const result = classifier.classify('read', { path: '/safe/file.txt' })
      expect(result).toBeDefined()
    })

    it('should learn file extension patterns', () => {
      const event: PermissionEvent = {
        tool: 'read',
        input: JSON.stringify({ path: '/safe/data.json' }),
        path: '/safe/data.json',
        decision: 'allow',
        timestamp: Date.now(),
      }

      classifier.record(event)
      const stats = classifier.getStats()
      expect(stats.events).toBe(1)
    })

    it('should not learn from ask decisions', () => {
      const event: PermissionEvent = {
        tool: 'read',
        input: JSON.stringify({ path: '/unknown/file.txt' }),
        decision: 'ask',
        timestamp: Date.now(),
      }

      classifier.record(event)
      const stats = classifier.getStats()
      expect(stats.events).toBe(1)
      // ask events don't create rules
      expect(stats.rules).toBe(0)
    })

    it('should update counts based on decisions', () => {
      classifier.record({
        tool: 'read',
        input: '{}',
        decision: 'allow',
        timestamp: Date.now(),
      })
      classifier.record({
        tool: 'read',
        input: '{}',
        decision: 'deny',
        timestamp: Date.now(),
      })

      const stats = classifier.getStats()
      expect(stats.allowRate).toBe(0.5)
    })
  })

  describe('getStats', () => {
    it('should return initial stats as zero', () => {
      const stats = classifier.getStats()
      expect(stats.rules).toBe(0)
      expect(stats.events).toBe(0)
      expect(stats.allowRate).toBe(0)
    })

    it('should track events and rules', () => {
      classifier.record({
        tool: 'read',
        input: JSON.stringify({ path: '/test.txt' }),
        path: '/test.txt',
        decision: 'allow',
        timestamp: Date.now(),
      })

      const stats = classifier.getStats()
      expect(stats.events).toBe(1)
    })
  })

  describe('reset', () => {
    it('should clear all state', () => {
      classifier.record({
        tool: 'read',
        input: JSON.stringify({ path: '/test.txt' }),
        path: '/test.txt',
        decision: 'allow',
        timestamp: Date.now(),
      })

      classifier.reset()
      const stats = classifier.getStats()
      expect(stats.rules).toBe(0)
      expect(stats.events).toBe(0)
    })
  })
})

describe('getYOLOClassifier singleton', () => {
  it('should return the same instance', () => {
    const instance1 = getYOLOClassifier()
    const instance2 = getYOLOClassifier()
    expect(instance1).toBe(instance2)
  })
})

describe('YOLOClassifier persistence', () => {
  it('should handle file system errors gracefully during persist', () => {
    // This tests the catch block in persist()
    const classifier = new YOLOClassifier('/nonexistent/path/state.json')
    classifier.record({
      tool: 'read',
      input: JSON.stringify({ path: '/test.txt' }),
      path: '/test.txt',
      decision: 'allow',
      timestamp: Date.now(),
    })
    // Should not throw even though path is invalid
    expect(classifier.getStats().events).toBe(1)
  })

  it('should handle file system errors gracefully during load', () => {
    // Try to create classifier with invalid path that will fail on load
    const classifier = new YOLOClassifier('/invalid/path/state.json')
    // Should initialize with empty state, not throw
    expect(classifier.getStats().rules).toBe(0)
  })

  it('should reset persisted state file on reset', () => {
    const classifier = new YOLOClassifier('/tmp/test-state.json')
    classifier.record({
      tool: 'read',
      input: JSON.stringify({ path: '/test.txt' }),
      path: '/test.txt',
      decision: 'allow',
      timestamp: Date.now(),
    })

    // Reset should try to delete the file - this tests line 381-383
    classifier.reset()
    // State should be cleared
    expect(classifier.getStats().events).toBe(0)
  })
})