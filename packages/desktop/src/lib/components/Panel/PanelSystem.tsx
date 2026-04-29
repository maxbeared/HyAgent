import { Component, For, Show, createSignal, onMount, onCleanup } from 'solid-js'
import { useLayout, PanelType, GridPosition } from '../../stores/layout'
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
  ChevronUpIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from '../Icons'
import { FileExplorerPanel } from './FileExplorerPanel'
import { TerminalPanel } from './TerminalPanel'
import { getCurrentWindow } from '@tauri-apps/api/window'
import './PanelSystem.css'

const appWindow = getCurrentWindow()

export const PanelSystem: Component = () => {
  const layout = useLayout()
  const { t } = useI18n()
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
          <SimpleMode layout={layout} />
        </Show>

        <Show when={layout.layout.mode === 'pro'}>
          <ProMode layout={layout} />
        </Show>
      </main>

      <Show when={contextMenu()}>
        <div
          class="context-menu"
          style={{ left: `${contextMenu()!.x}px`, top: `${contextMenu()!.y}px` }}
        >
          <button onClick={() => { layout.addWorkspace(); closeContextMenu() }}>
            <FolderIcon size={14} />
            {t().addWorkspace || 'Add Workspace'}
          </button>
        </div>
      </Show>

      <footer class="status-bar">
        <span class="status-mode">
          [{layout.layout.mode === 'simple' ? t().simpleMode : t().proMode}]
        </span>
        <span class="status-ready">{t().ready}</span>
        <span class="status-panels">Workspaces: {layout.layout.workspaces.length}</span>
        <Show when={layout.layout.mode === 'pro'}>
          <span class="status-grid-controls">
            <button class="grid-btn" onClick={() => layout.addWorkspaceRow()} title="Add row">
              <ChevronDownIcon size={12} />
            </button>
            <button class="grid-btn" onClick={() => layout.removeWorkspaceRow()} title="Remove row">
              <ChevronUpIcon size={12} />
            </button>
            <button class="grid-btn" onClick={() => layout.addWorkspaceCol()} title="Add column">
              <ChevronRightIcon size={12} />
            </button>
            <button class="grid-btn" onClick={() => layout.removeWorkspaceCol()} title="Remove column">
              <ChevronLeftIcon size={12} />
            </button>
            <span class="grid-info">[{layout.layout.workspaceGrid.rows}x{layout.layout.workspaceGrid.cols}]</span>
          </span>
        </Show>
      </footer>

      <Show when={showSettings()}>
        <SettingsPanel onClose={() => setShowSettings(false)} />
      </Show>
    </div>
  )
}

const SimpleMode: Component<{ layout: ReturnType<typeof useLayout> }> = (props) => {
  return (
    <>
      <div class="tab-bar">
        <For each={props.layout.layout.workspaces[0]?.panels || []}>
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
                  const wsId = props.layout.layout.activeWorkspaceId
                  if (wsId) props.layout.removePanel(wsId, panel.id)
                }}
              >
                <CloseIcon size={12} />
              </button>
            </div>
          )}
        </For>
        <button class="tab add-tab" onClick={() => {
          const wsId = props.layout.layout.activeWorkspaceId
          if (wsId) props.layout.addPanel(wsId, 'agent')
        }}>
          <PlusIcon size={14} />
        </button>
      </div>
      <div class="panel-content-area">
        <For each={props.layout.layout.workspaces[0]?.panels || []}>
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

