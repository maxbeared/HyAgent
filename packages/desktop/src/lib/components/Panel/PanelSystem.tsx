import { Component, For, Show, createSignal, onMount, onCleanup } from 'solid-js'
import { useLayout, PanelType } from '../../stores/layout'
import { SettingsPanel } from '../Settings/SettingsPanel'
import { AgentChatPanel } from './AgentChatPanel'
import './PanelSystem.css'

export const PanelSystem: Component = () => {
  const layout = useLayout()
  const [contextMenu, setContextMenu] = createSignal<{ x: number; y: number } | null>(null)
  const [showSettings, setShowSettings] = createSignal(false)

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
        <div class="title-bar-left">
          <span class="app-name">Hybrid Agent</span>
        </div>
        <div class="title-bar-center">
          <button
            class={`mode-switch ${layout.layout.mode === 'simple' ? 'active' : ''}`}
            onClick={() => layout.setMode('simple')}
          >
            简洁模式
          </button>
          <button
            class={`mode-switch ${layout.layout.mode === 'pro' ? 'active' : ''}`}
            onClick={() => layout.setMode('pro')}
          >
            专业模式
          </button>
        </div>
        <div class="title-bar-right">
          <button class="btn-icon" title="Settings" onClick={() => setShowSettings(true)}>
            ⚙️
          </button>
        </div>
      </header>

      <main class="panel-container">
        <div class="panel-grid" classList={{ 'pro-mode': layout.layout.mode === 'pro' }}>
          <For each={layout.layout.panels}>
            {(panel) => (
              <Panel
                panel={panel}
                isActive={layout.layout.activePanelId === panel.id}
                onActivate={() => layout.setActivePanel(panel.id)}
                onClose={() => layout.removePanel(panel.id)}
                onToggleMinimize={() => layout.toggleMinimize(panel.id)}
                onToggleFloat={() => layout.toggleFloat(panel.id)}
              />
            )}
          </For>

          <button class="add-panel-btn" onClick={() => handleAddPanel('agent')}>
            + 添加面板
          </button>
        </div>
      </main>

      <Show when={contextMenu()}>
        <div
          class="context-menu"
          style={{ left: `${contextMenu()!.x}px`, top: `${contextMenu()!.y}px` }}
        >
          <button onClick={() => handleAddPanel('agent')}>添加 Agent 面板</button>
          <button onClick={() => handleAddPanel('console')}>添加 Console 面板</button>
          <button onClick={() => handleAddPanel('explorer')}>添加 Explorer 面板</button>
          <button onClick={() => handleAddPanel('editor')}>添加 Editor 面板</button>
        </div>
      </Show>

      <footer class="status-bar">
        <span>[{layout.layout.mode === 'simple' ? '简洁' : '专业'}]</span>
        <span>Ready</span>
        <span>Panels: {layout.layout.panels.length}</span>
      </footer>

      <Show when={showSettings()}>
        <SettingsPanel onClose={() => setShowSettings(false)} />
      </Show>
    </div>
  )
}

interface PanelProps {
  panel: {
    id: string
    type: string
    title: string
    minimized: boolean
    floating: boolean
    bounds?: { x: number; y: number; width: number; height: number }
  }
  isActive: boolean
  onActivate: () => void
  onClose: () => void
  onToggleMinimize: () => void
  onToggleFloat: () => void
}

