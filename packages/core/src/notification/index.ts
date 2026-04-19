/**
 * Notification Queue
 *
 * Priority queue, notification folding, and timeout management.
 *
 * Reference: Anthropic-Leaked-Source-Code/notification/
 */

import { z } from 'zod'
import { randomUUID } from 'crypto'

// ============================================================================
// Notification Types
// ============================================================================

export const NotificationPrioritySchema = z.enum(['low', 'normal', 'high', 'urgent', 'critical'])
export type NotificationPriority = z.infer<typeof NotificationPrioritySchema>

export const NotificationTypeSchema = z.enum([
  'info',
  'success',
  'warning',
  'error',
  'progress',
  'approval',
  'message',
])
export type NotificationType = z.infer<typeof NotificationTypeSchema>

export const NotificationSchema = z.object({
  id: z.string().describe('Unique notification ID'),
  type: NotificationTypeSchema.describe('Notification type'),
  priority: NotificationPrioritySchema.default('normal').describe('Notification priority'),
  title: z.string().describe('Notification title'),
  message: z.string().describe('Notification message'),
  category: z.string().optional().describe('Category for folding'),
  source: z.string().optional().describe('Source of the notification'),
  timestamp: z.number().describe('Creation timestamp'),
  duration: z.number().optional().describe('Display duration in ms (0 = persistent)'),
  timeout: z.number().optional().describe('Timeout in ms'),
  metadata: z.record(z.unknown()).optional().describe('Additional data'),
  dismissed: z.boolean().default(false).describe('Whether notification was dismissed'),
  collapsed: z.boolean().default(false).describe('Whether notification is collapsed'),
  progress: z.number().optional().describe('Progress percentage (0-100)'),
})

export type Notification = z.infer<typeof NotificationSchema>

// ============================================================================
// Queue Config
// ============================================================================

export const NotificationQueueConfigSchema = z.object({
  maxSize: z.number().default(50).describe('Maximum notifications in queue'),
  maxPerCategory: z.number().default(5).describe('Max notifications per category'),
  defaultDuration: z.number().default(5000).describe('Default display duration'),
  foldWindow: z.number().default(3000).describe('Window for folding similar notifications (ms)'),
  maxQueueDisplay: z.number().default(3).describe('Max notifications to show at once'),
  stallTimeout: z.number().default(30000).describe('Timeout for stalled notifications'),
})

export type NotificationQueueConfig = z.infer<typeof NotificationQueueConfigSchema>

// ============================================================================
// Priority Queue Implementation
// ============================================================================

interface PriorityNode {
  notification: Notification
  next?: PriorityNode
}

export class NotificationQueue {
  private head?: PriorityNode
  private tail?: PriorityNode
  private size: number = 0
  private lookup: Map<string, Notification> = new Map()

  constructor(private maxSize: number = 50) {}

  /**
   * Check if queue is empty
   */
  isEmpty(): boolean {
    return this.size === 0
  }

  /**
   * Get queue size
   */
  getSize(): number {
    return this.size
  }

  /**
   * Get notification by ID
   */
  get(id: string): Notification | undefined {
    return this.lookup.get(id)
  }

  /**
   * Enqueue notification (by priority)
   */
  enqueue(notification: Notification): void {
    // Remove if already exists (for updates)
    if (this.lookup.has(notification.id)) {
      this.remove(notification.id)
    }

    // Enforce max size
    while (this.size >= this.maxSize) {
      const removed = this.dequeue()
      if (!removed) break
    }

    const node: PriorityNode = { notification }

    // Insert by priority
    const priorityOrder: Record<NotificationPriority, number> = {
      critical: 0,
      urgent: 1,
      high: 2,
      normal: 3,
      low: 4,
    }

    const newPriority = priorityOrder[notification.priority]

    if (!this.head || newPriority < priorityOrder[this.head.notification.priority]) {
      // Insert at head
      node.next = this.head
      this.head = node
      if (!this.tail) {
        this.tail = node
      }
    } else {
      // Insert in sorted position
      let current = this.head
      while (current.next && priorityOrder[current.next.notification.priority] <= newPriority) {
        current = current.next
      }
      node.next = current.next
      current.next = node
      if (!node.next) {
        this.tail = node
      }
    }

    this.size++
    this.lookup.set(notification.id, notification)
  }