const ProMode: Component<{ layout: ReturnType<typeof useLayout> }> = (props) => {
  let workspaceGridRef: HTMLDivElement | undefined

  // Track container size for handle positioning
  const [containerSize, setContainerSize] = createSignal({ width: 0, height: 0 })

  // Workspace grid resize state
  const [resizingWorkspaceRow, setResizingWorkspaceRow] = createSignal<{ index: number; startY: number } | null>(null)
  const [resizingWorkspaceCol, setResizingWorkspaceCol] = createSignal<{ index: number; startX: number } | null>(null)

  // Mouse move handler
  const handleMouseMove = (e: MouseEvent) => {
    const gridRect = workspaceGridRef?.getBoundingClientRect()
    if (!gridRect) return

    const padding = 3
    const gap = 3
    const { rows, cols, rowWeights, colWeights } = props.layout.layout.workspaceGrid
    const totalRowWeight = rowWeights.reduce((a, b) => a + b, 0)
    const totalColWeight = colWeights.reduce((a, b) => a + b, 0)
    // Available space for fr units (excluding padding and gaps)
    const contentHeight = gridRect.height - padding * 2 - gap * (rows - 1)
    const contentWidth = gridRect.width - padding * 2 - gap * (cols - 1)

    // Workspace row resize
    const rowState = resizingWorkspaceRow()
    if (rowState) {
      const delta = e.clientY - rowState.startY
      props.layout.resizeRowHeight(rowState.index, delta, contentHeight, totalRowWeight)
      // Update startY so next delta is relative to new position
      setResizingWorkspaceRow({ ...rowState, startY: e.clientY })
      updateHandlePositions()
      return
    }

    // Workspace col resize
    const colState = resizingWorkspaceCol()
    if (colState) {
      const delta = e.clientX - colState.startX
      props.layout.resizeColWidth(colState.index, delta, contentWidth, totalColWeight)
      // Update startX so next delta is relative to new position
      setResizingWorkspaceCol({ ...colState, startX: e.clientX })
      updateHandlePositions()
      return
    }
  }

  const handleMouseUp = () => {
    setResizingWorkspaceRow(null)
    setResizingWorkspaceCol(null)
    updateHandlePositions()
  }

  onMount(() => {
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    window.addEventListener('resize', handleWindowResize)
    // Initial calculation after layout settles
    setTimeout(updateHandlePositions, 100)
  })

  onCleanup(() => {
    document.removeEventListener('mousemove', handleMouseMove)
    document.removeEventListener('mouseup', handleMouseUp)
    window.removeEventListener('resize', handleWindowResize)
  })

  const handleWorkspaceRowResizeStart = (e: MouseEvent, rowIndex: number) => {
    e.preventDefault()
    e.stopPropagation()
    setResizingWorkspaceRow({ index: rowIndex, startY: e.clientY })
  }

  const handleWorkspaceColResizeStart = (e: MouseEvent, colIndex: number) => {
    e.preventDefault()
    e.stopPropagation()
    setResizingWorkspaceCol({ index: colIndex, startX: e.clientX })
  }

  // Build workspace grid style - use fr units based on weights
  const workspaceGridStyle = () => {
    const { rowWeights, colWeights } = props.layout.layout.workspaceGrid

    // Use fr units based on weights
    const gridTemplateRows = rowWeights.map(w => `${w}fr`).join(' ')
    const gridTemplateColumns = colWeights.map(w => `${w}fr`).join(' ')

    return {
      'grid-template-rows': gridTemplateRows,
      'grid-template-columns': gridTemplateColumns,
    }
  }

  // Get handle positions by finding actual gap positions between cells
  const getHandlePositions = () => {
    if (!workspaceGridRef) return { rows: [], cols: [] }

    const gridRect = workspaceGridRef.getBoundingClientRect()
    if (gridRect.width === 0 || gridRect.height === 0) return { rows: [], cols: [] }

    const { rows, cols } = props.layout.layout.workspaceGrid
    const gap = 3
    const padding = 3

    // Calculate actual pixel positions from weights (matching the grid rendering logic)
    const { rowWeights, colWeights } = props.layout.layout.workspaceGrid
    const totalRowWeight = rowWeights.reduce((a, b) => a + b, 0)
    const totalColWeight = colWeights.reduce((a, b) => a + b, 0)

    // Available space after padding and gaps
    const availHeight = gridRect.height - padding * 2 - gap * (rows - 1)
    const availWidth = gridRect.width - padding * 2 - gap * (cols - 1)

    const rowPositions: number[] = []
    let accumulatedHeight = padding
    for (let r = 0; r < rows - 1; r++) {
      const rowHeight = availHeight * (rowWeights[r] / totalRowWeight)
      accumulatedHeight += rowHeight + gap
      rowPositions.push(accumulatedHeight - gap / 2)
    }

    const colPositions: number[] = []
    let accumulatedWidth = padding
    for (let c = 0; c < cols - 1; c++) {
      const colWidth = availWidth * (colWeights[c] / totalColWeight)
      accumulatedWidth += colWidth + gap
      colPositions.push(accumulatedWidth - gap / 2)
    }

    return { rows: rowPositions, cols: colPositions }
  }

  const [handlePositions, setHandlePositions] = createSignal({ rows: [] as number[], cols: [] as number[] })

  const updateHandlePositions = () => {
    requestAnimationFrame(() => {
      setHandlePositions(getHandlePositions())
    })
  }

  // Handle window resize - update container size
  const handleWindowResize = () => {
    updateHandlePositions()
  }

  // Get grid area for workspace to support spanning multiple cells
  const getWorkspaceGridArea = (ws: typeof props.layout.layout.workspaces[0]) => {
    return `${ws.position.row + 1} / ${ws.position.col + 1} / span ${ws.position.rowSpan} / span ${ws.position.colSpan}`
  }

  // Calculate empty cells (not occupied by any workspace)
  const getEmptyCells = () => {
    const { rows, cols } = props.layout.layout.workspaceGrid
    const occupied = new Set<string>()

    // Mark all cells occupied by workspaces
    props.layout.layout.workspaces.forEach(ws => {
      for (let r = ws.position.row; r < ws.position.row + ws.position.rowSpan; r++) {
        for (let c = ws.position.col; c < ws.position.col + ws.position.colSpan; c++) {
          occupied.add(`${r}-${c}`)
        }
      }
    })

    // Find empty cells
    const empty: Array<{ row: number; col: number }> = []
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!occupied.has(`${r}-${c}`)) {
          empty.push({ row: r, col: c })
        }
      }
    }
    return empty
  }

  const getEmptyCellGridArea = (cell: { row: number; col: number }) => {
    return `${cell.row + 1} / ${cell.col + 1} / span 1 / span 1`
  }

  return (
    <div class="pro-layout">
      <div
        ref={workspaceGridRef}
        class="workspace-grid"
        style={workspaceGridStyle()}
      >
        {/* Workspace grid resize handles */}
        <div class="workspace-grid-handles">
          <For each={handlePositions().rows}>
            {(top, i) => (
              <div
                class="workspace-grid-handle row-handle"
                style={{ top: `${top}px` }}
                onMouseDown={(e) => handleWorkspaceRowResizeStart(e, i())}
              />
            )}
          </For>
          <For each={handlePositions().cols}>
            {(left, i) => (
              <div
                class="workspace-grid-handle col-handle"
                style={{ left: `${left}px` }}
                onMouseDown={(e) => handleWorkspaceColResizeStart(e, i())}
              />
            )}
          </For>
        </div>

        {/* Empty cell placeholders */}
        <For each={getEmptyCells()}>
          {(cell) => (
            <div
              class="workspace-empty-cell"
              style={{ 'grid-area': getEmptyCellGridArea(cell) }}
              onClick={() => props.layout.addWorkspace()}
            >
              <div class="workspace-empty-content">
                <PlusIcon size={24} />
                <span>New Workspace</span>
              </div>
            </div>
          )}
        </For>

        {/* Workspaces */}
        <For each={props.layout.layout.workspaces}>
          {(workspace) => {
            return (
              <div
                class="workspace-cell"
                style={{ 'grid-area': getWorkspaceGridArea(workspace) }}
              >
                <div class="workspace-header">
                  <div class="workspace-title">
                    <FolderIcon size={14} />
                    <span>{workspace.title}</span>
                  </div>
                  <div class="workspace-actions">
                    <Show when={props.layout.layout.workspaces.length > 1}>
                      <button
                        class="workspace-action-btn"
                        onClick={() => props.layout.removeWorkspace(workspace.id)}
                        title="Remove workspace"
                      >
                        <CloseIcon size={14} />
                      </button>
                    </Show>
                    <div class="workspace-toggle">
                      <ChevronDownIcon size={14} />
                    </div>
                  </div>
                </div>

                <div class="workspace-content">
                  <WorkspacePanelGrid
                    workspace={workspace}
                    layout={props.layout}
                  />
                </div>
              </div>
            )
          }}
        </For>
      </div>
    </div>
  )
}

