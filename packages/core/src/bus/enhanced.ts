/**
 * Enhanced Bus Event System
 *
 * 通配符订阅，全局 Bus，实例释放事件。
 *
 * Reference: opencode/packages/opencode/src/bus/
 */

import type { EventDefinition, EventHandler, EventData } from './types.js'

// ============================================================================
// Subscription
// ============================================================================

interface Subscription {
  handler: EventHandler<unknown>
  once: boolean
  pattern?: string  // For wildcard subscriptions
}

// ============================================================================
// Enhanced Bus
// ============================================================================

export class EnhancedBus {
  private listeners: Map<string, Set<Subscription>> = new Map()
  private globalHandlers: Set<EventHandler<{ type: string; data: unknown }>> = new Set()
  private instanceRegistry: Map<string, unknown> = new Map()
  private wildcardPatterns: Map<string, Set<string>> = new Map()  // pattern -> event names

  /**
   * Subscribe to an event
   */
  subscribe<T>(
    event: EventDefinition<T>,
    handler: EventHandler<T>,
    once: boolean = false
  ): () => void {
    const name = event.name

    if (!this.listeners.has(name)) {
      this.listeners.set(name, new Set())
    }

    const subscription: Subscription = {
      handler: handler as EventHandler<unknown>,
      once,
    }

    this.listeners.get(name)!.add(subscription)

    return () => {
      this.unsubscribe(event, handler)
    }
  }

  /**
   * Subscribe to an event pattern with wildcard
   * Supports patterns like "agent:*" or "session:*" or "*"
   */
  subscribeWildcard<T>(
    pattern: string,
    handler: EventHandler<T>,
    once: boolean = false
  ): () => void {
    // Normalize pattern
    const normalizedPattern = pattern.replace(/\*\*/g, '*')

    // Track wildcard pattern
    if (!this.wildcardPatterns.has(normalizedPattern)) {
      this.wildcardPatterns.set(normalizedPattern, new Set())
    }

    // Find matching existing events and add handler
    for (const [eventName] of this.listeners) {
      if (this.matchesPattern(eventName, normalizedPattern)) {
        this.wildcardPatterns.get(normalizedPattern)!.add(eventName)
      }
    }

    // Register handler for the pattern itself (will be called on future matches)
    const subscription: Subscription = {
      handler: handler as EventHandler<unknown>,
      once,
      pattern: normalizedPattern,
    }

    const patternKey = `wildcard:${normalizedPattern}`
    if (!this.listeners.has(patternKey)) {
      this.listeners.set(patternKey, new Set())
    }
    this.listeners.get(patternKey)!.add(subscription)

    return () => {
      this.unsubscribeWildcard(pattern, handler)
    }
  }

  /**
   * Check if event name matches pattern
   */
  private matchesPattern(eventName: string, pattern: string): boolean {
    if (pattern === '*') return true
    if (pattern === eventName) return true

    // Handle single wildcard at end
    if (pattern.endsWith('.*')) {
      const prefix = pattern.slice(0, -2)
      return eventName.startsWith(prefix + ':') || eventName === prefix
    }

    // Handle single wildcard at start
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(2)
      return eventName.endsWith(suffix) || eventName === suffix
    }

