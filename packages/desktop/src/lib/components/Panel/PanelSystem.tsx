import { Component, For, Show, createSignal, onMount, onCleanup } from 'solid-js'
import { useLayout, PanelType } from '../../stores/layout'
import { useI18n } from '../../i18n'
import { useSettings, getEffectiveTheme } from '../../stores/settings'
import { SettingsPanel } from '../Settings/SettingsPanel'
import { AgentChatPanel } from './AgentChatPanel'
import {
  SettingsIcon,
  CloseIcon,
  MinimizeIcon,
  MaximizeIcon,
  PlusIcon,
  FolderIcon,
  TerminalIcon,
  ChatIcon,
} from '../Icons'
import { FileExplorerPanel } from './FileExplorerPanel'
import { TerminalPanel } from './TerminalPanel'
import { getCurrentWindow } from '@tauri-apps/api/window'
import './PanelSystem.css'

const appWindow = getCurrentWindow()

export const PanelSystem: Component = () => {
  const layout = useLayout()
  const { t } = useI18n()
  const settings = useSettings()
  const [contextMenu, setContextMenu] = createSignal<{ x: number; y: number } | null>(null)
  const [showSettings, setShowSettings] = createSignal(false)

  const minimizeWindow = async () => {
    await appWindow.minimize()
  }

  const toggleMaximize = async () => {
    const isMaximized = await appWindow.isMaximized()
    if (isMaximized) {
      await appWindow.unmaximize()
    } else {
      await appWindow.maximize()
    }
  }

  const closeWindow = async () => {
    await appWindow.close()
  }

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }

  const closeContextMenu = () => setContextMenu(null)

  onMount(() => {
    document.addEventListener('click', closeContextMenu)
  })

  onCleanup(() => {
    document.removeEventListener('click', closeContextMenu)
  })

  const handleAddPanel = (type: PanelType) => {
    layout.addPanel(type)
    closeContextMenu()
  }

  return (
    <div class="panel-system" onContextMenu={handleContextMenu}>
      <header class="title-bar">
        <div class="title-bar-left" data-tauri-drag-region>
          <img
            src="/icons/logo.svg"
            alt="Logo"
            class="app-logo"
            data-theme={getEffectiveTheme()}
          />
          <span class="app-name">{t().appName}</span>
        </div>
        <div class="title-bar-center">
          <button
            class={`mode-switch ${layout.layout.mode === 'simple' ? 'active' : ''}`}
            onClick={() => layout.setMode('simple')}
          >
            {t().simpleMode}
          </button>
          <button
            class={`mode-switch ${layout.layout.mode === 'pro' ? 'active' : ''}`}
            onClick={() => layout.setMode('pro')}
          >
            {t().proMode}
          </button>
        </div>
        <div class="title-bar-right">
          <button class="btn-icon" title={t().settings} onClick={() => setShowSettings(true)}>
            <SettingsIcon size={16} />
          </button>
          <button class="btn-icon window-control" onClick={minimizeWindow} title={t().minimize}>
            <MinimizeIcon size={14} />
          </button>
          <button class="btn-icon window-control" onClick={toggleMaximize} title={t().maximize}>
            <MaximizeIcon size={14} />
          </button>
          <button class="btn-icon window-control close" onClick={closeWindow} title={t().close}>
            <CloseIcon size={14} />
          </button>
        </div>
      </header>

      <main class="panel-container">
        <Show when={layout.layout.mode === 'simple'}>
          <SimpleMode layout={layout} t={t} onAddPanel={handleAddPanel} />
        </Show>

        <Show when={layout.layout.mode === 'pro'}>
          <ProMode layout={layout} t={t} onAddPanel={handleAddPanel} />
        </Show>
      </main>

      <Show when={contextMenu()}>
        <div
          class="context-menu"
          style={{ left: `${contextMenu()!.x}px`, top: `${contextMenu()!.y}px` }}
        >
          <button onClick={() => handleAddPanel('agent')}>
            <ChatIcon size={14} />
            {t().addAgentPanel}
          </button>
          <button onClick={() => handleAddPanel('explorer')}>
            <FolderIcon size={14} />
            {t().addExplorerPanel}
          </button>
          <button onClick={() => handleAddPanel('terminal')}>
            <TerminalIcon size={14} />
            {t().addConsolePanel}
          </button>
        </div>
      </Show>

      <footer class="status-bar">
        <span class="status-mode">
          [{layout.layout.mode === 'simple' ? t().simpleMode : t().proMode}]
        </span>
        <span class="status-ready">{t().ready}</span>
        <span class="status-panels">{t().panelCount}: {layout.layout.panels.length}</span>
      </footer>

      <Show when={showSettings()}>
        <SettingsPanel onClose={() => setShowSettings(false)} />
      </Show>
    </div>
  )
}

