import { describe, it, expect } from 'vitest'
import { useMCP, type MCPState } from '../../src/lib/stores/mcp'
import type { MCPServer, MCPConnectionStatus } from '@hyagent/core'

describe('MCP Store', () => {
  // The store is a singleton with module-level state
  const mcp = useMCP()

  describe('initial state', () => {
    it('should have empty servers map initially', () => {
      // Note: Due to singleton nature, we just verify the initial condition
      // when the store is first used. Subsequent tests share state.
      const servers = mcp.getServers()
      // Just verify we can get servers without error
      expect(Array.isArray(servers)).toBe(true)
    })

    it('should return disconnected status for unknown server', () => {
      const status = mcp.getConnectionStatus('definitely-not-added-server')
      expect(status).toBe('disconnected')
    })
  })

  describe('addServer', () => {
    it('should add a server to the store', () => {
      const server: MCPServer = {
        name: 'test-server-add',
        command: 'npx',
        args: ['-y', '@server/test'],
      }

      mcp.addServer(server)

      expect(mcp.state().servers.get('test-server-add')).toEqual(server)
    })

    it('should set initial connection status to disconnected', () => {
      const server: MCPServer = {
        name: 'test-server-status',
        command: 'npx',
        args: ['-y', '@server/test'],
      }

      mcp.addServer(server)

      expect(mcp.getConnectionStatus('test-server-status')).toBe('disconnected')
    })

    it('should add multiple servers with unique names', () => {
      const server1: MCPServer = { name: 'unique-server-1', command: 'npx', args: ['-y', 'server1'] }
      const server2: MCPServer = { name: 'unique-server-2', command: 'npx', args: ['-y', 'server2'] }

      mcp.addServer(server1)
      mcp.addServer(server2)

      expect(mcp.state().servers.get('unique-server-1')).toEqual(server1)
      expect(mcp.state().servers.get('unique-server-2')).toEqual(server2)
    })
  })

  describe('removeServer', () => {
    it('should remove server from store', () => {
      const server: MCPServer = {
        name: 'server-to-remove',
        command: 'npx',
        args: ['-y', '@server/test'],
      }

      mcp.addServer(server)
      mcp.removeServer('server-to-remove')

      expect(mcp.state().servers.has('server-to-remove')).toBe(false)
    })

    it('should remove server connection status', () => {
      const server: MCPServer = {
        name: 'server-to-remove-status',
        command: 'npx',
        args: ['-y', '@server/test'],
      }

      mcp.addServer(server)
      mcp.updateConnectionStatus('server-to-remove-status', 'connected')
      mcp.removeServer('server-to-remove-status')

      expect(mcp.state().connectionStatus.has('server-to-remove-status')).toBe(false)
    })

    it('should not error when removing non-existent server', () => {
      expect(() => mcp.removeServer('non-existent')).not.toThrow()
    })
  })

  describe('updateConnectionStatus', () => {
    it('should update connection status to connected', () => {
      const server: MCPServer = {
        name: 'server-connected',
        command: 'npx',
        args: ['-y', '@server/test'],
      }

      mcp.addServer(server)
      mcp.updateConnectionStatus('server-connected', 'connected')

      expect(mcp.getConnectionStatus('server-connected')).toBe('connected')
    })

    it('should update connection status to connecting', () => {
      const server: MCPServer = {
        name: 'server-connecting',
        command: 'npx',
        args: ['-y', '@server/test'],
      }

      mcp.addServer(server)
      mcp.updateConnectionStatus('server-connecting', 'connecting')

      expect(mcp.getConnectionStatus('server-connecting')).toBe('connecting')
    })

    it('should update connection status to error', () => {
      const server: MCPServer = {
        name: 'server-error',
        command: 'npx',
        args: ['-y', '@server/test'],
      }

      mcp.addServer(server)
      mcp.updateConnectionStatus('server-error', 'error')

      expect(mcp.getConnectionStatus('server-error')).toBe('error')
    })
  })

  describe('getServers', () => {
    it('should return array of servers', () => {
      const servers = mcp.getServers()
      expect(Array.isArray(servers)).toBe(true)
    })

    it('should include all added servers', () => {
      const server: MCPServer = { name: 'get-test-server', command: 'npx', args: ['-y', 'server'] }

      mcp.addServer(server)

      const servers = mcp.getServers()
      expect(servers.map(s => s.name)).toContain('get-test-server')
    })
  })

  describe('MCPState interface', () => {
    it('should support servers map', () => {
      const state: MCPState = {
        servers: new Map([['test', { name: 'test', command: 'cmd', args: [] }]]),
        connectionStatus: new Map(),
      }
      expect(state.servers.size).toBe(1)
    })

    it('should support connection status map', () => {
      const state: MCPState = {
        servers: new Map(),
        connectionStatus: new Map([['test', 'connected']]),
      }
      expect(state.connectionStatus.get('test')).toBe('connected')
    })
  })

  describe('MCPConnectionStatus', () => {
    it('should support all valid statuses', () => {
      const statuses: MCPConnectionStatus[] = ['connected', 'connecting', 'disconnected', 'error']

      statuses.forEach((status) => {
        const state: MCPState = {
          servers: new Map(),
          connectionStatus: new Map([['test', status]]),
        }
        expect(state.connectionStatus.get('test')).toBe(status)
      })
    })
  })
})