    return false
  }

  /**
   * Subscribe once (auto-unsubscribe after first event)
   */
  subscribeOnce<T>(
    event: EventDefinition<T>,
    handler: EventHandler<T>
  ): () => void {
    return this.subscribe(event, handler, true)
  }

  /**
   * Subscribe once with wildcard
   */
  subscribeOnceWildcard<T>(
    pattern: string,
    handler: EventHandler<T>
  ): () => void {
    return this.subscribeWildcard(pattern, handler, true)
  }

  /**
   * Unsubscribe from an event
   */
  unsubscribe<T>(
    event: EventDefinition<T>,
    handler: EventHandler<T>
  ): void {
    const name = event.name
    const listeners = this.listeners.get(name)

    if (!listeners) return

    for (const sub of listeners) {
      if (sub.handler === handler) {
        listeners.delete(sub)
      }
    }

    if (listeners.size === 0) {
      this.listeners.delete(name)
    }
  }

  /**
   * Unsubscribe from wildcard pattern
   */
  unsubscribeWildcard(
    pattern: string,
    handler: EventHandler<unknown>
  ): void {
    const patternKey = `wildcard:${pattern}`
    const listeners = this.listeners.get(patternKey)

    if (!listeners) return

    for (const sub of listeners) {
      if (sub.handler === handler) {
        listeners.delete(sub)
      }
    }

    if (listeners.size === 0) {
      this.listeners.delete(patternKey)
      this.wildcardPatterns.delete(pattern)
    }
  }

  /**
   * Publish an event
   */
  publish<T>(
    event: EventDefinition<T>,
    data: T
  ): void {
    const name = event.name
    const listeners = this.listeners.get(name)

    if (listeners) {
      const toRemove: Subscription[] = []

      for (const sub of listeners) {
        try {
          sub.handler(data)

          if (sub.once) {
            toRemove.push(sub)
          }
        } catch (err) {
          console.error(`[Bus] Error in handler for ${name}:`, err)
        }
      }

      for (const sub of toRemove) {
        listeners.delete(sub)
      }
    }

    // Publish to matching wildcard patterns
    for (const [pattern, patternListeners] of this.wildcardPatterns) {
      if (this.matchesPattern(name, pattern)) {
        const wildcardKey = `wildcard:${pattern}`
        const wildcardSubs = this.listeners.get(wildcardKey)

        if (wildcardSubs) {
          const toRemove: Subscription[] = []

          for (const sub of wildcardSubs) {
            try {
              sub.handler({ type: name, data })

              if (sub.once) {
                toRemove.push(sub)
              }
            } catch (err) {
              console.error(`[Bus] Error in wildcard handler for ${pattern}:`, err)
            }
          }

          for (const sub of toRemove) {
            wildcardSubs.delete(sub)
          }
        }
      }
    }

    // Call global handlers
    const globalEvent = { type: name, data }
    for (const handler of this.globalHandlers) {
      try {
        handler(globalEvent)
      } catch (err) {
        console.error(`[Bus] Error in global handler for ${name}:`, err)
      }
    }
  }

  /**
   * Subscribe to all events (global handler)
   */
  subscribeGlobal(
    handler: EventHandler<{ type: string; data: unknown }>
  ): () => void {
    this.globalHandlers.add(handler)
    return () => {
      this.globalHandlers.delete(handler)
    }
  }

  /**
   * Check if an event has subscribers
   */
  hasSubscribers(event: EventDefinition): boolean {
    const listeners = this.listeners.get(event.name)
    if (listeners && listeners.size > 0) return true

    // Check wildcard patterns
    for (const pattern of this.wildcardPatterns.keys()) {
      if (this.matchesPattern(event.name, pattern)) {
        const wildcardKey = `wildcard:${pattern}`
        const wildcardSubs = this.listeners.get(wildcardKey)
        if (wildcardSubs && wildcardSubs.size > 0) return true
      }
    }

    return false
  }

  /**
   * Get number of subscribers for an event
   */
  subscriberCount(event: EventDefinition): number {
    let count = 0

    const listeners = this.listeners.get(event.name)
    if (listeners) {
      count += listeners.size
    }

    // Add wildcard subscribers
    for (const [pattern, patternListeners] of this.wildcardPatterns) {
      if (this.matchesPattern(event.name, pattern)) {
        const wildcardKey = `wildcard:${pattern}`
        const wildcardSubs = this.listeners.get(wildcardKey)
        if (wildcardSubs) {
          count += wildcardSubs.size
        }
      }
    }

    return count
  }

  /**
   * Clear all subscribers
   */
  clear(): void {
    this.listeners.clear()
    this.globalHandlers.clear()
    this.wildcardPatterns.clear()
  }

  /**
   * Get all event names with subscribers
   */
  getSubscribedEvents(): string[] {
    const events = new Set<string>()
    for (const [key] of this.listeners) {
      if (!key.startsWith('wildcard:')) {
        events.add(key)
      }
    }
    return Array.from(events)
  }

  /**
   * Get all wildcard patterns
   */
  getWildcardPatterns(): string[] {
    return Array.from(this.wildcardPatterns.keys())
  }

  // ============================================================================
  // Instance Management
  // ============================================================================

  /**
   * Register an instance (for cleanup tracking)
   */
  registerInstance(id: string, instance: unknown): void {
    this.instanceRegistry.set(id, instance)
  }

  /**
   * Get registered instance
   */
  getInstance<T>(id: string): T | undefined {
    return this.instanceRegistry.get(id) as T | undefined
  }

  /**
   * Release instance (emit release event)
   */
  releaseInstance(id: string): void {
    this.instanceRegistry.delete(id)
    this.publish(InstanceEvents.Released, { id })
  }

  /**
   * List all registered instances
   */
  listInstances(): string[] {
    return Array.from(this.instanceRegistry.keys())
  }

  /**
   * Clear all instances
   */
  clearInstances(): void {
    const ids = Array.from(this.instanceRegistry.keys())
    this.instanceRegistry.clear()

    for (const id of ids) {
      this.publish(InstanceEvents.Released, { id })
    }
  }
}

