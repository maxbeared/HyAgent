/**
 * Permission Rule Evaluation - 来自OpenCode的扁平规则匹配
 *
 * 参考来源: opencode/packages/opencode/src/permission/evaluate.ts
 */

import type { Rule, Ruleset } from './types.js'

/**
 * Wildcard pattern matching for permission rules
 * 来自: opencode/packages/opencode/src/permission/evaluate.ts
 */
export namespace Wildcard {
  /**
   * Match a string against a wildcard pattern
   * Supports * (any characters) and ? (single character)
   */
  export function match(str: string, pattern: string): boolean {
    // Exact match
    if (pattern === '*') return true
    if (pattern === str) return true

    // Glob matching
    const regex = pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')

    return new RegExp(`^${regex}$`).test(str)
  }
}

/**
 * Evaluate permission rules for a given permission and pattern
 * 使用 findLast 获取最后一个匹配的规则（最具体的覆盖）
 *
 * 参考来源: opencode/packages/opencode/src/permission/evaluate.ts
 */
export function evaluate(
  permission: string,
  pattern: string,
  ...rulesets: Ruleset[]
): Rule {
  const rules = rulesets.flat()

  // Find last matching rule (most specific override wins)
  let match: Rule | undefined
  for (const rule of rules) {
    if (
      Wildcard.match(permission, rule.permission) &&
      Wildcard.match(pattern, rule.pattern)
    ) {
      match = rule
    }
  }

  return match ?? { action: 'ask', permission, pattern: '*' }
}

/**
 * Merge multiple rulesets into one
 * Later rulesets override earlier ones
 */
export function mergeRulesets(...rulesets: Ruleset[]): Ruleset {
  return rulesets.flat()
}
