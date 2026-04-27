import { Component, For, Show, createSignal } from 'solid-js'
import { useMCP } from '../../stores/mcp'
import { useI18n } from '../../i18n'
import { PlugIcon, EditIcon, TrashIcon, PlusIcon, CloseIcon } from '../Icons'
import type { MCPServer, MCPConnectionStatus } from '@hybrid-agent/core'
import './MCPPanel.css'

export const MCPPanel: Component = () => {
  const { t } = useI18n()
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
        return t.connected
      case 'connecting':
        return t.connecting
      case 'disconnected':
        return t.disconnected
      case 'error':
        return t.error
      default:
        return 'Unknown'
    }
  }

  return (
    <div class="mcp-panel">
      <div class="mcp-header">
        <span>{t.mcpServers}</span>
        <button class="add-btn" onClick={handleAddServer} title={t.add}>
          <PlusIcon size={14} />
        </button>
      </div>

      <div class="mcp-content">
        <Show when={mcp.state().servers.size === 0}>
          <div class="empty-state">
            <div class="empty-icon">
              <PlugIcon size={36} />
            </div>
            <div class="empty-title">{t.noMCPServers}</div>
            <div class="empty-desc">{t.addServerToExtend}</div>
            <button class="add-first-btn" onClick={handleAddServer}>
              {t.addServer}
            </button>
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
                <button class="action-btn" title={t.edit}>
                  <EditIcon size={14} />
                </button>
                <button class="action-btn" title={t.delete}>
                  <TrashIcon size={14} />
                </button>
              </div>
            </div>
          )}
        </For>
      </div>

      <Show when={showAddDialog()}>
        <div class="dialog-overlay" onClick={() => setShowAddDialog(false)}>
          <div class="dialog" onClick={(e) => e.stopPropagation()}>
            <div class="dialog-header">
              <h3>{t.addMCPServer}</h3>
              <button onClick={() => setShowAddDialog(false)}>
                <CloseIcon size={16} />
              </button>
            </div>
            <div class="dialog-body">
              <div class="form-group">
                <label>{t.serverName}</label>
                <input type="text" placeholder="my-mcp-server" />
              </div>
              <div class="form-group">
                <label>{t.transportType}</label>
                <select>
                  <option value="stdio">{t.stdio}</option>
                  <option value="http">{t.httpSSE}</option>
                </select>
              </div>
              <div class="form-group">
                <label>{t.commandStdio}</label>
                <input type="text" placeholder="npx @modelcontextprotocol/server-filesystem" />
              </div>
              <div class="form-group">
                <label>{t.urlHttp}</label>
                <input type="text" placeholder="http://localhost:3001/mcp" />
              </div>
            </div>
            <div class="dialog-footer">
              <button class="btn-cancel" onClick={() => setShowAddDialog(false)}>
                {t.cancel}
              </button>
              <button class="btn-add">{t.addServer}</button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  )
}

export default MCPPanel