// ============================================================================
// Instance Events
// ============================================================================

import { z } from 'zod'
import { defineEvent } from './types.js'

export const InstanceEvents = {
  Registered: defineEvent('instance:registered', z.object({
    id: z.string(),
    type: z.string().optional(),
  })),

  Released: defineEvent('instance:released', z.object({
    id: z.string(),
  })),

  Cleared: defineEvent('instance:cleared', z.object({
    count: z.number(),
  })),
} as const

// ============================================================================
// Singleton
// ============================================================================

let enhancedBusInstance: EnhancedBus | null = null

/**
 * Get the global EnhancedBus singleton
 */
export function getEnhancedBus(): EnhancedBus {
  if (!enhancedBusInstance) {
    enhancedBusInstance = new EnhancedBus()
  }
  return enhancedBusInstance
}

// ============================================================================
// Convenience Exports
// ============================================================================

export function publishEvent<T>(
  event: EventDefinition<T>,
  data: T
): void {
  getEnhancedBus().publish(event, data)
}

export function subscribeEvent<T>(
  event: EventDefinition<T>,
  handler: EventHandler<T>,
  once?: boolean
): () => void {
  return getEnhancedBus().subscribe(event, handler, once)
}

export function subscribeEventOnce<T>(
  event: EventDefinition<T>,
  handler: EventHandler<T>
): () => void {
  return getEnhancedBus().subscribeOnce(event, handler)
}

export function subscribeWildcard<T>(
  pattern: string,
  handler: EventHandler<T>,
  once?: boolean
): () => void {
  return getEnhancedBus().subscribeWildcard(pattern, handler, once)
}

export function subscribeGlobal(
  handler: EventHandler<{ type: string; data: unknown }>
): () => void {
  return getEnhancedBus().subscribeGlobal(handler)
}

export function unsubscribeEvent<T>(
  event: EventDefinition<T>,
  handler: EventHandler<T>
): void {
  getEnhancedBus().unsubscribe(event, handler)
}

export function hasEventSubscribers(event: EventDefinition): boolean {
  return getEnhancedBus().hasSubscribers(event)
}

export function getSubscriberCount(event: EventDefinition): number {
  return getEnhancedBus().subscriberCount(event)
}

export function clearAllSubscribers(): void {
  getEnhancedBus().clear()
}

export function getSubscribedEventNames(): string[] {
  return getEnhancedBus().getSubscribedEvents()
}
