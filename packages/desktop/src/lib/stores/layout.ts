import { createStore } from 'solid-js/store'
import { createSignal } from 'solid-js'

export type PanelType = 'agent' | 'console' | 'explorer' | 'editor' | 'preview' | 'settings'

export interface PanelConfig {
  id: string
  type: PanelType
  title: string
  minimized: boolean
  floating: boolean
  bounds?: {
    x: number
    y: number
    width: number
    height: number
  }
}

export interface LayoutState {
  panels: PanelConfig[]
  mode: 'simple' | 'pro'
  activePanelId: string | null
}

const defaultSimplePanels: PanelConfig[] = [
  { id: 'agent-1', type: 'agent', title: 'Agent-1', minimized: false, floating: false },
  { id: 'agent-2', type: 'agent', title: 'Agent-2', minimized: false, floating: false },
  { id: 'agent-3', type: 'agent', title: 'Agent-3', minimized: false, floating: false },
]

const defaultProPanels: PanelConfig[] = [
  { id: 'agent-pool', type: 'explorer', title: 'Agent Pool', minimized: false, floating: false },
  { id: 'agent-1', type: 'agent', title: 'Agent-1', minimized: false, floating: false },
  { id: 'agent-2', type: 'agent', title: 'Agent-2', minimized: false, floating: false },
  { id: 'console', type: 'console', title: 'Console', minimized: false, floating: false },
  { id: 'editor', type: 'editor', title: 'Editor', minimized: false, floating: false },
]

const [layout, setLayout] = createStore<LayoutState>({
  panels: defaultSimplePanels,
  mode: 'simple',
  activePanelId: null,
})

const [draggingPanel, setDraggingPanel] = createSignal<string | null>(null)
const [resizingPanel, setResizingPanel] = createSignal<string | null>(null)

export function useLayout() {
  return {
    layout,
    draggingPanel,
    resizingPanel,

    setMode(mode: 'simple' | 'pro') {
      setLayout('mode', mode)
      setLayout('panels', mode === 'simple' ? defaultSimplePanels : defaultProPanels)
    },

    addPanel(type: PanelType) {
      const id = `${type}-${Date.now()}`
      const title = `${type.charAt(0).toUpperCase() + type.slice(1)}-${layout.panels.length + 1}`
      setLayout('panels', (panels) => [
        ...panels,
        { id, type, title, minimized: false, floating: false },
      ])
      return id
    },

    removePanel(id: string) {
      setLayout('panels', (panels) => panels.filter((p) => p.id !== id))
    },

    updatePanelBounds(id: string, bounds: PanelConfig['bounds']) {
      setLayout(
        'panels',
        (p) => p.id === id,
        'bounds',
        bounds
      )
    },

    toggleMinimize(id: string) {
      setLayout(
        'panels',
        (p) => p.id === id,
        'minimized',
        (m) => !m
      )
    },

    toggleFloat(id: string) {
      setLayout(
        'panels',
        (p) => p.id === id,
        'floating',
        (f) => !f
      )
    },

    setActivePanel(id: string | null) {
      setLayout('activePanelId', id)
    },

    startDragging(id: string) {
      setDraggingPanel(id)
    },

    stopDragging() {
      setDraggingPanel(null)
    },

    startResizing(id: string) {
      setResizingPanel(id)
    },

    stopResizing() {
      setResizingPanel(null)
    },
  }
}

export function getDefaultLayout(mode: 'simple' | 'pro'): PanelConfig[] {
  return mode === 'simple' ? [...defaultSimplePanels] : [...defaultProPanels]
}
