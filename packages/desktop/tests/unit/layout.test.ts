import { describe, it, expect, beforeEach } from 'vitest'
import { useLayout, getDefaultLayout, type PanelType, type PanelConfig } from '../../src/lib/stores/layout'

describe('Layout Store', () => {
  // The store is a singleton with module-level state
  const layout = useLayout()

  beforeEach(() => {
    // Reset to simple mode before each test to avoid state pollution
    layout.setMode('simple')
  })

  describe('initial state', () => {
    it('should start in simple mode', () => {
      layout.setMode('simple')
      expect(layout.layout.mode).toBe('simple')
    })

    it('should have default simple panels', () => {
      layout.setMode('simple')
      expect(layout.layout.panels).toHaveLength(3)
      expect(layout.layout.panels.every((p) => p.type === 'agent')).toBe(true)
    })

    it('should have no active panel initially after reset', () => {
      layout.setActivePanel(null)
      expect(layout.layout.activePanelId).toBeNull()
    })
  })

  describe('setMode', () => {
    it('should switch to pro mode', () => {
      layout.setMode('pro')
      expect(layout.layout.mode).toBe('pro')
      expect(layout.layout.panels.length).toBeGreaterThan(3)
    })

    it('should switch back to simple mode', () => {
      layout.setMode('pro')
      layout.setMode('simple')

      expect(layout.layout.mode).toBe('simple')
      expect(layout.layout.panels).toHaveLength(3)
    })

    it('should reset panels when switching modes', () => {
      const initialSimplePanels = layout.layout.panels.length

      layout.setMode('pro')
      layout.setMode('simple')

      expect(layout.layout.panels.length).toBe(initialSimplePanels)
    })
  })

  describe('addPanel', () => {
    it('should add a new panel', () => {
      const initialCount = layout.layout.panels.length

      const newId = layout.addPanel('console')

      expect(layout.layout.panels.length).toBe(initialCount + 1)
      expect(newId).toBeTruthy()
    })

    it('should add panel with correct type', () => {
      layout.addPanel('explorer')

      const addedPanel = layout.layout.panels.find((p) => p.type === 'explorer')
      expect(addedPanel).toBeDefined()
      expect(addedPanel?.type).toBe('explorer')
    })

    it('should generate valid panel ids', () => {
      const id1 = layout.addPanel('editor')

      // IDs are timestamp-based and may collide if created in same millisecond
      expect(id1).toMatch(/^editor-\d+$/)
    })

    it('should add panel with default title', () => {
      layout.addPanel('editor')

      const addedPanel = layout.layout.panels.find((p) => p.type === 'editor')
      expect(addedPanel?.title).toContain('Editor')
    })

    it('should add panel as not minimized by default', () => {
      layout.addPanel('console')

      const addedPanel = layout.layout.panels.find((p) => p.type === 'console')
      expect(addedPanel?.minimized).toBe(false)
    })

    it('should add panel as not floating by default', () => {
      layout.addPanel('preview')

      const addedPanel = layout.layout.panels.find((p) => p.type === 'preview')
      expect(addedPanel?.floating).toBe(false)
    })
  })

  describe('removePanel', () => {
    it('should remove panel by id', () => {
      const panelId = layout.layout.panels[0].id
      const initialCount = layout.layout.panels.length

      layout.removePanel(panelId)

      expect(layout.layout.panels.length).toBe(initialCount - 1)
      expect(layout.layout.panels.find((p) => p.id === panelId)).toBeUndefined()
    })

    it('should not error when removing non-existent panel', () => {
      const initialCount = layout.layout.panels.length

      layout.removePanel('non-existent-id')

      expect(layout.layout.panels.length).toBe(initialCount)
    })
  })

  describe('toggleMinimize', () => {
    it('should toggle panel minimize state', () => {
      const panelId = layout.layout.panels[0].id
      const initialState = layout.layout.panels[0].minimized

      layout.toggleMinimize(panelId)

      const panel = layout.layout.panels.find((p) => p.id === panelId)
      expect(panel?.minimized).toBe(!initialState)
    })

    it('should toggle back to original state', () => {
      const panelId = layout.layout.panels[0].id
      const originalState = layout.layout.panels[0].minimized

      layout.toggleMinimize(panelId)
      layout.toggleMinimize(panelId)

      const panel = layout.layout.panels.find((p) => p.id === panelId)
      expect(panel?.minimized).toBe(originalState)
    })
  })

  describe('toggleFloat', () => {
    it('should toggle panel float state', () => {
      const panelId = layout.layout.panels[0].id
      const initialState = layout.layout.panels[0].floating

      layout.toggleFloat(panelId)

      const panel = layout.layout.panels.find((p) => p.id === panelId)
      expect(panel?.floating).toBe(!initialState)
    })
  })

  describe('updatePanelBounds', () => {
    it('should update panel bounds', () => {
      const panelId = layout.layout.panels[0].id
      const bounds = { x: 100, y: 200, width: 400, height: 300 }

      layout.updatePanelBounds(panelId, bounds)

      const panel = layout.layout.panels.find((p) => p.id === panelId)
      expect(panel?.bounds).toEqual(bounds)
    })

    it('should update only provided bounds properties', () => {
      const panelId = layout.layout.panels[0].id

      layout.updatePanelBounds(panelId, { x: 100, y: 200 })

      const panel = layout.layout.panels.find((p) => p.id === panelId)
      expect(panel?.bounds?.x).toBe(100)
      expect(panel?.bounds?.y).toBe(200)
    })
  })

  describe('setActivePanel', () => {
    it('should set active panel id', () => {
      const panelId = layout.layout.panels[0].id

      layout.setActivePanel(panelId)

      expect(layout.layout.activePanelId).toBe(panelId)
    })

    it('should allow setting null as active panel', () => {
      const panelId = layout.layout.panels[0].id

      layout.setActivePanel(panelId)
      layout.setActivePanel(null)

      expect(layout.layout.activePanelId).toBeNull()
    })
  })

  describe('dragging state', () => {
    it('should track dragging panel id', () => {
      const panelId = layout.layout.panels[0].id

      layout.startDragging(panelId)

      expect(layout.draggingPanel()).toBe(panelId)
    })

    it('should clear dragging state', () => {
      const panelId = layout.layout.panels[0].id

      layout.startDragging(panelId)
      layout.stopDragging()

      expect(layout.draggingPanel()).toBeNull()
    })
  })

  describe('resizing state', () => {
    it('should track resizing panel id', () => {
      const panelId = layout.layout.panels[0].id

      layout.startResizing(panelId)

      expect(layout.resizingPanel()).toBe(panelId)
    })

    it('should clear resizing state', () => {
      const panelId = layout.layout.panels[0].id

      layout.startResizing(panelId)
      layout.stopResizing()

      expect(layout.resizingPanel()).toBeNull()
    })
  })

  describe('getDefaultLayout', () => {
    it('should return simple mode panels', () => {
      const panels = getDefaultLayout('simple')

      expect(panels).toHaveLength(3)
      expect(panels.every((p) => p.type === 'agent')).toBe(true)
    })

    it('should return pro mode panels', () => {
      const panels = getDefaultLayout('pro')

      expect(panels.length).toBeGreaterThan(3)
      const types = panels.map((p) => p.type)
      expect(types).toContain('explorer')
      expect(types).toContain('console')
      expect(types).toContain('editor')
    })

    it('should return a new array instance each time', () => {
      const panels1 = getDefaultLayout('simple')
      const panels2 = getDefaultLayout('simple')

      expect(panels1).not.toBe(panels2)
    })
  })
})

describe('PanelType', () => {
  it('should define valid panel types', () => {
    const validTypes: PanelType[] = ['agent', 'console', 'explorer', 'editor', 'preview', 'settings']

    validTypes.forEach((type) => {
      const panel: PanelConfig = {
        id: `panel-${type}`,
        type,
        title: `${type} panel`,
        minimized: false,
        floating: false,
      }
      expect(panel.type).toBe(type)
    })
  })
})