// Simple Mode: Tab-based interface
const SimpleMode: Component<{ layout: ReturnType<typeof useLayout>; t: any; onAddPanel: (type: PanelType) => void }> = (props) => {
  return (
    <>
      <div class="tab-bar">
        <For each={props.layout.layout.panels}>
          {(panel) => (
            <div
              class="tab"
              classList={{ active: props.layout.layout.activePanelId === panel.id }}
              onClick={() => props.layout.setActivePanel(panel.id)}
            >
              <span class="tab-icon">
                {panel.type === 'agent' && <ChatIcon size={14} />}
                {panel.type === 'explorer' && <FolderIcon size={14} />}
                {panel.type === 'terminal' && <TerminalIcon size={14} />}
              </span>
              <span class="tab-title">{panel.title}</span>
              <button
                class="tab-close"
                onClick={(e) => {
                  e.stopPropagation()
                  props.layout.removePanel(panel.id)
                }}
              >
                <CloseIcon size={12} />
              </button>
            </div>
          )}
        </For>
        <button class="tab add-tab" onClick={() => props.onAddPanel('agent')}>
          <PlusIcon size={14} />
        </button>
      </div>
      <div class="panel-content-area">
        <For each={props.layout.layout.panels}>
          {(panel) => (
            <Show when={props.layout.layout.activePanelId === panel.id}>
              <PanelContent type={panel.type} panelId={panel.id} />
            </Show>
          )}
        </For>
      </div>
    </>
  )
}

// Pro Mode: Grid-based dockable interface
const ProMode: Component<{ layout: ReturnType<typeof useLayout>; t: any; onAddPanel: (type: PanelType) => void }> = (props) => {
  const gridTemplate = props.layout.layout.gridTemplate || { rows: 2, cols: 2 }
  const rows = gridTemplate.rows
  const cols = gridTemplate.cols

  return (
    <div
      class="panel-grid"
      style={{
        'grid-template-rows': `repeat(${rows}, 1fr)`,
        'grid-template-columns': `repeat(${cols}, 1fr)`,
      }}
    >
      <For each={props.layout.layout.panels}>
        {(panel) => (
          <div
            class="panel-cell"
            classList={{
              active: props.layout.layout.activePanelId === panel.id,
              dragging: props.layout.draggingPanelId() === panel.id,
            }}
            style={{
              'grid-row': `${panel.position.row + 1} / span ${panel.position.rowSpan}`,
              'grid-column': `${panel.position.col + 1} / span ${panel.position.colSpan}`,
            }}
            onClick={() => props.layout.setActivePanel(panel.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              // Handle drop for reordering
            }}
          >
            <div class="panel-cell-header">
              <div class="panel-cell-tabs">
                <For each={panel.tabs}>
                  {(tabId) => {
                    const tabPanel = props.layout.layout.panels.find(p => p.id === tabId)
                    return (
                      <div
                        class="panel-cell-tab"
                        classList={{ active: props.layout.layout.activePanelId === tabId }}
                        onClick={(e) => {
                          e.stopPropagation()
                          props.layout.setActivePanel(tabId)
                        }}
                      >
                        {tabPanel?.type === 'agent' && <ChatIcon size={12} />}
                        {tabPanel?.type === 'explorer' && <FolderIcon size={12} />}
                        {tabPanel?.type === 'terminal' && <TerminalIcon size={12} />}
                        <span>{tabPanel?.title || tabId}</span>
                      </div>
                    )
                  }}
                </For>
              </div>
              <div class="panel-cell-actions">
                <button
                  class="panel-action-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    props.onAddPanel(panel.type)
                  }}
                  title={props.t().addPanel}
                >
                  <PlusIcon size={12} />
                </button>
              </div>
            </div>
            <div class="panel-cell-content">
              <PanelContent type={panel.type} panelId={panel.id} />
            </div>
            <div
              class="panel-resize-handle resize-right"
              onMouseDown={(e) => {
                e.stopPropagation()
                props.layout.startResizing(panel.id)
              }}
            />
            <div
              class="panel-resize-handle resize-bottom"
              onMouseDown={(e) => {
                e.stopPropagation()
                props.layout.startResizing(panel.id)
              }}
            />
          </div>
        )}
      </For>
    </div>
  )
}

const PanelContent: Component<{ type: PanelType; panelId: string }> = (props) => {
  switch (props.type) {
    case 'agent':
      return <AgentChatPanel panelId={props.panelId} />
    case 'explorer':
      return <FileExplorerPanel />
    case 'terminal':
      return <TerminalPanel />
    default:
      return <div class="placeholder">{props.type} Panel</div>
  }
}

export default PanelSystem