const Panel: Component<PanelProps> = (props) => {
  const [isDragging, setIsDragging] = createSignal(false)
  const [isResizing, setIsResizing] = createSignal(false)
  const [dragOffset, setDragOffset] = createSignal({ x: 0, y: 0 })
  const [size, setSize] = createSignal({ width: 400, height: 300 })

  let panelRef: HTMLDivElement | undefined

  const handleMouseDown = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('.panel-header')) {
      setIsDragging(true)
      setDragOffset({
        x: e.clientX - (props.panel.bounds?.x || 0),
        y: e.clientY - (props.panel.bounds?.y || 0),
      })
      props.onActivate()
    }
  }

  const handleResizeMouseDown = (e: MouseEvent) => {
    e.stopPropagation()
    setIsResizing(true)
    props.onActivate()
  }

  const handleMouseMove = (e: MouseEvent) => {
    if (isDragging()) {
      const newX = e.clientX - dragOffset().x
      const newY = e.clientY - dragOffset().y
      props.panel.bounds = {
        ...(props.panel.bounds || { x: 0, y: 0, width: size().width, height: size().height }),
        x: Math.max(0, newX),
        y: Math.max(0, newY),
      }
    }
    if (isResizing() && panelRef) {
      const rect = panelRef.getBoundingClientRect()
      const newWidth = Math.max(200, e.clientX - rect.left)
      const newHeight = Math.max(150, e.clientY - rect.top)
      setSize({ width: newWidth, height: newHeight })
    }
  }

  const handleMouseUp = () => {
    setIsDragging(false)
    setIsResizing(false)
  }

  onMount(() => {
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  })

  onCleanup(() => {
    document.removeEventListener('mousemove', handleMouseMove)
    document.removeEventListener('mouseup', handleMouseUp)
  })

  return (
    <div
      ref={panelRef}
      class="panel"
      classList={{
        active: props.isActive,
        minimized: props.panel.minimized,
        floating: props.panel.floating,
        dragging: isDragging(),
        resizing: isResizing(),
      }}
      style={{
        width: props.panel.bounds?.width
          ? `${props.panel.bounds.width}px`
          : props.panel.floating
            ? `${size().width}px`
            : 'auto',
        height: props.panel.bounds?.height
          ? `${props.panel.bounds.height}px`
          : props.panel.floating
            ? `${size().height}px`
            : props.panel.minimized
              ? '36px'
              : 'auto',
        left: props.panel.bounds?.x ? `${props.panel.bounds.x}px` : undefined,
        top: props.panel.bounds?.y ? `${props.panel.bounds.y}px` : undefined,
      }}
      onMouseDown={handleMouseDown}
    >
      <div class="panel-header">
        <span class="panel-title">{props.panel.title}</span>
        <div class="panel-actions">
          <button class="btn-icon-small" onClick={props.onToggleMinimize} title="Minimize">
            ─
          </button>
          <button class="btn-icon-small" onClick={props.onToggleFloat} title="Maximize">
            □
          </button>
          <button class="btn-icon-small btn-close" onClick={props.onClose} title="Close">
            ×
          </button>
        </div>
      </div>

      <Show when={!props.panel.minimized}>
        <div class="panel-content">
          <PanelContent type={props.panel.type as any} panelId={props.panel.id} />
        </div>
      </Show>

      <div class="resize-handle" onMouseDown={handleResizeMouseDown} />
    </div>
  )
}

const PanelContent: Component<{ type: PanelType; panelId: string }> = (props) => {
  switch (props.type) {
    case 'agent':
      return <AgentChatPanel panelId={props.panelId} />
    case 'console':
      return <ConsolePanel />
    case 'explorer':
      return <ExplorerPanel />
    case 'editor':
      return <EditorPanel />
    case 'preview':
      return <div class="placeholder">Preview Panel</div>
    case 'settings':
      return <div class="placeholder">Settings Panel</div>
    default:
      return <div class="placeholder">Unknown Panel</div>
  }
}

const ConsolePanel: Component = () => {
  return (
    <div class="console-panel">
      <div class="console-output">
        <div class="log-entry timestamp">[09:32:15]</div>
        <div class="log-entry info">System initialized</div>
        <div class="log-entry timestamp">[09:32:16]</div>
        <div class="log-entry success">Ready</div>
        <div class="log-entry timestamp">[09:32:17]</div>
        <div class="log-entry info">Waiting for input...</div>
      </div>
    </div>
  )
}

const ExplorerPanel: Component = () => {
  const [files] = createSignal([
    { name: 'src', type: 'folder' as const },
    { name: 'tests', type: 'folder' as const },
    { name: 'package.json', type: 'file' as const },
    { name: 'README.md', type: 'file' as const },
  ])

  return (
    <div class="explorer-panel">
      <div class="explorer-header">
        <span>Explorer</span>
      </div>
      <div class="explorer-tree">
        <For each={files()}>
          {(file) => (
            <div class={`tree-item ${file.type}`}>
              <span class="icon">{file.type === 'folder' ? '📁' : '📄'}</span>
              <span class="name">{file.name}</span>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}

const EditorPanel: Component = () => {
  const [content] = createSignal(`// Hybrid Agent Desktop Editor
const greeting = "Hello, World!";
console.log(greeting);
`)

  return (
    <div class="editor-panel">
      <div class="editor-tabs">
        <div class="tab active">main.ts</div>
      </div>
      <div class="editor-content">
        <textarea value={content()} readonly />
      </div>
    </div>
  )
}

export default PanelSystem
