import { createSignal } from 'solid-js'
import type { MCPServer, MCPConnectionStatus } from '@hybrid-agent/core'

export interface MCPState {
  servers: Map<string, MCPServer>
  connectionStatus: Map<string, MCPConnectionStatus>
}

const [state, setState] = createSignal<MCPState>({
  servers: new Map(),
  connectionStatus: new Map(),
})

export function useMCP() {
  const addServer = (server: MCPServer) => {
    setState(s => ({
      ...s,
      servers: new Map(s.servers).set(server.name, server),
      connectionStatus: new Map(s.connectionStatus).set(server.name, 'disconnected'),
    }))
  }

  const removeServer = (name: string) => {
    const servers = new Map(state().servers)
    const connectionStatus = new Map(state().connectionStatus)
    servers.delete(name)
    connectionStatus.delete(name)
    setState(s => ({ ...s, servers, connectionStatus }))
  }

  const updateConnectionStatus = (name: string, status: MCPConnectionStatus) => {
    setState(s => ({
      ...s,
      connectionStatus: new Map(s.connectionStatus).set(name, status),
    }))
  }

  const getServers = (): MCPServer[] => {
    return Array.from(state().servers.values())
  }

  const getConnectionStatus = (name: string): MCPConnectionStatus => {
    return state().connectionStatus.get(name) || 'disconnected'
  }

  return {
    state,
    addServer,
    removeServer,
    updateConnectionStatus,
    getServers,
    getConnectionStatus,
  }
}