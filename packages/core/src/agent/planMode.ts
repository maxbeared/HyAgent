/**
 * Plan Mode - 5-Phase Planning Workflow
 *
 * Inspired by OpenCode's plan.txt and Claude Code's coordinatorMode.ts
 *
 * Phase 1: Initial Understanding - Launch explore agents to investigate codebase
 * Phase 2: Design - Design implementation approach
 * Phase 3: Review - Review plans and ensure alignment
 * Phase 4: Final Plan - Write final plan to plan file
 * Phase 5: Approval - Request user approval via plan_exit
 */

import { randomUUID } from 'crypto'

// ============================================================================
// Types
// ============================================================================

export type PlanPhase =
  | 'understanding'
  | 'design'
  | 'review'
  | 'final'
  | 'approval'

export interface ExplorationResult {
  phase: 'understanding'
  agentType: string
  findings: string[]
  filesExamined: string[]
  durationMs: number
}

export interface PlanContext {
  id: string
  originalTask: string
  phase: PlanPhase
  explorations: ExplorationResult[]
  proposedPlan: string
  reviewedPlan?: string
  approvedPlan?: string
  rejectedReason?: string
  createdAt: number
  updatedAt: number
  status: 'active' | 'completed' | 'rejected'
}

// ============================================================================
// Plan Context State
// ============================================================================

let currentPlanContext: PlanContext | null = null

/**
 * Start a new plan context
 */
export function startPlanContext(task: string): PlanContext {
  currentPlanContext = {
    id: randomUUID(),
    originalTask: task,
    phase: 'understanding',
    explorations: [],
    proposedPlan: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'active',
  }
  return currentPlanContext
}

/**
 * Get current plan context
 */
export function getPlanContext(): PlanContext | null {
  return currentPlanContext
}

/**
 * Update plan context
 */
export function updatePlanContext(updates: Partial<PlanContext>): void {
  if (!currentPlanContext) return
  currentPlanContext = {
    ...currentPlanContext,
    ...updates,
    updatedAt: Date.now(),
  }
}

/**
 * Advance to next phase
 */
export function advancePhase(): PlanPhase | null {
  if (!currentPlanContext) return null

  const phaseOrder: PlanPhase[] = ['understanding', 'design', 'review', 'final', 'approval']
  const currentIndex = phaseOrder.indexOf(currentPlanContext.phase)

  if (currentIndex < phaseOrder.length - 1) {
    const nextPhase = phaseOrder[currentIndex + 1]
    currentPlanContext.phase = nextPhase
    currentPlanContext.updatedAt = Date.now()
    return nextPhase
  }

  return null
}

/**
 * Reset plan context
 */
export function resetPlanContext(): void {
  currentPlanContext = null
}

// ============================================================================
// Phase Descriptions
// ============================================================================

export const PHASE_DESCRIPTIONS: Record<PlanPhase, string> = {
  understanding: 'Initial Understanding - Investigating codebase and understanding the problem space',
  design: 'Design - Crafting implementation approach based on findings',
  review: 'Review - Evaluating the proposed plan for completeness and correctness',
  final: 'Final Plan - Writing the finalized plan to a file',
  approval: 'Approval - Waiting for user confirmation to proceed with implementation',
}

/**
 * Get instructions for current phase
 */