  /**
   * Dequeue notification
   */
  dequeue(): Notification | undefined {
    if (!this.head) return undefined

    const node = this.head
    this.head = node.next

    if (!this.head) {
      this.tail = undefined
    }

    this.size--
    this.lookup.delete(node.notification.id)

    return node.notification
  }

  /**
   * Remove notification by ID
   */
  remove(id: string): boolean {
    if (!this.head) return false

    if (this.head.notification.id === id) {
      this.dequeue()
      return true
    }

    let current = this.head
    while (current.next) {
      if (current.next.notification.id === id) {
        current.next = current.next.next
        if (!current.next) {
          this.tail = current
        }
        this.size--
        this.lookup.delete(id)
        return true
      }
      current = current.next
    }

    return false
  }

  /**
   * Peek at head notification
   */
  peek(): Notification | undefined {
    return this.head?.notification
  }

  /**
   * Get all notifications
   */
  toArray(): Notification[] {
    const result: Notification[] = []
    let current = this.head
    while (current) {
      result.push(current.notification)
      current = current.next
    }
    return result
  }

  /**
   * Clear queue
   */
  clear(): void {
    this.head = undefined
    this.tail = undefined
    this.size = 0
    this.lookup.clear()
  }
}

// ============================================================================
// Notification Manager
// ============================================================================

export class NotificationManager {
  private queue: NotificationQueue
  private config: NotificationQueueConfig
  private timers: Map<string, NodeJS.Timeout> = new Map()
  private listeners: Set<(notification: Notification) => void> = new Set()
  private categoryCounts: Map<string, number> = new Map()

  constructor(config: Partial<NotificationQueueConfig> = {}) {
    this.config = {
      maxSize: 50,
      maxPerCategory: 5,
      defaultDuration: 5000,
      foldWindow: 3000,
      maxQueueDisplay: 3,
      stallTimeout: 30000,
      ...config,
    }
    this.queue = new NotificationQueue(this.config.maxSize)
  }

  /**
   * Add notification
   */
  add(notification: Omit<Notification, 'id' | 'timestamp'>): Notification {
    const full: Notification = {
      ...notification,
      id: randomUUID(),
      timestamp: Date.now(),
    }

    // Check for foldable similar notification
    if (full.category) {
      const folded = this.foldNotification(full)
      if (folded) {
        this.updateTimer(folded.id)
        return folded
      }
    }

    // Enforce per-category max
    if (full.category) {
      const count = this.categoryCounts.get(full.category) || 0
      if (count >= this.config.maxPerCategory) {
        // Remove oldest of this category
        this.removeOldestOfCategory(full.category)
      }
      this.categoryCounts.set(full.category, count + 1)
    }

    this.queue.enqueue(full)
    this.emit(full)
    this.setTimer(full)

    return full
  }

  /**
   * Try to fold notification with similar recent one
   */
  private foldNotification(notification: Notification): Notification | undefined {
    const cutoff = Date.now() - this.config.foldWindow

    for (const n of this.queue.toArray()) {
      if (
        n.category === notification.category &&
        n.type === notification.type &&
        n.timestamp > cutoff &&
        !n.collapsed
      ) {
        // Update existing notification
        n.message = notification.message
        n.timestamp = Date.now()
        if (notification.progress !== undefined) {
          n.progress = notification.progress
        }
        n.metadata = { ...n.metadata, ...notification.metadata }

        // Remove new notification since it was folded
        this.queue.remove(notification.id)
        this.emit(n)
        return n
      }
    }

    return undefined
  }

  /**
   * Remove oldest notification of category
   */
  private removeOldestOfCategory(category: string): void {
    const cutoff = Date.now() - this.config.foldWindow
    let oldest: Notification | undefined

    for (const n of this.queue.toArray()) {
      if (n.category === category && (!oldest || n.timestamp < oldest.timestamp)) {
        oldest = n
      }
    }

    if (oldest) {
      this.dismiss(oldest.id)
    }
  }

  /**
   * Set display timer
   */
  private setTimer(notification: Notification): void {
    if (notification.duration === 0) return // Persistent

    const duration = notification.duration || this.config.defaultDuration
    const timer = setTimeout(() => {
      this.dismiss(notification.id)
    }, duration)

    this.timers.set(notification.id, timer)
  }

  /**
   * Update timer (for progress updates)
   */
  private updateTimer(id: string): void {
    const existing = this.timers.get(id)
    if (existing) {
      clearTimeout(existing)
    }

    const notification = this.queue.get(id)
    if (notification) {
      this.setTimer(notification)
    }
  }

