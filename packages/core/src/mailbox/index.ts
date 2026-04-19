/**
 * Mailbox System
 *
 * React context message queue with provider pattern for agent notifications.
 *
 * Reference: Anthropic-Leaked-Source-Code/mailbox/
 */

import { z } from 'zod'
import { randomUUID } from 'crypto'

// ============================================================================
// Message Types
// ============================================================================

export const MailboxMessageSchema = z.object({
  id: z.string().describe('Unique message ID'),
  type: z.enum(['notification', 'request', 'response', 'event', 'command']).describe('Message type'),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal').describe('Message priority'),
  category: z.string().optional().describe('Message category'),
  title: z.string().optional().describe('Message title'),
  content: z.string().describe('Message content'),
  from: z.string().optional().describe('Sender ID'),
  to: z.string().optional().describe('Recipient ID'),
  timestamp: z.number().describe('Unix timestamp'),
  expiresAt: z.number().optional().describe('Expiration timestamp'),
  metadata: z.record(z.unknown()).optional().describe('Additional metadata'),
  collapsed: z.boolean().default(false).describe('Whether notification is collapsed'),
  read: z.boolean().default(false).describe('Whether message has been read'),
})

export type MailboxMessage = z.infer<typeof MailboxMessageSchema>

// ============================================================================
// Mailbox Config
// ============================================================================

export const MailboxConfigSchema = z.object({
  maxSize: z.number().default(100).describe('Maximum messages in mailbox'),
  maxAge: z.number().optional().describe('Message max age in ms'),
  collapseSimilar: z.boolean().default(true).describe('Collapse similar notifications'),
  collapseWindow: z.number().default(5000).describe('Window for collapsing similar messages (ms)'),
  autoDismiss: z.boolean().default(false).describe('Auto-dismiss after view'),
  dismissDelay: z.number().default(3000).describe('Auto-dismiss delay (ms)'),
})

export type MailboxConfig = z.infer<typeof MailboxConfigSchema>

// ============================================================================
// Mailbox Entry
// ============================================================================

export interface MailboxEntry {
  id: string
  address: string  // agent ID or 'global'
  messages: MailboxMessage[]
  unreadCount: number
  lastActivity: number
}

// ============================================================================
// Mailbox Manager
// ============================================================================

export class MailboxManager {
  private mailboxes: Map<string, MailboxEntry> = new Map()
  private listeners: Map<string, Set<(entry: MailboxEntry) => void>> = new Map()
  private config: MailboxConfig

  constructor(config: Partial<MailboxConfig> = {}) {
    this.config = {
      maxSize: 100,
      maxAge: undefined,
      collapseSimilar: true,
      collapseWindow: 5000,
      autoDismiss: false,
      dismissDelay: 3000,
      ...config,
    }

    // Create global mailbox
    this.getOrCreateMailbox('global')
  }

  /**
   * Get or create mailbox for address
   */
  getOrCreateMailbox(address: string): MailboxEntry {
    let entry = this.mailboxes.get(address)
    if (!entry) {
      entry = {
        id: address,
        address,
        messages: [],
        unreadCount: 0,
        lastActivity: Date.now(),
      }
      this.mailboxes.set(address, entry)
    }
    return entry
  }

  /**
   * Get mailbox for address
   */
  getMailbox(address: string): MailboxEntry | undefined {
    return this.mailboxes.get(address)
  }

  /**
   * List all mailboxes
   */
  listMailboxes(): MailboxEntry[] {
    return Array.from(this.mailboxes.values())
  }

  /**
   * Subscribe to mailbox changes
   */
  subscribe(address: string, handler: (entry: MailboxEntry) => void): () => void {
    if (!this.listeners.has(address)) {
      this.listeners.set(address, new Set())
    }
    this.listeners.get(address)!.add(handler)

    return () => {
      this.listeners.get(address)?.delete(handler)
    }
  }

