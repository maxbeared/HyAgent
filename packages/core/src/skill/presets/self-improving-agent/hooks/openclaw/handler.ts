/**
 * Self-Improvement Hook for OpenClaw
 *
 * Injects a reminder to evaluate learnings during agent bootstrap.
 * Fires on agent:bootstrap event before workspace files are injected.
 */

// @ts-ignore - openclaw/hooks package may not be available
import type { HookHandler } from 'openclaw/hooks'

const REMINDER_NAME = 'SELF_IMPROVEMENT_REMINDER.md'
const REMINDER_PATH = REMINDER_NAME

const REMINDER_CONTENT = `## Self-Improvement Reminder

After completing tasks, evaluate whether any learnings should be captured.

Only log if this repo or workspace is using the self-improvement skill.

Before logging:
- Create only missing \`.learnings/\` files; never overwrite existing content
- Do not log secrets, tokens, private keys, environment variables, or raw transcripts
- Prefer short summaries or redacted excerpts over full command output

**Log when:**
- User corrects you \`.learnings/LEARNINGS.md\`
- Command/operation fails \`.learnings/ERRORS.md\`
- User wants missing capability \`.learnings/FEATURE_REQUESTS.md\`
- You discover your knowledge was wrong \`.learnings/LEARNINGS.md\`
- You find a better approach \`.learnings/LEARNINGS.md\`

**Promote when pattern is proven:**
- Behavioral patterns \`SOUL.md\`
- Workflow improvements \`AGENTS.md\`
- Tool gotchas \`TOOLS.md\`

Keep entries simple: date, title, what happened, and what to do differently.`

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

function isInjectedReminderFile(value: unknown): boolean {
  if (!isObject(value) || (value as any).path !== REMINDER_PATH) {
    return false
  }

  return (
    (value as any).virtual === true ||
    (value as any).content === REMINDER_CONTENT
  )
}

const handler: HookHandler = async (event: any) => {
  // Safety checks for event structure
  if (!event || typeof event !== 'object') {
    return
  }

  // Only handle agent:bootstrap events
  if (event.type !== 'agent' || event.action !== 'bootstrap') {
    return
  }

  // Safety check for context
  if (!event.context || typeof event.context !== 'object') {
    return
  }

  // Skip sub-agent sessions to avoid bootstrap issues
  // Sub-agents have sessionKey patterns like "agent:main:subagent:..."
  const sessionKey = event.sessionKey || ''
  if (sessionKey.includes(':subagent:')) {
    return
  }

  // Inject the reminder as a virtual bootstrap file
  // Check that bootstrapFiles is an array before pushing
  if (Array.isArray((event.context as any).bootstrapFiles)) {
    const occupiedByOtherFile = (event.context as any).bootstrapFiles.some(
      (file: any) => isObject(file) && file.path === REMINDER_PATH && !isInjectedReminderFile(file),
    )
    if (occupiedByOtherFile) {
      return
    }

    const cleanedBootstrapFiles = (event.context as any).bootstrapFiles.filter(
      (file: any, index: number, files: any[]) =>
        !isInjectedReminderFile(file) ||
        files.findIndex((candidate: any) => isInjectedReminderFile(candidate)) === index,
    )

    const reminderFile = {
      name: REMINDER_NAME,
      path: REMINDER_PATH,
      content: REMINDER_CONTENT,
      missing: false,
      virtual: true,
    }

    const existingIndex = cleanedBootstrapFiles.findIndex((file: any) => isInjectedReminderFile(file))
    if (existingIndex === -1) {
      cleanedBootstrapFiles.push(reminderFile)
    } else {
      cleanedBootstrapFiles[existingIndex] = reminderFile
    }

    ;(event.context as any).bootstrapFiles = cleanedBootstrapFiles
  }
}

export default handler