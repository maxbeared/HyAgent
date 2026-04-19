/**
 * Remote Session Bridge Server
 *
 * WebSocket 远程会话桥接，允许远程客户端连接到 agent 会话。
 *
 * 参考来源:
 * - Anthropic-Leaked-Source-Code/bridge/
 */

import { WebSocketServer, WebSocket } from 'ws'
import type { BridgeConfig, BridgeMessage, BridgeClient, BridgeEvent, BridgeEventHandler, BridgeSessionInfo } from './types.js'

/**
 * Generate unique ID
 */
function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Remote Session Bridge Server
 */
export class BridgeServer {
  private wss: WebSocketServer | null = null
  private clients: Map<string, BridgeClient> = new Map()
  private sessionClients: Map<string, Set<string>> = new Map()  // sessionId -> clientIds
  private eventHandlers: Set<BridgeEventHandler> = new Set()
  private config: BridgeConfig
  private heartbeatInterval: NodeJS.Timeout | null = null

  constructor(config: BridgeConfig) {
    this.config = config
  }

  /**
   * Start the bridge server
   */
  start(): void {
    if (this.wss) return

    this.wss = new WebSocketServer({
      port: this.config.port,
      host: this.config.host,
    })

    this.wss.on('connection', (ws, req) => {
      this.handleConnection(ws, req)
    })

    // Start heartbeat
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat()
    }, 30000)

    console.log(`[Bridge] Server started on ${this.config.host ?? '0.0.0.0'}:${this.config.port}`)
  }

  /**
   * Stop the bridge server
   */
  stop(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }

    // Close all client connections
    for (const client of this.clients.values()) {
      client.ws.close()
    }
    this.clients.clear()
    this.sessionClients.clear()

    if (this.wss) {
      this.wss.close()
      this.wss = null
    }

    console.log('[Bridge] Server stopped')
  }

  /**
   * Handle new WebSocket connection
   */
  private handleConnection(ws: WebSocket, _req: any): void {
    const clientId = generateId('client')
    const client: BridgeClient = {
      id: clientId,
      ws,
      sessions: new Set(),
      joinedAt: Date.now(),
    }

    this.clients.set(clientId, client)

    // Send welcome message
    this.send(ws, { type: 'session_list', payload: { clientId } })

    // Emit event
    this.emit({ type: 'client_connected', clientId })

    // Handle messages
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString()) as BridgeMessage
        this.handleMessage(client, message)
      } catch (err) {
        this.send(ws, { type: 'error', payload: { message: 'Invalid JSON' } })
      }
    })

    // Handle close
    ws.on('close', () => {
      this.handleDisconnect(clientId)
    })

    // Handle errors
    ws.on('error', (err) => {
      console.error(`[Bridge] Client ${clientId} error:`, err)
    })

    // Handle pong (heartbeat response)
    ws.on('pong', () => {
      // Client is alive
    })
  }

  /**
   * Handle incoming message from client
   */
  private handleMessage(client: BridgeClient, message: BridgeMessage): void {
    switch (message.type) {
      case 'session_create':
        this.handleSessionCreate(client)
        break

      case 'session_join':
        this.handleSessionJoin(client, message.payload as { sessionId: string })
        break

      case 'session_leave':
        this.handleSessionLeave(client, message.payload as { sessionId: string })
        break

      case 'input':
        this.handleInput(client, message.payload as { sessionId: string; content: string })
        break

      case 'ping':
        this.send(client.ws, { type: 'pong' })
        break

      default:
        this.send(client.ws, { type: 'error', payload: { message: `Unknown message type: ${message.type}` } })
    }

    this.emit({ type: 'message_received', clientId: client.id, data: message })
  }

  /**
   * Handle client disconnect
   */
  private handleDisconnect(clientId: string): void {
    const client = this.clients.get(clientId)
    if (!client) return

    // Leave all sessions
    for (const sessionId of client.sessions) {
      this.handleSessionLeave(client, { sessionId })
    }

    this.clients.delete(clientId)
    this.emit({ type: 'client_disconnected', clientId })
  }

  /**
   * Handle session create request
   */
  private handleSessionCreate(client: BridgeClient): void {
    const sessionId = generateId('session')
    const info: BridgeSessionInfo = {
      id: generateId('bs'),
      sessionId,
      clientId: client.id,
      joinedAt: Date.now(),
    }

    // Add to session
    if (!this.sessionClients.has(sessionId)) {
      this.sessionClients.set(sessionId, new Set())
    }
    this.sessionClients.get(sessionId)!.add(client.id)
    client.sessions.add(sessionId)

    this.send(client.ws, { type: 'session_create', payload: info })
    this.emit({ type: 'session_subscribed', clientId: client.id, sessionId })
  }

  /**
   * Handle session join request
   */
  private handleSessionJoin(client: BridgeClient, payload: { sessionId: string }): void {
    const { sessionId } = payload

    // Add to session
    if (!this.sessionClients.has(sessionId)) {
      this.sessionClients.set(sessionId, new Set())
    }
    this.sessionClients.get(sessionId)!.add(client.id)
    client.sessions.add(sessionId)

    this.send(client.ws, { type: 'session_join', payload: { sessionId, success: true } })
    this.emit({ type: 'session_subscribed', clientId: client.id, sessionId })
  }

  /**
   * Handle session leave request
   */
  private handleSessionLeave(client: BridgeClient, payload: { sessionId: string }): void {
    const { sessionId } = payload

    client.sessions.delete(sessionId)
    const sessionClients = this.sessionClients.get(sessionId)
    if (sessionClients) {
      sessionClients.delete(client.id)
      if (sessionClients.size === 0) {
        this.sessionClients.delete(sessionId)
      }
    }

    this.send(client.ws, { type: 'session_leave', payload: { sessionId } })
    this.emit({ type: 'session_unsubscribed', clientId: client.id, sessionId })
  }

  /**
   * Handle input message (forwarded to session)
   */
  private handleInput(client: BridgeClient, payload: { sessionId: string; content: string }): void {
    // Broadcast to all clients subscribed to this session except sender
    const sessionClients = this.sessionClients.get(payload.sessionId)
    if (sessionClients) {
      const message: BridgeMessage = {
        type: 'input',
        payload: {
          clientId: client.id,
          sessionId: payload.sessionId,
          content: payload.content,
        },
      }

      for (const cid of sessionClients) {
        if (cid !== client.id) {
          const c = this.clients.get(cid)
          if (c) {
            this.send(c.ws, message)
          }
        }
      }
    }
  }

  /**
   * Broadcast event to all clients subscribed to a session
   */
  broadcastToSession(sessionId: string, event: BridgeMessage): void {
    const sessionClients = this.sessionClients.get(sessionId)
    if (sessionClients) {
      for (const clientId of sessionClients) {
        const client = this.clients.get(clientId)
        if (client) {
          this.send(client.ws, event)
        }
      }
    }
  }

  /**
   * Send message to a specific client
   */
  send(ws: WebSocket, message: BridgeMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message))
    }
  }

  /**
   * Send heartbeat to all clients
   */
  private sendHeartbeat(): void {
    for (const client of this.clients.values()) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.ping()
      }
    }
  }

  /**
   * Subscribe to bridge events
   */
  onEvent(handler: BridgeEventHandler): void {
    this.eventHandlers.add(handler)
  }

  /**
   * Unsubscribe from bridge events
   */
  offEvent(handler: BridgeEventHandler): void {
    this.eventHandlers.delete(handler)
  }

  /**
   * Emit a bridge event
   */
  private emit(event: BridgeEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event)
      } catch {
        // Silently ignore handler errors
      }
    }
  }

  /**
   * Get server stats
   */
  getStats(): { clients: number; sessions: number } {
    return {
      clients: this.clients.size,
      sessions: this.sessionClients.size,
    }
  }
}

// Singleton instance
let bridgeInstance: BridgeServer | null = null

/**
 * Get the bridge server singleton
 */
export function getBridgeServer(): BridgeServer {
  if (!bridgeInstance) {
    bridgeInstance = new BridgeServer({ port: 3002 })
  }
  return bridgeInstance
}