  /**
   * Dismiss notification
   */
  dismiss(id: string): boolean {
    const timer = this.timers.get(id)
    if (timer) {
      clearTimeout(timer)
      this.timers.delete(id)
    }

    const notification = this.queue.get(id)
    if (notification?.category) {
      const count = this.categoryCounts.get(notification.category) || 1
      this.categoryCounts.set(notification.category, Math.max(0, count - 1))
    }

    return this.queue.remove(id)
  }

  /**
   * Collapse notification
   */
  collapse(id: string): void {
    const notification = this.queue.get(id)
    if (notification) {
      notification.collapsed = true
    }
  }

  /**
   * Expand notification
   */
  expand(id: string): void {
    const notification = this.queue.get(id)
    if (notification) {
      notification.collapsed = false
    }
  }

  /**
   * Update progress
   */
  updateProgress(id: string, progress: number): void {
    const notification = this.queue.get(id)
    if (notification) {
      notification.progress = Math.min(100, Math.max(0, progress))
      if (progress >= 100) {
        this.dismiss(id)
      } else {
        this.updateTimer(id)
        this.emit(notification)
      }
    }
  }

  /**
   * Subscribe to notifications
   */
  subscribe(handler: (notification: Notification) => void): () => void {
    this.listeners.add(handler)
    return () => {
      this.listeners.delete(handler)
    }
  }

  /**
   * Emit notification to listeners
   */
  private emit(notification: Notification): void {
    for (const handler of this.listeners) {
      try {
        handler(notification)
      } catch (e) {
        console.error('[Notification] Handler error:', e)
      }
    }
  }

  /**
   * Get visible notifications (top N by priority)
   */
  getVisible(): Notification[] {
    return this.queue.toArray().slice(0, this.config.maxQueueDisplay)
  }

  /**
   * Get notification by ID
   */
  get(id: string): Notification | undefined {
    return this.queue.get(id)
  }

  /**
   * Get all notifications
   */
  getAll(): Notification[] {
    return this.queue.toArray()
  }

  /**
   * Get unread count
   */
  getCount(): number {
    return this.queue.getSize()
  }

  /**
   * Clear all notifications
   */
  clear(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer)
    }
    this.timers.clear()
    this.categoryCounts.clear()
    this.queue.clear()
  }

  /**
   * Get notifications by type
   */
  getByType(type: NotificationType): Notification[] {
    return this.queue.toArray().filter((n) => n.type === type)
  }

  /**
   * Get notifications by category
   */
  getByCategory(category: string): Notification[] {
    return this.queue.toArray().filter((n) => n.category === category)
  }

  /**
   * Get urgent+ notifications
   */
  getUrgent(): Notification[] {
    return this.queue.toArray().filter(
      (n) => n.priority === 'urgent' || n.priority === 'critical'
    )
  }
}

// ============================================================================
// Singleton
// ============================================================================

let notificationManagerInstance: NotificationManager | null = null

export function getNotificationManager(config?: Partial<NotificationQueueConfig>): NotificationManager {
  if (!notificationManagerInstance) {
    notificationManagerInstance = new NotificationManager(config)
  }
  return notificationManagerInstance
}

// ============================================================================
// Convenience Functions
// ============================================================================

export function notify(options: {
  type: NotificationType
  title: string
  message: string
  priority?: NotificationPriority
  category?: string
  duration?: number
}): Notification {
  return getNotificationManager().add(options)
}

export function notifySuccess(title: string, message: string): Notification {
  return notify({ type: 'success', title, message })
}

export function notifyError(title: string, message: string): Notification {
  return notify({ type: 'error', title, message, priority: 'high' })
}

export function notifyWarning(title: string, message: string): Notification {
  return notify({ type: 'warning', title, message })
}

export function notifyProgress(id: string, progress: number, message?: string): void {
  const manager = getNotificationManager()
  const existing = manager.get(id)

  if (existing) {
    manager.updateProgress(id, progress)
    if (message) {
      const notification = manager.get(id)
      if (notification) {
        notification.message = message
      }
    }
  } else if (progress < 100) {
    manager.add({
      type: 'progress',
      title: 'Progress',
      message: message || `${progress}%`,
      priority: 'normal',
      duration: 0,
      progress,
    })
  }
}

export function dismissNotification(id: string): boolean {
  return getNotificationManager().dismiss(id)
}

export function clearNotifications(): void {
  getNotificationManager().clear()
}