  /**
   * Notify listeners
   */
  private notify(address: string): void {
    const entry = this.mailboxes.get(address)
    if (!entry) return

    const handlers = this.listeners.get(address)
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(entry)
        } catch (e) {
          console.error('[Mailbox] Handler error:', e)
        }
      }
    }

    // Also notify global listeners
    if (address !== 'global') {
      const globalHandlers = this.listeners.get('global')
      if (globalHandlers) {
        for (const handler of globalHandlers) {
          try {
            handler(entry)
          } catch (e) {
            console.error('[Mailbox] Global handler error:', e)
          }
        }
      }
    }
  }

  /**
   * Post message to mailbox
   */
  post(address: string, message: Omit<MailboxMessage, 'id' | 'timestamp'>): MailboxMessage {
    const entry = this.getOrCreateMailbox(address)

    // Check for collapsible similar message
    if (this.config.collapseSimilar && message.type === 'notification') {
      const similar = entry.messages.find(
        (m) =>
          m.type === 'notification' &&
          m.category === message.category &&
          !m.collapsed &&
          Date.now() - m.timestamp < this.config.collapseWindow
      )

      if (similar) {
        // Update existing message
        similar.content = message.content
        similar.timestamp = Date.now()
        similar.metadata = message.metadata

        entry.lastActivity = Date.now()
        this.notify(address)
        return similar
      }
    }

    // Create new message
    const fullMessage: MailboxMessage = {
      ...message,
      id: randomUUID(),
      timestamp: Date.now(),
    }

    // Add to mailbox
    entry.messages.push(fullMessage)

    // Enforce max size
    while (entry.messages.length > this.config.maxSize) {
      const removed = entry.messages.shift()
      if (removed && !removed.read) {
        entry.unreadCount--
      }
    }

    // Enforce max age
    if (this.config.maxAge) {
      const cutoff = Date.now() - this.config.maxAge
      entry.messages = entry.messages.filter((m) => m.timestamp > cutoff || m.expiresAt && m.expiresAt > Date.now())
    }

    // Update unread count
    if (!fullMessage.read) {
      entry.unreadCount++
    }

    entry.lastActivity = Date.now()
    this.notify(address)

    return fullMessage
  }

  /**
   * Post notification
   */
  postNotification(address: string, notification: Omit<MailboxMessage, 'id' | 'timestamp' | 'type'>): MailboxMessage {
    return this.post(address, { ...notification, type: 'notification' })
  }

  /**
   * Post event
   */
  event(address: string, event: Omit<MailboxMessage, 'id' | 'timestamp' | 'type'>): MailboxMessage {
    return this.post(address, { ...event, type: 'event' })
  }

  /**
   * Get message by ID
   */
  getMessage(address: string, messageId: string): MailboxMessage | undefined {
    const entry = this.mailboxes.get(address)
    return entry?.messages.find((m) => m.id === messageId)
  }

  /**
   * Mark message as read
   */
  markRead(address: string, messageId: string): void {
    const entry = this.mailboxes.get(address)
    if (!entry) return

    const message = entry.messages.find((m) => m.id === messageId)
    if (message && !message.read) {
      message.read = true
      entry.unreadCount = Math.max(0, entry.unreadCount - 1)
      this.notify(address)
    }
  }

  /**
   * Mark all messages as read
   */
  markAllRead(address: string): void {
    const entry = this.mailboxes.get(address)
    if (!entry) return

    for (const message of entry.messages) {
      message.read = true
    }
    entry.unreadCount = 0
    this.notify(address)
  }

  /**
   * Collapse notification
   */
  collapse(address: string, messageId: string): void {
    const entry = this.mailboxes.get(address)
    if (!entry) return

    const message = entry.messages.find((m) => m.id === messageId)
    if (message) {
      message.collapsed = true
      this.notify(address)
    }
  }

  /**
   * Delete message
   */
  delete(address: string, messageId: string): void {
    const entry = this.mailboxes.get(address)
    if (!entry) return

    const index = entry.messages.findIndex((m) => m.id === messageId)
    if (index >= 0) {
      const removed = entry.messages.splice(index, 1)[0]
      if (removed && !removed.read) {
        entry.unreadCount = Math.max(0, entry.unreadCount - 1)
      }
      this.notify(address)
    }
  }

  /**
   * Clear mailbox
   */
  clear(address: string): void {
    const entry = this.mailboxes.get(address)
    if (!entry) return

    entry.messages = []
    entry.unreadCount = 0
    entry.lastActivity = Date.now()
    this.notify(address)
  }

  /**
   * Get unread count
   */
  getUnreadCount(address?: string): number {
    if (address) {
      const entry = this.mailboxes.get(address)
      return entry?.unreadCount || 0
    }

    // Sum all mailboxes
    let total = 0
    for (const entry of this.mailboxes.values()) {
      total += entry.unreadCount
    }
    return total
  }

  /**
   * Get messages by type
   */
  getMessagesByType(address: string, type: MailboxMessage['type']): MailboxMessage[] {
    const entry = this.mailboxes.get(address)
    return entry?.messages.filter((m) => m.type === type) || []
  }

  /**
   * Get unread messages
   */
  getUnread(address: string): MailboxMessage[] {
    const entry = this.mailboxes.get(address)
    return entry?.messages.filter((m) => !m.read) || []
  }
}

