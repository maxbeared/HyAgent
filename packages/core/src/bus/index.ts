/**
 * Bus Event System
 *
 * 简单的 PubSub 事件系统，用于模块间松耦合通信。
 *
 * 参考来源:
 * - opencode/packages/opencode/src/bus/
 */

import type { EventDefinition, EventHandler, EventData } from './types.js'

// ============================================================================
// Bus Implementation
// ============================================================================

/**
 * Event subscription
 */
interface Subscription {
  handler: EventHandler<unknown>
  once: boolean
}

/**
 * Bus - PubSub event system
 */
export class Bus {
  private listeners: Map<string, Set<Subscription>> = new Map()
  private globalHandlers: Set<EventHandler<{ type: string; data: unknown }>> = new Set()

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

    // Return unsubscribe function
    return () => {
      this.unsubscribe(event, handler)
    }
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
   * Publish an event
   */
  publish<T>(
    event: EventDefinition<T>,
    data: T
  ): void {
    const name = event.name
    const listeners = this.listeners.get(name)

    // Call handlers
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

      // Remove once handlers
      for (const sub of toRemove) {
        listeners.delete(sub)
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
    return listeners !== undefined && listeners.size > 0
  }

  /**
   * Get number of subscribers for an event
   */
  subscriberCount(event: EventDefinition): number {
    const listeners = this.listeners.get(event.name)
    return listeners?.size ?? 0
  }

  /**
   * Clear all subscribers
   */
  clear(): void {
    this.listeners.clear()
    this.globalHandlers.clear()
  }

  /**
   * Get all event names with subscribers
   */
  getSubscribedEvents(): string[] {
    return Array.from(this.listeners.keys())
  }
}

// ============================================================================
// Singleton
// ============================================================================

let busInstance: Bus | null = null

/**
 * Get the global Bus singleton
 */
export function getBus(): Bus {
  if (!busInstance) {
    busInstance = new Bus()
  }
  return busInstance
}

// ============================================================================
// Convenience Methods
// ============================================================================

/**
 * Publish an event to the global bus
 */
export function publish<T>(
  event: EventDefinition<T>,
  data: T
): void {
  getBus().publish(event, data)
}

/**
 * Subscribe to an event on the global bus
 */
export function subscribe<T>(
  event: EventDefinition<T>,
  handler: EventHandler<T>,
  once?: boolean
): () => void {
  return getBus().subscribe(event, handler, once)
}

/**
 * Subscribe once to an event on the global bus
 */
export function subscribeOnce<T>(
  event: EventDefinition<T>,
  handler: EventHandler<T>
): () => void {
  return getBus().subscribeOnce(event, handler)
}

/**
 * Unsubscribe from an event on the global bus
 */
export function unsubscribe<T>(
  event: EventDefinition<T>,
  handler: EventHandler<T>
): void {
  getBus().unsubscribe(event, handler)
}

// ============================================================================
// Exports
// ============================================================================

export type { EventDefinition, EventHandler, EventData } from './types.js'
export {
  defineEvent,
  SessionEvents,
  AgentEvents,
  MCPEvents,
  PluginEvents,
  Events,
} from './types.js'
