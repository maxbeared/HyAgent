import { Component, For, Show, createSignal } from 'solid-js'
import { useMCP } from '../../stores/mcp'
import type { MCPServer, MCPConnectionStatus } from '@hybrid-agent/core'
import './MCPPanel.css'

export const MCPPanel: Component = () => {
  const mcp = useMCP()
  const [showAddDialog, setShowAddDialog] = createSignal(false)

  const handleAddServer = () => {
    setShowAddDialog(true)
  }

  const getStatusColor = (status: MCPConnectionStatus): string => {
    switch (status) {
      case 'connected':
        return 'var(--accent-success)'
      case 'connecting':
        return 'var(--accent-warning)'
      case 'disconnected':
        return 'var(--text-muted)'
      case 'error':
        return 'var(--accent-danger)'
      default:
        return 'var(--text-muted)'
    }
  }

  const getStatusText = (status: MCPConnectionStatus): string => {
    switch (status) {
      case 'connected':
        return 'Connected'
      case 'connecting':
        return 'Connecting...'
      case 'disconnected':
        return 'Disconnected'
      case 'error':
        return 'Error'
      default:
        return 'Unknown'
    }
  }

  return (
    <div class="mcp-panel">
      <div class="mcp-header">
        <span>MCP Servers</span>
        <button class="add-btn" onClick={handleAddServer}>+</button>
      </div>

      <div class="mcp-content">
        <Show when={mcp.state().servers.size === 0}>
          <div class="empty-state">
            <div class="empty-icon">🔌</div>
            <div class="empty-title">No MCP Servers</div>
            <div class="empty-desc">Add a server to extend agent capabilities</div>
            <button class="add-first-btn" onClick={handleAddServer}>Add Server</button>
          </div>
        </Show>

        <For each={Array.from(mcp.state().servers.values())}>
          {(server) => (
            <div class="server-item">
              <div class="server-info">
                <span
                  class="status-dot"
                  style={{ background: getStatusColor(mcp.getConnectionStatus(server.name)) }}
                />
                <span class="server-name">{server.name}</span>
              </div>
              <div class="server-status">
                {getStatusText(mcp.getConnectionStatus(server.name))}
              </div>
              <div class="server-actions">
                <button class="action-btn" title="Edit">✏️</button>
                <button class="action-btn" title="Delete">🗑️</button>
              </div>
            </div>
          )}
        </For>
      </div>

      <Show when={showAddDialog()}>
        <div class="dialog-overlay" onClick={() => setShowAddDialog(false)}>
          <div class="dialog" onClick={(e) => e.stopPropagation()}>
            <div class="dialog-header">
              <h3>Add MCP Server</h3>
              <button onClick={() => setShowAddDialog(false)}>×</button>
            </div>
            <div class="dialog-body">
              <div class="form-group">
                <label>Server Name</label>
                <input type="text" placeholder="my-mcp-server" />
              </div>
              <div class="form-group">
                <label>Transport Type</label>
                <select>
                  <option value="stdio">Stdio</option>
                  <option value="http">HTTP/SSE</option>
                </select>
              </div>
              <div class="form-group">
                <label>Command (for stdio)</label>
                <input type="text" placeholder="npx @modelcontextprotocol/server-filesystem" />
              </div>
              <div class="form-group">
                <label>URL (for http/sse)</label>
                <input type="text" placeholder="http://localhost:3001/mcp" />
              </div>
            </div>
            <div class="dialog-footer">
              <button class="btn-cancel" onClick={() => setShowAddDialog(false)}>Cancel</button>
              <button class="btn-add">Add Server</button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  )
}

export default MCPPanel