export function getPhaseInstructions(phase: PlanPhase): string {
  switch (phase) {
    case 'understanding':
      return `
## Phase 1: Initial Understanding

Your task is to understand the problem space thoroughly before designing a solution.

**For each exploration agent, provide a self-contained prompt that:**
1. States the specific file(s) or area to investigate
2. Includes specific file paths and line numbers when relevant
3. States what "done" looks like for this exploration
4. Never says "based on your findings" - be specific about what to find

**Exploration areas to consider:**
- Files related to the task goal
- Existing patterns and conventions in the codebase
- Dependencies and their interfaces
- Potential risks or complexities

**Output format for each exploration:**
- Files examined
- Key findings
- Relevant code snippets
- Recommendations
`

    case 'design':
      return `
## Phase 2: Design

Based on the exploration findings, design an implementation approach.

**Design requirements:**
1. Identify the specific files to modify
2. Define the implementation steps in order
3. Consider edge cases and error handling
4. Plan for testing/verification
5. Estimate complexity and risk

**Do NOT:**
- Delegate understanding to another agent
- Use vague language like "explore further" or "investigate more"
- Skip to implementation without a clear plan
`

    case 'review':
      return `
## Phase 3: Review

Review the proposed plan critically.

**Review checklist:**
- [ ] Are all files properly identified?
- [ ] Are dependencies correctly ordered?
- [ ] Are edge cases addressed?
- [ ] Is the plan achievable given the constraints?
- [ ] Are there any potential regressions?
- [ ] Is the verification plan complete?

**If plan is incomplete:**
- Identify specific gaps
- Request clarification or additional exploration

**If plan is acceptable:**
- Proceed to final plan phase
`

    case 'final':
      return `
## Phase 4: Final Plan

Write the final plan to a plan file (e.g., CLAUDE.md or plan.md).

**Plan structure:**
1. Context - Why this change is needed
2. Implementation Steps - Numbered list with specific files and actions
3. Verification - How to verify the implementation works
4. Risks - What could go wrong and mitigations

**Format requirements:**
- Be specific about file paths and line numbers
- Use clear, actionable language
- Include todo/checklist format where appropriate
`

    case 'approval':
      return `
## Phase 5: Approval

The plan is complete and ready for your review.

**To proceed with implementation:**
- Run /plan-approve or say "proceed"
- The plan will be executed step by step

**To request changes:**
- Run /plan-reject or describe what needs to change
- Provide specific feedback on what to revise

**To ask questions:**
- Run /plan-question or ask your question
- I can clarify any part of the plan
`

    default:
      return ''
  }
}

// ============================================================================
// Plan Exit Tool
// ============================================================================

export interface PlanExitResult {
  approved: boolean
  reason?: string
  modifiedPlan?: string
}

/**
 * Process plan exit decision
 */
export function processPlanExit(approved: boolean, reason?: string): PlanExitResult {
  if (!currentPlanContext) {
    return { approved: false, reason: 'No active plan context' }
  }

  if (approved) {
    currentPlanContext.status = 'completed'
    currentPlanContext.approvedPlan = currentPlanContext.proposedPlan
    return { approved: true }
  } else {
    currentPlanContext.rejectedReason = reason
    return {
      approved: false,
      reason: reason || 'Plan rejected by user',
    }
  }
}

/**
 * Check if plan is ready for approval
 */
export function isPlanReadyForApproval(): boolean {
  if (!currentPlanContext) return false

  return (
    currentPlanContext.phase === 'approval' &&
    currentPlanContext.proposedPlan.length > 0 &&
    currentPlanContext.status === 'active'
  )
}

// ============================================================================
// Plan Template
// ============================================================================

export interface PlanTemplate {
  context: string
  implementationSteps: string[]
  verification: string[]
  risks: string[]
}

/**
 * Create a plan template from task description
 */
export function createPlanTemplate(task: string): PlanTemplate {
  return {
    context: `## Context\n\n${task}\n\n**Why this change is needed:**\n*TBD after analysis*\n`,
    implementationSteps: [
      '## Implementation Steps',
      '',
      '1. *Step description*',
      '   - File: *specific file path*',
      '   - Action: *specific change*',
      '',
    ],
    verification: [
      '## Verification',
      '',
      '- [ ] Build passes',
      '- [ ] Tests pass',
      '- [ ] Manual testing completed',
      '',
    ],
    risks: [
      '## Risks & Mitigations',
      '',
      '- *Risk*: *description*',
      '  - *Mitigation*: *how to avoid/reduce*',
      '',
    ],
  }
}

/**
 * Format plan template as markdown
 */
export function formatPlanAsMarkdown(template: PlanTemplate): string {
  const lines: string[] = []

  lines.push(template.context)
  lines.push('')
  lines.push(...template.implementationSteps)
  lines.push(...template.verification)
  lines.push(...template.risks)

  return lines.join('\n')
}

// ============================================================================
// Serialization
// ============================================================================

export interface SerializedPlanContext {
  id: string
  originalTask: string
  phase: PlanPhase
  explorations: ExplorationResult[]
  proposedPlan: string
  reviewedPlan?: string
  approvedPlan?: string
  rejectedReason?: string
  createdAt: number
  updatedAt: number
  status: PlanContext['status']
}

export function serializePlanContext(ctx: PlanContext): SerializedPlanContext {
  return { ...ctx }
}

export function deserializePlanContext(data: SerializedPlanContext): PlanContext {
  return { ...data }
}
