import { createStore } from 'solid-js/store'
import { createSignal } from 'solid-js'

export type PanelType = 'agent' | 'explorer' | 'terminal'

export interface GridPosition {
  row: number
  col: number
  rowSpan: number
  colSpan: number
}

export interface PanelConfig {
  id: string
  type: PanelType
  title: string
  position: GridPosition
  tabs: string[]
}

export interface WorkspaceConfig {
  id: string
  title: string
  position: GridPosition
  gridTemplate: { rows: number; cols: number }
  rowHeights: number[]
  colWidths: number[]
  panels: PanelConfig[]
  collapsed: boolean
}

export interface LayoutState {
  mode: 'simple' | 'pro'
  activePanelId: string | null
  activeWorkspaceId: string | null
  workspaceGrid: {
    rows: number
    cols: number
    rowWeights: number[]  // proportions for each row
    colWeights: number[]   // proportions for each col
  }
  workspaces: WorkspaceConfig[]
}

const DEFAULT_WORKSPACE_WEIGHT = 1  // Equal proportions initially
const MIN_WORKSPACE_WEIGHT = 0.1     // Minimum weight fraction

let workspaceCounter = 0
let panelCounter = 0

function createWorkspaceId(): string {
  return `ws-${++workspaceCounter}`
}

function createPanelId(type: PanelType): string {
  return `${type}-${++panelCounter}`
}

function makeDefaultWorkspaces(mode: 'simple' | 'pro'): WorkspaceConfig[] {
  workspaceCounter = 1
  panelCounter = 1

  if (mode === 'simple') {
    const panelId = createPanelId('agent')
    return [{
      id: 'ws-1',
      title: 'Workspace 1',
      position: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
      gridTemplate: { rows: 1, cols: 1 },
      rowHeights: [DEFAULT_ROW_HEIGHT],
      colWidths: [DEFAULT_COL_WIDTH],
      collapsed: false,
      panels: [{
        id: panelId,
        type: 'agent',
        title: 'Agent',
        position: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
        tabs: [panelId],
      }],
    }]
  }

  // Pro mode - 2 workspaces side by side
  const ws1Panel1Id = createPanelId('explorer')
  const ws1Panel2Id = createPanelId('agent')
  const ws1Panel3Id = createPanelId('terminal')
  const ws2Panel1Id = createPanelId('agent')

  return [
    {
      id: 'ws-1',
      title: 'Workspace 1',
      position: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
      gridTemplate: { rows: 2, cols: 2 },
      rowHeights: [DEFAULT_ROW_HEIGHT, DEFAULT_ROW_HEIGHT],
      colWidths: [DEFAULT_COL_WIDTH, DEFAULT_COL_WIDTH],
      collapsed: false,
      panels: [
        { id: ws1Panel1Id, type: 'explorer', title: 'Explorer', position: { row: 0, col: 0, rowSpan: 1, colSpan: 1 }, tabs: [ws1Panel1Id] },
        { id: ws1Panel2Id, type: 'agent', title: 'Agent', position: { row: 0, col: 1, rowSpan: 1, colSpan: 1 }, tabs: [ws1Panel2Id] },
        { id: ws1Panel3Id, type: 'terminal', title: 'Terminal', position: { row: 1, col: 0, rowSpan: 1, colSpan: 2 }, tabs: [ws1Panel3Id] },
      ],
    },
    {
      id: 'ws-2',
      title: 'Workspace 2',
      position: { row: 0, col: 1, rowSpan: 1, colSpan: 1 },
      gridTemplate: { rows: 1, cols: 1 },
      rowHeights: [DEFAULT_ROW_HEIGHT],
      colWidths: [DEFAULT_COL_WIDTH],
      collapsed: false,
      panels: [
        { id: ws2Panel1Id, type: 'agent', title: 'Agent', position: { row: 0, col: 0, rowSpan: 1, colSpan: 1 }, tabs: [ws2Panel1Id] },
      ],
    },
  ]
}

