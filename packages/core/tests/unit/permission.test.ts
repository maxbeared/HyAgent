import { describe, it, expect, beforeEach } from 'vitest'
import { Wildcard, evaluate, mergeRulesets } from '../../src/permission/evaluate.js'
import type { Rule, Ruleset } from '../../src/permission/types.js'

describe('Wildcard matching', () => {
  describe('exact match', () => {
    it('should match exact strings', () => {
      expect(Wildcard.match('read', 'read')).toBe(true)
      expect(Wildcard.match('edit', 'edit')).toBe(true)
    })

    it('should not match different strings', () => {
      expect(Wildcard.match('read', 'write')).toBe(false)
      expect(Wildcard.match('edit', 'read')).toBe(false)
    })
  })

  describe('asterisk wildcard', () => {
    it('should match any string with *', () => {
      expect(Wildcard.match('anything', '*')).toBe(true)
      expect(Wildcard.match('read', '*')).toBe(true)
    })

    it('should match prefixes with pattern*', () => {
      expect(Wildcard.match('readFile', 'read*')).toBe(true)
      expect(Wildcard.match('readme.txt', 'read*')).toBe(true)
    })

    it('should match suffixes with *pattern', () => {
      expect(Wildcard.match('fileread', '*read')).toBe(true)
      expect(Wildcard.match('test.txt', '*.txt')).toBe(true)
    })

    it('should match middle patterns with *pattern*', () => {
      expect(Wildcard.match('file.read.txt', '*.txt')).toBe(true)
    })
  })

  describe('question mark wildcard', () => {
    it('should match single character with ?', () => {
      expect(Wildcard.match('read', 'r?ad')).toBe(true)
      expect(Wildcard.match('read', '??ad')).toBe(true)
    })

    it('should not match multiple characters with ?', () => {
      expect(Wildcard.match('read', 'r?')).toBe(false)
    })
  })

  describe('escaped characters', () => {
    it('should escape dots', () => {
      expect(Wildcard.match('file.txt', 'file.txt')).toBe(true)
      expect(Wildcard.match('fileAtxt', 'file.txt')).toBe(false)
    })
  })
})

describe('evaluate', () => {
  const rules: Ruleset = [
    { permission: 'read', pattern: '*.txt', action: 'allow' },
    { permission: 'read', pattern: '/safe/*', action: 'allow' },
    { permission: 'edit', pattern: '*', action: 'ask' },
    { permission: 'bash', pattern: 'rm *', action: 'deny' },
  ]

  it('should return allow for matching read txt pattern', () => {
    const result = evaluate('read', 'file.txt', rules)
    expect(result.action).toBe('allow')
  })

  it('should return allow for matching safe path', () => {
    const result = evaluate('read', '/safe/file.txt', rules)
    expect(result.action).toBe('allow')
  })

  it('should return ask for edit pattern', () => {
    const result = evaluate('edit', 'anyfile.txt', rules)
    expect(result.action).toBe('ask')
  })

  it('should return deny for dangerous bash command', () => {
    const result = evaluate('bash', 'rm -rf /', rules)
    expect(result.action).toBe('deny')
  })

  it('should return ask as default when no rules match', () => {
    const result = evaluate('unknown', 'file.txt', rules)
    expect(result.action).toBe('ask')
  })

  it('should use last matching rule when multiple rules match', () => {
    const overlappingRules: Ruleset = [
      { permission: 'read', pattern: '*', action: 'deny' },
      { permission: 'read', pattern: '*.txt', action: 'allow' },
    ]
    const result = evaluate('read', 'file.txt', overlappingRules)
    expect(result.action).toBe('allow')
  })
})

describe('mergeRulesets', () => {
  it('should merge multiple rulesets', () => {
    const ruleset1: Ruleset = [
      { permission: 'read', pattern: '*.txt', action: 'allow' },
    ]
    const ruleset2: Ruleset = [
      { permission: 'edit', pattern: '*', action: 'ask' },
    ]

    const merged = mergeRulesets(ruleset1, ruleset2)
    expect(merged).toHaveLength(2)
    expect(merged[0].action).toBe('allow')
    expect(merged[1].action).toBe('ask')
  })

  it('should flatten nested rulesets', () => {
    const ruleset1: Ruleset = [{ permission: 'read', pattern: '*', action: 'allow' }]
    const ruleset2: Ruleset = [{ permission: 'edit', pattern: '*', action: 'deny' }]
    const ruleset3: Ruleset = [{ permission: 'bash', pattern: '*', action: 'ask' }]

    const merged = mergeRulesets(ruleset1, ruleset2, ruleset3)
    expect(merged).toHaveLength(3)
  })
})