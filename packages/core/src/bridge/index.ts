/**
 * Remote Session Bridge
 *
 * WebSocket 远程会话桥接，允许远程客户端连接到 agent 会话。
 *
 * 参考来源:
 * - Anthropic-Leaked-Source-Code/bridge/
 */

// Re-export types
export type {
  BridgeConfig,
  BridgeMessage,
  BridgeClient,
  BridgeEvent,
  BridgeEventHandler,
  BridgeSessionInfo,
  BridgeMessageType,
} from './types.js'

// Re-export server
export { BridgeServer, getBridgeServer } from './server.js'