function loadLayout(): LayoutState | null {
  try {
    const saved = localStorage.getItem('hyagent-layout-v2')
    if (saved) {
      const parsed = JSON.parse(saved)
      if (parsed.workspaces && Array.isArray(parsed.workspaces) && parsed.workspaces.length > 0) {
        // Migrate old format if needed
        if (!parsed.workspaceGrid) {
          parsed.workspaceGrid = { rows: 1, cols: 2, rowWeights: [1], colWeights: [1, 1] }
        }
        // Migrate to weights if old format
        if (parsed.workspaceGrid.rowHeights) {
          // Convert heights to weights (normalize to sum = rows count)
          const totalHeight = parsed.workspaceGrid.rowHeights.reduce((a, b) => a + b, 0)
          parsed.workspaceGrid.rowWeights = parsed.workspaceGrid.rowHeights.map(h => h / totalHeight * parsed.workspaceGrid.rows)
          delete parsed.workspaceGrid.rowHeights
        }
        if (parsed.workspaceGrid.colWidths) {
          const totalWidth = parsed.workspaceGrid.colWidths.reduce((a, b) => a + b, 0)
          parsed.workspaceGrid.colWeights = parsed.workspaceGrid.colWidths.map(w => w / totalWidth * parsed.workspaceGrid.cols)
          delete parsed.workspaceGrid.colWidths
        }
        if (!parsed.workspaceGrid.rowWeights) {
          parsed.workspaceGrid.rowWeights = Array(parsed.workspaceGrid.rows).fill(1)
        }
        if (!parsed.workspaceGrid.colWeights) {
          parsed.workspaceGrid.colWeights = Array(parsed.workspaceGrid.cols).fill(1)
        }
        // Delete old mode fields if present
        delete parsed.workspaceGrid.rowModes
        delete parsed.workspaceGrid.colModes
        parsed.workspaces = parsed.workspaces.map((ws: WorkspaceConfig) => ({
          ...ws,
          collapsed: ws.collapsed || false,
          rowHeights: ws.rowHeights || [DEFAULT_ROW_HEIGHT],
          colWidths: ws.colWidths || [DEFAULT_COL_WIDTH],
          gridTemplate: ws.gridTemplate || { rows: 1, cols: 1 },
          panels: (ws.panels || []).map((p: PanelConfig, i: number) => ({
            ...p,
            position: p.position || { row: 0, col: i % 2, rowSpan: 1, colSpan: 1 },
            tabs: p.tabs || [p.id],
          })),
        }))
        return parsed
      }
    }
  } catch (e) {
    console.error('Failed to load layout:', e)
  }
  return null
}

function saveLayout(state: LayoutState) {
  try {
    localStorage.setItem('hyagent-layout-v2', JSON.stringify(state))
  } catch (e) {
    console.error('Failed to save layout:', e)
  }
}

function makeInitialState(): LayoutState {
  const mode: 'simple' | 'pro' = 'pro'
  return {
    mode,
    activePanelId: null,
    activeWorkspaceId: 'ws-1',
    workspaceGrid: {
      rows: 1,
      cols: 2,
      rowWeights: [1],           // Equal proportions
      colWeights: [1, 1],         // Equal proportions
    },
    workspaces: makeDefaultWorkspaces(mode),
  }
}

const initialState: LayoutState = loadLayout() || makeInitialState()

const [layout, setLayout] = createStore<LayoutState>(initialState)

const [draggingPanelId, setDraggingPanelId] = createSignal<string | null>(null)
const [resizingPanelId, setResizingPanelId] = createSignal<string | null>(null)

// Helper: get occupied cells in a workspace
function getOccupiedCellsInWorkspace(workspaceId: string, excludePanelId?: string): Map<string, string> {
  const cells = new Map<string, string>()
  const ws = layout.workspaces.find(w => w.id === workspaceId)
  if (!ws) return cells

  ws.panels.forEach(p => {
    if (p.id === excludePanelId) return
    for (let r = p.position.row; r < p.position.row + p.position.rowSpan; r++) {
      for (let c = p.position.col; c < p.position.col + p.position.colSpan; c++) {
        cells.set(`${r}-${c}`, p.id)
      }
    }
  })
  return cells
}

function getEmptyCellsInWorkspace(workspaceId: string): Array<{ row: number; col: number }> {
  const ws = layout.workspaces.find(w => w.id === workspaceId)
  if (!ws) return []

  const occupied = getOccupiedCellsInWorkspace(workspaceId)
  const empty: Array<{ row: number; col: number }> = []
  for (let r = 0; r < ws.gridTemplate.rows; r++) {
    for (let c = 0; c < ws.gridTemplate.cols; c++) {
      if (!occupied.has(`${r}-${c}`)) {
        empty.push({ row: r, col: c })
      }
    }
  }
  return empty
}

