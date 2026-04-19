/**
 * Remote Session Bridge Types
 *
 * WebSocket 远程会话桥接，允许远程客户端连接到 agent 会话。
 *
 * 参考来源:
 * - Anthropic-Leaked-Source-Code/bridge/
 */

import { WebSocket } from 'ws'

// ============================================================================
// Bridge Types
// ============================================================================

/**
 * Bridge message types
 */
export type BridgeMessageType =
  | 'session_list'
  | 'session_create'
  | 'session_join'
  | 'session_leave'
  | 'input'
  | 'output'
  | 'event'
  | 'error'
  | 'ping'
  | 'pong'

/**
 * Bridge message
 */
export interface BridgeMessage {
  type: BridgeMessageType
  payload?: unknown
  id?: string
  timestamp?: number
}

/**
 * Session info for bridge
 */
export interface BridgeSessionInfo {
  id: string
  sessionId: string
  clientId: string
  joinedAt: number
}

/**
 * Bridge client state
 */
export interface BridgeClient {
  id: string
  ws: WebSocket
  sessions: Set<string>     // Session IDs this client is subscribed to
  joinedAt: number
}

// ============================================================================
// Bridge Configuration
// ============================================================================

/**
 * Bridge configuration
 */
export interface BridgeConfig {
  port: number
  host?: string
  authToken?: string       // Optional auth token
}

// ============================================================================
// Bridge Events
// ============================================================================

/**
 * Bridge event types
 */
export type BridgeEventType =
  | 'client_connected'
  | 'client_disconnected'
  | 'session_subscribed'
  | 'session_unsubscribed'
  | 'message_received'
  | 'error'

/**
 * Bridge event
 */
export interface BridgeEvent {
  type: BridgeEventType
  clientId?: string
  sessionId?: string
  data?: unknown
  error?: Error
}

/**
 * Bridge event handler
 */
export type BridgeEventHandler = (event: BridgeEvent) => void