// Panel grid within a workspace
const WorkspacePanelGrid: Component<{
  workspace: ReturnType<typeof useLayout>['layout']['workspaces'][0]
  layout: ReturnType<typeof useLayout>
}> = (props) => {
  let panelGridRef: HTMLDivElement | undefined

  const [showAddMenu, setShowAddMenu] = createSignal<{ x: number; y: number } | null>(null)
  const [resizingPanelRow, setResizingPanelRow] = createSignal<{ index: number; startY: number } | null>(null)
  const [resizingPanelCol, setResizingPanelCol] = createSignal<{ index: number; startX: number } | null>(null)
  const [dragging, setDragging] = createSignal<{ panelId: string; startX: number; startY: number; startPosition: GridPosition } | null>(null)
  const [dragOverPanelId, setDragOverPanelId] = createSignal<string | null>(null)

  const handleMouseMove = (e: MouseEvent) => {
    const rowState = resizingPanelRow()
    if (rowState) {
      const delta = e.clientY - rowState.startY
      props.layout.resizePanelGridRow(props.workspace.id, rowState.index, delta)
      return
    }

    const colState = resizingPanelCol()
    if (colState) {
      const delta = e.clientX - colState.startX
      props.layout.resizePanelGridCol(props.workspace.id, colState.index, delta)
      return
    }
  }

  const handleMouseUp = () => {
    if (resizingPanelRow()) setResizingPanelRow(null)
    if (resizingPanelCol()) setResizingPanelCol(null)
    if (dragging()) {
      props.layout.stopDragging()
      setDragging(null)
    }
  }

  const handleClickOutside = (e: MouseEvent) => {
    if (showAddMenu() && !(e.target as HTMLElement).closest('.add-menu')) {
      setShowAddMenu(null)
    }
  }

  onMount(() => {
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.addEventListener('click', handleClickOutside)
  })

  onCleanup(() => {
    document.removeEventListener('mousemove', handleMouseMove)
    document.removeEventListener('mouseup', handleMouseUp)
    document.removeEventListener('click', handleClickOutside)
  })

  const handleRowResizeStart = (e: MouseEvent, rowIndex: number) => {
    e.preventDefault()
    e.stopPropagation()
    setResizingPanelRow({ index: rowIndex, startY: e.clientY })
  }

  const handleColResizeStart = (e: MouseEvent, colIndex: number) => {
    e.preventDefault()
    e.stopPropagation()
    setResizingPanelCol({ index: colIndex, startX: e.clientX })
  }

  const handleEmptyCellClick = (e: MouseEvent, row: number, col: number) => {
    e.stopPropagation()
    e.preventDefault()
    setShowAddMenu({ x: e.clientX, y: e.clientY })
  }

  const handlePanelDragStart = (e: MouseEvent, panelId: string) => {
    if ((e.target as HTMLElement).closest('.panel-cell-actions')) return

    const panel = props.workspace.panels.find(p => p.id === panelId)
    if (!panel) return

    e.preventDefault()
    setDragging({
      panelId,
      startX: e.clientX,
      startY: e.clientY,
      startPosition: { ...panel.position }
    })

    props.layout.startDragging(panelId)
  }

  const handlePanelDragEnter = (e: DragEvent, panelId: string) => {
    e.preventDefault()
    setDragOverPanelId(panelId)
  }

  const handlePanelDragLeave = (e: DragEvent) => {
    const relatedTarget = e.relatedTarget as HTMLElement
    if (!relatedTarget || !relatedTarget.closest('.panel-cell')) {
      setDragOverPanelId(null)
    }
  }

  const handlePanelDrop = (e: DragEvent, targetPanelId: string) => {
    e.preventDefault()
    setDragOverPanelId(null)

    const sourcePanelId = e.dataTransfer?.getData('text/source-panel-id')
    if (!sourcePanelId || sourcePanelId === targetPanelId) return

    const dragType = e.dataTransfer?.getData('text/drag-type')

    if (dragType === 'panel') {
      props.layout.mergePanels(props.workspace.id, sourcePanelId, props.workspace.id, targetPanelId)
    } else if (dragType === 'tab') {
      const tabId = e.dataTransfer?.getData('text/tab-id')
      if (tabId) {
        props.layout.moveTab(tabId, props.workspace.id, sourcePanelId, props.workspace.id, targetPanelId)
      }
    }
  }

  const handleTabDragStart = (e: DragEvent, tabId: string, panelId: string) => {
    e.dataTransfer?.setData('text/tab-id', tabId)
    e.dataTransfer?.setData('text/source-panel-id', panelId)
    e.dataTransfer?.setData('text/drag-type', 'tab')
    e.dataTransfer!.effectAllowed = 'move'
  }

  const handlePanelHeaderDragStart = (e: DragEvent, panelId: string) => {
    e.dataTransfer?.setData('text/source-panel-id', panelId)
    e.dataTransfer?.setData('text/drag-type', 'panel')
    e.dataTransfer!.effectAllowed = 'move'
  }

  const getEmptyCells = () => props.layout.getEmptyCells(props.workspace.id)

  const panelGridStyle = () => {
    const { rows, cols } = props.workspace.gridTemplate
    const rowHeights = props.workspace.rowHeights
    const colWidths = props.workspace.colWidths

    return {
      'grid-template-rows': rowHeights.map(h => `${h}px`).join(' '),
      'grid-template-columns': colWidths.map(w => `${w}px`).join(' '),
    }
  }

  // Calculate panel position
  const getPanelPosition = (panel: typeof props.workspace.panels[0]) => {
    const rowHeights = props.workspace.rowHeights
    const colWidths = props.workspace.colWidths

    const top = rowHeights.slice(0, panel.position.row).reduce((a, b) => a + b, 0)
    const left = colWidths.slice(0, panel.position.col).reduce((a, b) => a + b, 0)
    const width = colWidths.slice(panel.position.col, panel.position.col + panel.position.colSpan).reduce((a, b) => a + b, 0)
    const height = rowHeights.slice(panel.position.row, panel.position.row + panel.position.rowSpan).reduce((a, b) => a + b, 0)

    return { top, left, width, height }
  }

  return (
    <div
      ref={panelGridRef}
      class="panel-grid"
      style={panelGridStyle()}
    >
      {/* Panel grid row/col handles */}
      <div class="panel-grid-handles">
        <For each={props.workspace.rowHeights}>
          {(_, i) => (
            <Show when={i() < props.workspace.rowHeights.length - 1}>
              <div
                class="panel-grid-handle row-handle"
                style={{ top: `${props.workspace.rowHeights.slice(0, i() + 1).reduce((a, b) => a + b, 0)}px` }}
                onMouseDown={(e) => handleRowResizeStart(e, i())}
              />
            </Show>
          )}
        </For>
        <For each={props.workspace.colWidths}>
          {(_, i) => (
            <Show when={i() < props.workspace.colWidths.length - 1}>
              <div
                class="panel-grid-handle col-handle"
                style={{ left: `${props.workspace.colWidths.slice(0, i() + 1).reduce((a, b) => a + b, 0)}px` }}
                onMouseDown={(e) => handleColResizeStart(e, i())}
              />
            </Show>
          )}
        </For>
      </div>

      {/* Empty cells */}
      <For each={getEmptyCells()}>
        {(cell) => {
          const rowHeights = props.workspace.rowHeights
          const colWidths = props.workspace.colWidths
          const top = rowHeights.slice(0, cell.row).reduce((a, b) => a + b, 0)
          const left = colWidths.slice(0, cell.col).reduce((a, b) => a + b, 0)
          const width = colWidths[cell.col]
          const height = rowHeights[cell.row]

          return (
            <div
              class="empty-cell"
              style={{
                position: 'absolute',
                top: `${top}px`,
                left: `${left}px`,
                width: `${width}px`,
                height: `${height}px`,
              }}
              onClick={(e) => handleEmptyCellClick(e, cell.row, cell.col)}
            >
              <div class="empty-cell-content">
                <PlusIcon size={24} />
                <span>Add Panel</span>
              </div>
            </div>
          )
        }}
      </For>

      {/* Panels */}
      <For each={props.workspace.panels}>
        {(panel) => {
          const pos = getPanelPosition(panel)
          return (
            <div
              class="panel-cell"
              classList={{
                active: props.layout.layout.activePanelId === panel.id,
                dragging: props.layout.draggingPanelId() === panel.id,
                'drag-over': dragOverPanelId() === panel.id,
              }}
              style={{
                position: 'absolute',
                top: `${pos.top}px`,
                left: `${pos.left}px`,
                width: `${pos.width}px`,
                height: `${pos.height}px`,
              }}
              onClick={() => props.layout.setActivePanel(panel.id)}
              onDragOver={(e) => e.preventDefault()}
              onDragEnter={(e) => handlePanelDragEnter(e, panel.id)}
              onDragLeave={handlePanelDragLeave}
              onDrop={(e) => handlePanelDrop(e, panel.id)}
            >
              <div
                class="panel-cell-header"
                draggable={true}
                onMouseDown={(e) => handlePanelDragStart(e, panel.id)}
                onDragStart={(e) => handlePanelHeaderDragStart(e, panel.id)}
              >
                <div class="panel-cell-tabs">
                  <For each={panel.tabs}>
                    {(tabId) => {
                      const tabPanel = props.workspace.panels.find(p => p.id === tabId)
                      return (
                        <div
                          class="panel-cell-tab"
                          classList={{ active: props.layout.layout.activePanelId === tabId }}
                          draggable={true}
                          onDragStart={(e) => handleTabDragStart(e, tabId, panel.id)}
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
                      props.layout.addTabToPanel(props.workspace.id, panel.id)
                    }}
                    title={panel.type === 'explorer' ? 'New Workspace' : 'New Tab'}
                  >
                    <PlusIcon size={12} />
                  </button>
                  <button
                    class="panel-action-btn close-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      props.layout.removePanel(props.workspace.id, panel.id)
                    }}
                    title="Close"
                  >
                    <CloseIcon size={12} />
                  </button>
                </div>
              </div>
              <div class="panel-cell-content">
                <PanelContent type={panel.type} panelId={panel.id} />
              </div>
            </div>
          )
        }}
      </For>

      {/* Add menu */}
      <Show when={showAddMenu()}>
        <div
          class="add-menu"
          style={{ left: `${showAddMenu()!.x}px`, top: `${showAddMenu()!.y}px` }}
        >
          <button onClick={() => {
            const emptyCells = getEmptyCells()
            if (emptyCells.length > 0) {
              props.layout.addPanelAt(props.workspace.id, 'agent', emptyCells[0].row, emptyCells[0].col)
            }
            setShowAddMenu(null)
          }}>
            <ChatIcon size={14} />
            Agent
          </button>
          <button onClick={() => {
            const emptyCells = getEmptyCells()
            if (emptyCells.length > 0) {
              props.layout.addPanelAt(props.workspace.id, 'explorer', emptyCells[0].row, emptyCells[0].col)
            }
            setShowAddMenu(null)
          }}>
            <FolderIcon size={14} />
            Explorer
          </button>
          <button onClick={() => {
            const emptyCells = getEmptyCells()
            if (emptyCells.length > 0) {
              props.layout.addPanelAt(props.workspace.id, 'terminal', emptyCells[0].row, emptyCells[0].col)
            }
            setShowAddMenu(null)
          }}>
            <TerminalIcon size={14} />
            Terminal
          </button>
        </div>
      </Show>
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