function hasOverlapInWorkspace(workspaceId: string, excludeId: string, position: GridPosition): boolean {
  const occupied = getOccupiedCellsInWorkspace(workspaceId, excludeId)
  for (let r = position.row; r < position.row + position.rowSpan; r++) {
    for (let c = position.col; c < position.col + position.colSpan; c++) {
      if (occupied.has(`${r}-${c}`)) return true
    }
  }
  return false
}

function expandGridInWorkspace(workspaceId: string, position: GridPosition): { rows: number; cols: number } {
  const ws = layout.workspaces.find(w => w.id === workspaceId)
  if (!ws) return { rows: 1, cols: 1 }

  let { rows, cols } = ws.gridTemplate
  const neededRows = position.row + position.rowSpan
  const neededCols = position.col + position.colSpan

  if (neededRows > rows) rows = neededRows
  if (neededCols > cols) cols = neededCols

  return { rows, cols }
}

export function useLayout() {
  const persist = () => saveLayout(layout)

  return {
    layout,
    draggingPanelId,
    resizingPanelId,

    getEmptyCells: (workspaceId: string) => getEmptyCellsInWorkspace(workspaceId),

    setActiveWorkspace(workspaceId: string) {
      setLayout('activeWorkspaceId', workspaceId)
      const ws = layout.workspaces.find(w => w.id === workspaceId)
      if (ws && ws.panels.length > 0) {
        setLayout('activePanelId', ws.panels[0].id)
      }
      persist()
    },

    setMode(mode: 'simple' | 'pro') {
      const workspaces = makeDefaultWorkspaces(mode)
      setLayout('mode', mode)
      setLayout('workspaces', workspaces)
      setLayout('activeWorkspaceId', 'ws-1')
      setLayout('workspaceGrid', {
        rows: mode === 'simple' ? 1 : 1,
        cols: mode === 'simple' ? 1 : 2,
        rowWeights: [1],
        colWeights: mode === 'simple' ? [1] : [1, 1],
      })

      const firstWs = workspaces[0]
      if (firstWs && firstWs.panels.length > 0) {
        setLayout('activePanelId', firstWs.panels[0].id)
      }
      persist()
    },

    toggleWorkspaceCollapsed(workspaceId: string) {
      const ws = layout.workspaces.find(w => w.id === workspaceId)
      if (ws) {
        setLayout('workspaces', w => w.id === workspaceId, 'collapsed', !ws.collapsed)
        persist()
      }
    },

    // Panel operations within a workspace
    addPanelAt(workspaceId: string, type: PanelType, row: number, col: number) {
      const id = createPanelId(type)
      const title = type.charAt(0).toUpperCase() + type.slice(1)
      const position: GridPosition = { row, col, rowSpan: 1, colSpan: 1 }

      setLayout('workspaces', w => w.id === workspaceId, 'panels', (panels) => [...panels, {
        id, type, title, position, tabs: [id]
      }])
      setLayout('activePanelId', id)

      // Expand grid if needed
      const ws = layout.workspaces.find(w => w.id === workspaceId)
      if (ws) {
        const newGrid = expandGridInWorkspace(workspaceId, position)
        if (newGrid.rows !== ws.gridTemplate.rows || newGrid.cols !== ws.gridTemplate.cols) {
          setLayout('workspaces', w => w.id === workspaceId, 'gridTemplate', newGrid)
          while (layout.workspaces.find(w => w.id === workspaceId)!.rowHeights.length < newGrid.rows) {
            setLayout('workspaces', w => w.id === workspaceId, 'rowHeights', (h) => [...h, DEFAULT_ROW_HEIGHT])
          }
          while (layout.workspaces.find(w => w.id === workspaceId)!.colWidths.length < newGrid.cols) {
            setLayout('workspaces', w => w.id === workspaceId, 'colWidths', (w) => [...w, DEFAULT_COL_WIDTH])
          }
        }
      }

      persist()
      return id
    },

    addPanel(workspaceId: string, type: PanelType) {
      const ws = layout.workspaces.find(w => w.id === workspaceId)
      if (!ws) return

      const emptyCells = getEmptyCellsInWorkspace(workspaceId)

      if (emptyCells.length > 0) {
        this.addPanelAt(workspaceId, type, emptyCells[0].row, emptyCells[0].col)
      } else {
        this.addPanelAt(workspaceId, type, ws.gridTemplate.rows, 0)
        setLayout('workspaces', w => w.id === workspaceId, 'gridTemplate', (g) => ({ ...g, rows: ws.gridTemplate.rows + 1 }))
        setLayout('workspaces', w => w.id === workspaceId, 'rowHeights', (h) => [...h, DEFAULT_ROW_HEIGHT])
      }
    },

    addTabToPanel(workspaceId: string, panelId: string) {
      const ws = layout.workspaces.find(w => w.id === workspaceId)
      if (!ws) return

      const panel = ws.panels.find(p => p.id === panelId)
      if (!panel) return

      const newTabId = createPanelId(panel.type)
      const newTitle = panel.type.charAt(0).toUpperCase() + panel.type.slice(1)
      const emptyCells = getEmptyCellsInWorkspace(workspaceId)

      if (panel.type === 'explorer') {
        // Create new workspace for explorer
        const newWsId = createWorkspaceId()
        const newWsPosition = { row: 0, col: layout.workspaces.length, rowSpan: 1, colSpan: 1 }
        setLayout('workspaces', (workspaces) => [...workspaces, {
          id: newWsId,
          title: `Workspace ${layout.workspaces.length + 1}`,
          position: newWsPosition,
          gridTemplate: { rows: 1, cols: 1 },
          rowHeights: [DEFAULT_ROW_HEIGHT],
          colWidths: [DEFAULT_COL_WIDTH],
          collapsed: false,
          panels: [{
            id: newTabId,
            type: 'explorer',
            title: newTitle,
            position: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
            tabs: [newTabId],
          }],
        }])
      } else {
        // Add new panel to same workspace
        if (emptyCells.length > 0) {
          setLayout('workspaces', w => w.id === workspaceId, 'panels', (panels) => [...panels, {
            id: newTabId,
            type: panel.type,
            title: newTitle,
            position: { row: emptyCells[0].row, col: emptyCells[0].col, rowSpan: 1, colSpan: 1 },
            tabs: [newTabId],
          }])
        } else {
          setLayout('workspaces', w => w.id === workspaceId, 'panels', (panels) => [...panels, {
            id: newTabId,
            type: panel.type,
            title: newTitle,
            position: { row: ws.gridTemplate.rows, col: 0, rowSpan: 1, colSpan: 1 },
            tabs: [newTabId],
          }])
          setLayout('workspaces', w => w.id === workspaceId, 'gridTemplate', (g) => ({ ...g, rows: ws.gridTemplate.rows + 1 }))
          setLayout('workspaces', w => w.id === workspaceId, 'rowHeights', (h) => [...h, DEFAULT_ROW_HEIGHT])
        }
        setLayout('activePanelId', newTabId)
      }
      persist()
    },

    removePanel(workspaceId: string, panelId: string) {
      const ws = layout.workspaces.find(w => w.id === workspaceId)
      if (!ws || ws.panels.length <= 1) return

      const newPanels = ws.panels.filter((p) => p.id !== panelId)
      setLayout('workspaces', w => w.id === workspaceId, 'panels', newPanels)

      if (layout.activePanelId === panelId) {
        setLayout('activePanelId', newPanels.length > 0 ? newPanels[0].id : null)
      }
      persist()
    },

    setActivePanel(panelId: string | null) {
      setLayout('activePanelId', panelId)
      if (panelId) {
        for (const ws of layout.workspaces) {
          const panel = ws.panels.find(p => p.id === panelId)
          if (panel) {
            setLayout('activeWorkspaceId', ws.id)
            break
          }
        }
      }
    },

    movePanel(workspaceId: string, panelId: string, newPosition: GridPosition) {
      newPosition = {
        row: Math.max(0, newPosition.row),
        col: Math.max(0, newPosition.col),
        rowSpan: Math.max(1, newPosition.rowSpan),
        colSpan: Math.max(1, newPosition.colSpan)
      }

      if (hasOverlapInWorkspace(workspaceId, panelId, newPosition)) return

      const ws = layout.workspaces.find(w => w.id === workspaceId)
      if (!ws) return

      const newGrid = expandGridInWorkspace(workspaceId, newPosition)
      if (newGrid.rows !== ws.gridTemplate.rows || newGrid.cols !== ws.gridTemplate.cols) {
        setLayout('workspaces', w => w.id === workspaceId, 'gridTemplate', newGrid)
        while (layout.workspaces.find(w => w.id === workspaceId)!.rowHeights.length < newGrid.rows) {
          setLayout('workspaces', w => w.id === workspaceId, 'rowHeights', (h) => [...h, DEFAULT_ROW_HEIGHT])
        }
        while (layout.workspaces.find(w => w.id === workspaceId)!.colWidths.length < newGrid.cols) {
          setLayout('workspaces', w => w.id === workspaceId, 'colWidths', (w) => [...w, DEFAULT_COL_WIDTH])
        }
      }

      setLayout('workspaces', w => w.id === workspaceId, 'panels', (panels) =>
        panels.map((p) => p.id === panelId ? { ...p, position: newPosition } : p)
      )
      persist()
    },

    resizePanel(workspaceId: string, panelId: string, newRowSpan: number, newColSpan: number) {
      const ws = layout.workspaces.find(w => w.id === workspaceId)
      if (!ws) return

      const panel = ws.panels.find(p => p.id === panelId)
      if (!panel) return

      newRowSpan = Math.max(1, newRowSpan)
      newColSpan = Math.max(1, newColSpan)

      const newPosition: GridPosition = {
        row: panel.position.row,
        col: panel.position.col,
        rowSpan: newRowSpan,
        colSpan: newColSpan
      }

      if (hasOverlapInWorkspace(workspaceId, panelId, newPosition)) return

      const newGrid = expandGridInWorkspace(workspaceId, newPosition)
      if (newGrid.rows !== ws.gridTemplate.rows || newGrid.cols !== ws.gridTemplate.cols) {
        setLayout('workspaces', w => w.id === workspaceId, 'gridTemplate', newGrid)
        while (layout.workspaces.find(w => w.id === workspaceId)!.rowHeights.length < newGrid.rows) {
          setLayout('workspaces', w => w.id === workspaceId, 'rowHeights', (h) => [...h, DEFAULT_ROW_HEIGHT])
        }
        while (layout.workspaces.find(w => w.id === workspaceId)!.colWidths.length < newGrid.cols) {
          setLayout('workspaces', w => w.id === workspaceId, 'colWidths', (w) => [...w, DEFAULT_COL_WIDTH])
        }
      }

      setLayout('workspaces', w => w.id === workspaceId, 'panels', (panels) =>
        panels.map((p) => p.id === panelId ? { ...p, position: newPosition } : p)
      )
      persist()
    },

    // Grid line resize (workspace-level) - updates weights proportionally
    resizeRowHeight(rowIndex: number, delta: number, availHeight: number, totalRowWeight: number) {
      const { rowWeights, rows } = layout.workspaceGrid
      // Calculate current pixel sizes from weights (availHeight is the space for fr units, excluding gaps/padding)
      const currentHeights = rowWeights.map(w => availHeight * w / totalRowWeight)

      // Adjust the heights
      const adjustedHeights = [...currentHeights]
      adjustedHeights[rowIndex] = Math.max(50, adjustedHeights[rowIndex] + delta)
      // Also adjust the neighbor (reduce neighbor if this one grows)
      if (rowIndex < rows - 1) {
        adjustedHeights[rowIndex + 1] = Math.max(50, adjustedHeights[rowIndex + 1] - delta)
      }

      // Convert back to weights
      const totalAdjusted = adjustedHeights.reduce((a, b) => a + b, 0)
      const newWeights = adjustedHeights.map(h => h / totalAdjusted * totalRowWeight)

      setLayout('workspaceGrid', 'rowWeights', newWeights)
      persist()
    },

    resizeColWidth(colIndex: number, delta: number, availWidth: number, totalColWeight: number) {
      const { colWeights, cols } = layout.workspaceGrid
      // Calculate current pixel sizes from weights (availWidth is the space for fr units, excluding gaps/padding)
      const currentWidths = colWeights.map(w => availWidth * w / totalColWeight)

      // Adjust the widths
      const adjustedWidths = [...currentWidths]
      adjustedWidths[colIndex] = Math.max(50, adjustedWidths[colIndex] + delta)
      // Also adjust the neighbor (reduce neighbor if this one grows)
      if (colIndex < cols - 1) {
        adjustedWidths[colIndex + 1] = Math.max(50, adjustedWidths[colIndex + 1] - delta)
      }

      // Convert back to weights
      const totalAdjusted = adjustedWidths.reduce((a, b) => a + b, 0)
      const newWeights = adjustedWidths.map(w => w / totalAdjusted * totalColWeight)

      setLayout('workspaceGrid', 'colWeights', newWeights)
      persist()
    },

    // Recalculate sizes from weights after window resize
    recalculateFromWeights(containerHeight: number, containerWidth: number) {
      const { rowWeights, colWeights } = layout.workspaceGrid

      const totalRowWeight = rowWeights.reduce((a, b) => a + b, 0)
      const totalColWeight = colWeights.reduce((a, b) => a + b, 0)

      // We store weights, but for rendering we need actual sizes
      // This is calculated in the component using the weights
      // Just persist the current state
      persist()
    },

    // Get actual pixel sizes from weights
    getRowHeights(containerHeight: number): number[] {
      const { rowWeights } = layout.workspaceGrid
      const totalWeight = rowWeights.reduce((a, b) => a + b, 0)
      return rowWeights.map(w => containerHeight * w / totalWeight)
    },

    getColWidths(containerWidth: number): number[] {
      const { colWeights } = layout.workspaceGrid
      const totalWeight = colWeights.reduce((a, b) => a + b, 0)
      return colWeights.map(w => containerWidth * w / totalWeight)
    },

    // Panel grid resize (workspace internal)
    resizePanelGridRow(workspaceId: string, rowIndex: number, delta: number) {
      const ws = layout.workspaces.find(w => w.id === workspaceId)
      if (!ws) return

      const newHeights = [...ws.rowHeights]
      newHeights[rowIndex] = Math.max(50, newHeights[rowIndex] + delta)
      setLayout('workspaces', w => w.id === workspaceId, 'rowHeights', newHeights)
      persist()
    },

    resizePanelGridCol(workspaceId: string, colIndex: number, delta: number) {
      const ws = layout.workspaces.find(w => w.id === workspaceId)
      if (!ws) return

      const newWidths = [...ws.colWidths]
      newWidths[colIndex] = Math.max(50, newWidths[colIndex] + delta)
      setLayout('workspaces', w => w.id === workspaceId, 'colWidths', newWidths)
      persist()
    },

    // Workspace grid operations
    addWorkspaceRow() {
      const newRows = layout.workspaceGrid.rows + 1
      // Add new row with equal weight
      setLayout('workspaceGrid', 'rows', newRows)
      setLayout('workspaceGrid', 'rowWeights', [...layout.workspaceGrid.rowWeights, 1])
      persist()
    },

    removeWorkspaceRow() {
      if (layout.workspaceGrid.rows <= 1) return
      const lastRow = layout.workspaceGrid.rows - 1
      const hasSpanningWorkspace = layout.workspaces.some(w =>
        w.position.row + w.position.rowSpan - 1 >= lastRow
      )
      if (hasSpanningWorkspace) return

      setLayout('workspaceGrid', 'rows', layout.workspaceGrid.rows - 1)
      setLayout('workspaceGrid', 'rowWeights', layout.workspaceGrid.rowWeights.slice(0, -1))
      persist()
    },

    addWorkspaceCol() {
      const newCols = layout.workspaceGrid.cols + 1
      // Add new col with equal weight
      setLayout('workspaceGrid', 'cols', newCols)
      setLayout('workspaceGrid', 'colWeights', [...layout.workspaceGrid.colWeights, 1])
      persist()
    },

    removeWorkspaceCol() {
      if (layout.workspaceGrid.cols <= 1) return
      const lastCol = layout.workspaceGrid.cols - 1
      const hasSpanningWorkspace = layout.workspaces.some(w =>
        w.position.col + w.position.colSpan - 1 >= lastCol
      )
      if (hasSpanningWorkspace) return

      setLayout('workspaceGrid', 'cols', layout.workspaceGrid.cols - 1)
      setLayout('workspaceGrid', 'colWeights', layout.workspaceGrid.colWeights.slice(0, -1))
      persist()
    },

    // Workspace CRUD
    addWorkspace() {
      // Find first empty cell in the grid
      const { rows, cols } = layout.workspaceGrid
      const occupied = new Set<string>()

      layout.workspaces.forEach(ws => {
        for (let r = ws.position.row; r < ws.position.row + ws.position.rowSpan; r++) {
          for (let c = ws.position.col; c < ws.position.col + ws.position.colSpan; c++) {
            occupied.add(`${r}-${c}`)
          }
        }
      })

      let newPosition = { row: 0, col: 0, rowSpan: 1, colSpan: 1 }
      let found = false
      for (let r = 0; r < rows && !found; r++) {
        for (let c = 0; c < cols && !found; c++) {
          if (!occupied.has(`${r}-${c}`)) {
            newPosition = { row: r, col: c, rowSpan: 1, colSpan: 1 }
            found = true
          }
        }
      }

      // If no empty cell, expand the grid
      if (!found) {
        const newRow = Math.floor(layout.workspaces.length / cols)
        const newCol = layout.workspaces.length % cols
        newPosition = { row: newRow, col: newCol, rowSpan: 1, colSpan: 1 }

        if (newPosition.row >= rows) {
          setLayout('workspaceGrid', 'rows', newPosition.row + 1)
          setLayout('workspaceGrid', 'rowWeights', [...layout.workspaceGrid.rowWeights, 1])
        }
        if (newPosition.col >= cols) {
          setLayout('workspaceGrid', 'cols', newPosition.col + 1)
          setLayout('workspaceGrid', 'colWeights', [...layout.workspaceGrid.colWeights, 1])
        }
      }

      const newId = createWorkspaceId()
      setLayout('workspaces', (workspaces) => [...workspaces, {
        id: newId,
        title: `Workspace ${workspaces.length + 1}`,
        position: newPosition,
        gridTemplate: { rows: 1, cols: 1 },
        rowHeights: [DEFAULT_ROW_HEIGHT],
        colWidths: [DEFAULT_COL_WIDTH],
        collapsed: false,
        panels: [],
      }])

      setLayout('activeWorkspaceId', newId)
      persist()
      return newId
    },

    removeWorkspace(workspaceId: string) {
      if (layout.workspaces.length <= 1) return

      const newWorkspaces = layout.workspaces.filter(w => w.id !== workspaceId)
      setLayout('workspaces', newWorkspaces)

      if (layout.activeWorkspaceId === workspaceId) {
        setLayout('activeWorkspaceId', newWorkspaces[0]?.id || null)
      }
      persist()
    },

    // Tab operations
    moveTab(tabId: string, sourceWorkspaceId: string, sourcePanelId: string, targetWorkspaceId: string, targetPanelId: string) {
      if (sourceWorkspaceId === targetWorkspaceId && sourcePanelId === targetPanelId) return

      if (sourceWorkspaceId !== targetWorkspaceId) {
        // Move tab to different workspace - remove from source, add to target
        const sourceWs = layout.workspaces.find(w => w.id === sourceWorkspaceId)
        const targetWs = layout.workspaces.find(w => w.id === targetWorkspaceId)
        if (!sourceWs || !targetWs) return

        const sourcePanel = sourceWs.panels.find(p => p.id === sourcePanelId)
        if (!sourcePanel) return

        const tabPanel = sourceWs.panels.find(p => p.tabs.includes(tabId))
        if (!tabPanel) return

        // Remove tab from source panel
        if (sourcePanel.tabs.length <= 1) {
          // Remove source panel entirely
          setLayout('workspaces', w => w.id === sourceWorkspaceId, 'panels', (panels) =>
            panels.filter(p => p.id !== sourcePanelId)
          )
        } else {
          setLayout('workspaces', w => w.id === sourceWorkspaceId, 'panels', (panels) =>
            panels.map(p => p.id === sourcePanelId ? { ...p, tabs: p.tabs.filter(t => t !== tabId) } : p)
          )
        }

        // Add tab to target panel
        setLayout('workspaces', w => w.id === targetWorkspaceId, 'panels', (panels) =>
          panels.map(p => p.id === targetPanelId ? { ...p, tabs: [...p.tabs, tabId] } : p)
        )
      } else {
        // Same workspace, different panel
        setLayout('workspaces', w => w.id === sourceWorkspaceId, 'panels', (panels) => {
          const source = panels.find(p => p.id === sourcePanelId)
          const target = panels.find(p => p.id === targetPanelId)
          if (!source || !target) return panels
          if (!source.tabs.includes(tabId)) return panels
          if (source.tabs.length <= 1) return panels

          return panels
            .map(p => {
              if (p.id === sourcePanelId) return { ...p, tabs: p.tabs.filter(t => t !== tabId) }
              if (p.id === targetPanelId) return { ...p, tabs: [...p.tabs, tabId] }
              return p
            })
        })
      }
      persist()
    },

    mergePanels(sourceWorkspaceId: string, sourcePanelId: string, targetWorkspaceId: string, targetPanelId: string) {
      if (sourceWorkspaceId !== targetWorkspaceId || sourcePanelId === targetPanelId) return

      setLayout('workspaces', w => w.id === sourceWorkspaceId, 'panels', (panels) => {
        const source = panels.find(p => p.id === sourcePanelId)
        const target = panels.find(p => p.id === targetPanelId)
        if (!source || !target) return panels
        if (source.type !== target.type) return panels

        const mergedTabs = [...target.tabs, ...source.tabs]

        return panels
          .filter(p => p.id !== sourcePanelId)
          .map(p => p.id === targetPanelId ? { ...p, tabs: mergedTabs } : p)
      })
      persist()
    },

    startDragging(panelId: string) {
      setDraggingPanelId(panelId)
    },

    stopDragging() {
      setDraggingPanelId(null)
    },

    startResizing(panelId: string) {
      setResizingPanelId(panelId)
    },

    stopResizing() {
      setResizingPanelId(null)
    },

    // Workspace position/spanning operations
    moveWorkspace(workspaceId: string, newRow: number, newCol: number) {
      const ws = layout.workspaces.find(w => w.id === workspaceId)
      if (!ws) return

      // Check bounds
      if (newRow < 0 || newCol < 0) return
      if (newRow + ws.position.rowSpan > layout.workspaceGrid.rows) return
      if (newCol + ws.position.colSpan > layout.workspaceGrid.cols) return

      // Check overlap
      if (hasOverlapInWorkspaceForWorkspaces(workspaceId, newRow, newCol, ws.position.rowSpan, ws.position.colSpan)) return

      setLayout('workspaces', w => w.id === workspaceId, 'position', {
        row: newRow,
        col: newCol,
        rowSpan: ws.position.rowSpan,
        colSpan: ws.position.colSpan,
      })
      persist()
    },

    resizeWorkspace(workspaceId: string, newRowSpan: number, newColSpan: number) {
      const ws = layout.workspaces.find(w => w.id === workspaceId)
      if (!ws) return

      // Validate bounds
      newRowSpan = Math.max(1, newRowSpan)
      newColSpan = Math.max(1, newColSpan)
      newRowSpan = Math.min(newRowSpan, layout.workspaceGrid.rows - ws.position.row)
      newColSpan = Math.min(newColSpan, layout.workspaceGrid.cols - ws.position.col)

      // Check overlap
      if (hasOverlapInWorkspaceForWorkspaces(workspaceId, ws.position.row, ws.position.col, newRowSpan, newColSpan)) return

      setLayout('workspaces', w => w.id === workspaceId, 'position', {
        row: ws.position.row,
        col: ws.position.col,
        rowSpan: newRowSpan,
        colSpan: newColSpan,
      })
      persist()
    },
  }
}

// Helper function to check overlap for workspace grid (separate from panel grid overlap)
function hasOverlapInWorkspaceForWorkspaces(excludeWsId: string, row: number, col: number, rowSpan: number, colSpan: number): boolean {
  for (const ws of layout.workspaces) {
    if (ws.id === excludeWsId) continue

    const wsRowEnd = ws.position.row + ws.position.rowSpan
    const wsColEnd = ws.position.col + ws.position.colSpan
    const targetRowEnd = row + rowSpan
    const targetColEnd = col + colSpan

    if (row < wsRowEnd && targetRowEnd > ws.position.row && col < wsColEnd && targetColEnd > ws.position.col) {
      return true
    }
  }
  return false
}

export function getDefaultLayout(mode: 'simple' | 'pro'): WorkspaceConfig[] {
  return makeDefaultWorkspaces(mode)
}
