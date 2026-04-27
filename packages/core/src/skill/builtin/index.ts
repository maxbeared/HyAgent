/**
 * Built-in Skills
 *
 * These skills ship with the agent and are registered at startup.
 * Based on Claude Code's bundled skills pattern.
 */

import type { Skill } from '../types.js'

// ============================================================================
// Built-in Skill Definitions
// ============================================================================

/**
 * Verify skill - helps verify code changes work correctly
 */
export const verifySkillContent = `
# Verify Skill

Help the user verify that their code changes work correctly.

## Guidelines

1. **Understand the change** - Read the modified files to understand what was changed
2. **Run tests** - Execute the project's test suite if available
3. **Test manually** - If appropriate, run the application to verify behavior
4. **Check for regressions** - Look for any side effects or broken functionality

## Questions to Consider

- Does the change accomplish the intended goal?
- Are there any obvious bugs or edge cases?
- Is the code readable and maintainable?
- Are there appropriate error handlers?
- Do tests cover the new functionality?

## Output

Provide a clear summary of:
- What was tested
- Test results (pass/fail)
- Any issues found
- Recommendations for fixes if needed
`

/**
 * Debug skill - helps diagnose and fix issues
 */
export const debugSkillContent = `
# Debug Skill

Help the user debug issues in their code or environment.

## Guidelines

1. **Gather information** - Ask for error messages, logs, and reproduction steps
2. **Reproduce the issue** - Try to recreate the problem locally
3. **Identify root cause** - Trace the issue to its source
4. **Propose fixes** - Suggest concrete solutions

## Debugging Techniques

- **Read error messages carefully** - Stack traces contain valuable information
- **Check recent changes** - Look at git history for clues
- **Simplify the problem** - Create minimal reproductions
- **Use logging** - Add console.log or debug statements
- **Check dependencies** - Verify packages are installed correctly

## Common Issues

- Type errors - Check TypeScript configuration and type annotations
- Import errors - Verify file paths and exports
- Runtime errors - Look at stack traces and line numbers
- Performance issues - Profile the code to find bottlenecks

## Output

Provide:
- Root cause analysis
- Specific fix recommendations
- Code examples where helpful
- Prevention tips to avoid similar issues
`

/**
 * Review skill - code review assistant
 */
export const reviewSkillContent = `
# Review Skill

Perform a thorough code review of the changes.

## Guidelines

1. **Understand context** - What is the purpose of this change?
2. **Check correctness** - Does the code do what it claims?
3. **Evaluate style** - Does it follow project conventions?
4. **Consider edge cases** - What about boundary conditions?
5. **Assess security** - Any security implications?

## Review Checklist

### Correctness
- [ ] Does the code work as intended?
- [ ] Are there off-by-one errors?
- [ ] Are edge cases handled?

### Design
- [ ] Is the code appropriately structured?
- [ ] Are functions/classes single-purpose?
- [ ] Is there proper abstraction?

### Readability
- [ ] Are variables named clearly?
- [ ] Is there appropriate documentation?
- [ ] Is the logic easy to follow?

### Security
- [ ] Any injection vulnerabilities?
- [ ] Proper input validation?
- [ ] Sensitive data handled safely?

### Performance
- [ ] Any obvious inefficiencies?
- [ ] Unnecessary allocations?
- [ ] Appropriate algorithms?

## Output

Provide a structured review:
- **Approved** / **Changes Requested** / **Blocked**
- Summary of what was reviewed
- Specific comments with file:line references
- Blocking issues (if any)
- Non-blocking suggestions
`

/**
 * Simplify skill - simplify complex code
 */
export const simplifySkillContent = `
# Simplify Skill

Help the user simplify complex or confusing code.

## Guidelines

1. **Understand first** - Make sure you understand what the code does
2. **Identify complexity** - Find what makes it hard to understand
3. **Simplify gradually** - Make incremental improvements
4. **Preserve behavior** - Don't change functionality, only structure

## Sources of Complexity

- Deep nesting (conditionals, loops)
- Magic numbers or strings
- Overly clever one-liners
- Missing abstraction
- Inconsistent naming
- Long functions
- Complex conditionals

## Simplification Techniques

- Extract variables for complex expressions
- Early returns to reduce nesting
- Extract helper functions
- Use constants for magic values
- Break long functions into smaller ones
- Use clear, descriptive names
- Replace magic numbers with named constants

## Output

Provide:
- What was simplified
- Why it was complex before
- How it was simplified
- The refactored code
`

/**
 * Remember skill - save information for later
 */
export const rememberSkillContent = `
# Remember Skill

Remember important information for the user.

## Guidelines

1. **Acknowledge the request** - Confirm what information to remember
2. **Store the information** - Note it in a way that can be retrieved
3. **Confirm storage** - Let the user know it's been saved

## What to Remember

- User preferences
- Project-specific conventions
- Important context
- Decisions made
- Future tasks or TODOs

## Output

Confirm what was remembered in a concise format.
`

// ============================================================================
// Skill Registry
// ============================================================================

export interface BuiltinSkill {
  name: string
  description: string
  content: string
  argumentHint?: string
  allowedTools?: string[]
  disableModelInvocation?: boolean
  userInvocable?: boolean
}

export const builtinSkills: BuiltinSkill[] = [
  {
    name: 'verify',
    description: 'Verify a code change does what it should by running the app and tests',
    content: verifySkillContent,
    userInvocable: true,
  },
  {
    name: 'debug',
    description: 'Debug an issue by analyzing errors, logs, and code',
    content: debugSkillContent,
    allowedTools: ['read', 'grep', 'glob', 'bash'],
    disableModelInvocation: true,
    userInvocable: true,
  },
  {
    name: 'review',
    description: 'Perform a thorough code review of changes',
    content: reviewSkillContent,
    userInvocable: true,
  },
  {
    name: 'simplify',
    description: 'Simplify complex or confusing code',
    content: simplifySkillContent,
    userInvocable: true,
  },
  {
    name: 'remember',
    description: 'Remember important information for later',
    content: rememberSkillContent,
    disableModelInvocation: true,
    userInvocable: true,
  },
]

/**
 * Get a built-in skill by name
 */
export function getBuiltinSkill(name: string): BuiltinSkill | undefined {
  return builtinSkills.find((s) => s.name === name)
}

/**
 * Convert a builtin skill to a Skill object
 */
export function builtinToSkill(builtin: BuiltinSkill): Skill {
  return {
    name: builtin.name,
    description: builtin.description,
    content: builtin.content,
    source: 'bundled',
    location: `builtin:${builtin.name}`,
    argumentHint: builtin.argumentHint,
    allowedTools: builtin.allowedTools,
    disableModelInvocation: builtin.disableModelInvocation,
    userInvocable: builtin.userInvocable,
  }
}
