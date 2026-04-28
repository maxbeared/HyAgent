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
  tabs: string[] // IDs of panels tabbed together in this cell
}

export interface LayoutState {
  panels: PanelConfig[]
  mode: 'simple' | 'pro'
  activePanelId: string | null
  gridTemplate: { rows: number; cols: number }
}

const defaultSimplePanels: PanelConfig[] = [
  { id: 'agent-1', type: 'agent', title: 'Agent', position: { row: 0, col: 0, rowSpan: 1, colSpan: 1 }, tabs: ['agent-1'] },
]

const defaultProPanels: PanelConfig[] = [
  { id: 'explorer', type: 'explorer', title: 'Explorer', position: { row: 0, col: 0, rowSpan: 1, colSpan: 1 }, tabs: ['explorer'] },
  { id: 'agent-1', type: 'agent', title: 'Agent', position: { row: 0, col: 1, rowSpan: 1, colSpan: 1 }, tabs: ['agent-1'] },
  { id: 'terminal', type: 'terminal', title: 'Terminal', position: { row: 1, col: 0, rowSpan: 1, colSpan: 2 }, tabs: ['terminal'] },
]

function loadLayout(): LayoutState | null {
  try {
    const saved = localStorage.getItem('hyagent-layout')
    if (saved) {
      const parsed = JSON.parse(saved)
      if (parsed.panels && Array.isArray(parsed.panels) && parsed.panels.length > 0) {
        // Ensure gridTemplate exists (added in later version)
        if (!parsed.gridTemplate) {
          parsed.gridTemplate = { rows: 2, cols: 2 }
        }
        // Migrate old panels without position/tabs
        parsed.panels = parsed.panels.map((panel: PanelConfig, index: number) => {
          if (!panel.position) {
            panel.position = { row: Math.floor(index / 2), col: index % 2, rowSpan: 1, colSpan: 1 }
          }
          if (!panel.tabs) {
            panel.tabs = [panel.id]
          }
          return panel
        })
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
    localStorage.setItem('hyagent-layout', JSON.stringify(state))
  } catch (e) {
    console.error('Failed to save layout:', e)
  }
}

const initialState: LayoutState = loadLayout() || {
  panels: defaultSimplePanels,
  mode: 'simple' as const,
  activePanelId: null,
  gridTemplate: { rows: 1, cols: 1 },
}

// Ensure all panels have required fields
initialState.panels = initialState.panels.map((panel, index) => ({
  ...panel,
  position: panel.position || { row: Math.floor(index / 2), col: index % 2, rowSpan: 1, colSpan: 1 },
  tabs: panel.tabs || [panel.id],
}))

const [layout, setLayout] = createStore<LayoutState>(initialState)

// Track which panel is being dragged or resized
const [draggingPanelId, setDraggingPanelId] = createSignal<string | null>(null)
const [resizingPanelId, setResizingPanelId] = createSignal<string | null>(null)

export function useLayout() {
  const persist = () => saveLayout(layout)

  return {
    layout,
    draggingPanelId,
    resizingPanelId,

    setMode(mode: 'simple' | 'pro') {
      setLayout('mode', mode)
      if (mode === 'simple') {
        setLayout('panels', [...defaultSimplePanels])
        setLayout('gridTemplate', { rows: 1, cols: 1 })
      } else {
        setLayout('panels', [...defaultProPanels])
        setLayout('gridTemplate', { rows: 2, cols: 2 })
      }
      setLayout('activePanelId', layout.panels[0]?.id || null)
      persist()
    },

    addPanel(type: PanelType) {
      const id = `${type}-${Date.now()}`
      const title = type.charAt(0).toUpperCase() + type.slice(1)

      // Find next available position
      const { rows, cols } = layout.gridTemplate
      let position: GridPosition = { row: 0, col: 0, rowSpan: 1, colSpan: 1 }

      // Simple mode: just replace the single panel
      if (layout.mode === 'simple') {
        setLayout('panels', [{ id, type, title, position, tabs: [id] }])
        setLayout('activePanelId', id)
        persist()
        return id
      }

      // Pro mode: find an empty cell or expand grid
      const occupiedCells = new Set<string>()
      layout.panels.forEach(p => {
        for (let r = p.position.row; r < p.position.row + p.position.rowSpan; r++) {
          for (let c = p.position.col; c < p.position.col + p.position.colSpan; c++) {
            occupiedCells.add(`${r}-${c}`)
          }
        }
      })

      // Find first empty cell
      let found = false
      for (let r = 0; r < rows && !found; r++) {
        for (let c = 0; c < cols && !found; c++) {
          if (!occupiedCells.has(`${r}-${c}`)) {
            position = { row: r, col: c, rowSpan: 1, colSpan: 1 }
            found = true
          }
        }
      }

      // If no empty cell, expand the grid
      if (!found) {
        position = { row: rows - 1, col: 0, rowSpan: 1, colSpan: cols }
        setLayout('gridTemplate', { rows: rows + 1, cols })
      }

      setLayout('panels', (panels) => [...panels, { id, type, title, position, tabs: [id] }])
      setLayout('activePanelId', id)
      persist()
      return id
    },

    removePanel(id: string) {
      if (layout.panels.length <= 1) return // Keep at least one panel

      setLayout('panels', (panels) => panels.filter((p) => p.id !== id))
      if (layout.activePanelId === id) {
        const remaining = layout.panels.filter((p) => p.id !== id)
        setLayout('activePanelId', remaining.length > 0 ? remaining[0].id : null)
      }
      persist()
    },

    setActivePanel(id: string | null) {
      setLayout('activePanelId', id)
    },

    movePanel(panelId: string, newPosition: GridPosition) {
      setLayout('panels', (panels) =>
        panels.map((p) =>
          p.id === panelId ? { ...p, position: newPosition } : p
        )
      )
      persist()
    },

    resizePanel(panelId: string, newRowSpan: number, newColSpan: number) {
      setLayout('panels', (panels) =>
        panels.map((p) =>
          p.id === panelId
            ? { ...p, position: { ...p.position, rowSpan: newRowSpan, colSpan: newColSpan } }
            : p
        )
      )
      persist()
    },

    mergeTabs(sourceId: string, targetId: string) {
      // Move all tabs from source to target panel
      setLayout('panels', (panels) => {
        const source = panels.find(p => p.id === sourceId)
        const target = panels.find(p => p.id === targetId)
        if (!source || !target) return panels

        const mergedTabs = [...target.tabs, ...source.tabs]
        const mergedTitle = target.title

        return panels
          .filter(p => p.id !== sourceId)
          .map(p => p.id === targetId ? { ...p, tabs: mergedTabs, title: mergedTitle } : p)
      })
      persist()
    },

    splitTab(tabId: string) {
      // Split a tab into its own panel
      const panel = layout.panels.find(p => p.tabs.includes(tabId))
      if (!panel || panel.tabs.length <= 1) return

      setLayout('panels', (panels) => {
        const tabIndex = panel.tabs.indexOf(tabId)
        const newTabs = [...panel.tabs]
        newTabs.splice(tabIndex, 1)

        return [
          ...panels.map(p =>
            p.id === panel.id ? { ...p, tabs: newTabs } : p
          ),
          {
            id: tabId,
            type: panel.type,
            title: `Tab ${tabId.slice(-4)}`,
            position: { row: panel.position.row + 1, col: panel.position.col, rowSpan: 1, colSpan: 1 },
            tabs: [tabId]
          }
        ]
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
  }
}

export function getDefaultLayout(mode: 'simple' | 'pro'): PanelConfig[] {
  return mode === 'simple' ? [...defaultSimplePanels] : [...defaultProPanels]
}