// ============================================================================
// Provider Mode
// ============================================================================

export interface MailboxContextValue {
  manager: MailboxManager
  currentAddress: string
  setCurrentAddress: (address: string) => void
  entry: MailboxEntry | undefined
  messages: MailboxMessage[]
  unreadCount: number
  post: (message: Omit<MailboxMessage, 'id' | 'timestamp'>) => MailboxMessage
  notify: (notification: Omit<MailboxMessage, 'id' | 'timestamp' | 'type'>) => MailboxMessage
  markRead: (messageId: string) => void
  markAllRead: () => void
  delete: (messageId: string) => void
  clear: () => void
  collapse: (messageId: string) => void
}

// ============================================================================
// Singleton
// ============================================================================

let mailboxManagerInstance: MailboxManager | null = null

export function getMailboxManager(config?: Partial<MailboxConfig>): MailboxManager {
  if (!mailboxManagerInstance) {
    mailboxManagerInstance = new MailboxManager(config)
  }
  return mailboxManagerInstance
}

// ============================================================================
// React Hook (for compatibility)
// ============================================================================

/**
 * Hook to use mailbox in React components
 * This is a stub that can be implemented with actual React context
 */
export function useMailbox(address: string = 'global') {
  const manager = getMailboxManager()
  const entry = manager.getMailbox(address)

  return {
    manager,
    entry,
    messages: entry?.messages || [],
    unreadCount: entry?.unreadCount || 0,

    post: (message: Omit<MailboxMessage, 'id' | 'timestamp'>) => manager.post(address, message),

    notify: (notification: Omit<MailboxMessage, 'id' | 'timestamp' | 'type'>) =>
      manager.post(address, { ...notification, type: 'notification' }),

    markRead: (messageId: string) => manager.markRead(address, messageId),
    markAllRead: () => manager.markAllRead(address),
    delete: (messageId: string) => manager.delete(address, messageId),
    clear: () => manager.clear(address),
    collapse: (messageId: string) => manager.collapse(address, messageId),

    subscribe: (handler: (entry: MailboxEntry) => void) => manager.subscribe(address, handler),
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

export function postMessage(address: string, message: Omit<MailboxMessage, 'id' | 'timestamp'>): MailboxMessage {
  return getMailboxManager().post(address, message)
}

export function postNotification(address: string, notification: Omit<MailboxMessage, 'id' | 'timestamp' | 'type'>): MailboxMessage {
  return getMailboxManager().post(address, { ...notification, type: 'notification' })
}

export function getUnreadCount(address?: string): number {
  return getMailboxManager().getUnreadCount(address)
}
