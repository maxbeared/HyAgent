import { describe, it, expect, beforeEach } from 'vitest'
import { useLayout, getDefaultLayout, type PanelType, type PanelConfig } from '../../src/lib/stores/layout'

describe('Layout Store', () => {
  const layout = useLayout()

  beforeEach(() => {
    layout.setMode('simple')
  })

  describe('initial state', () => {
    it('should start in simple mode', () => {
      layout.setMode('simple')
      expect(layout.layout.mode).toBe('simple')
    })

    it('should have default simple panels', () => {
      layout.setMode('simple')
      expect(layout.layout.panels).toHaveLength(1)
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
      expect(layout.layout.panels.length).toBeGreaterThan(1)
    })

    it('should switch back to simple mode', () => {
      layout.setMode('pro')
      layout.setMode('simple')

      expect(layout.layout.mode).toBe('simple')
      expect(layout.layout.panels).toHaveLength(1)
    })

    it('should reset panels when switching modes', () => {
      const initialSimplePanels = layout.layout.panels.length

      layout.setMode('pro')
      layout.setMode('simple')

      expect(layout.layout.panels.length).toBe(initialSimplePanels)
    })
  })

  describe('addPanel', () => {
    it('should add a new panel in pro mode', () => {
      layout.setMode('pro')
      const initialCount = layout.layout.panels.length

      const newId = layout.addPanel('terminal')

      expect(layout.layout.panels.length).toBe(initialCount + 1)
      expect(newId).toBeTruthy()
    })

    it('should add panel with correct type', () => {
      layout.setMode('pro')
      layout.addPanel('explorer')

      const addedPanel = layout.layout.panels.find((p) => p.type === 'explorer')
      expect(addedPanel).toBeDefined()
      expect(addedPanel?.type).toBe('explorer')
    })

    it('should generate valid panel ids', () => {
      layout.setMode('pro')
      const id1 = layout.addPanel('terminal')

      expect(id1).toMatch(/^terminal-\d+$/)
    })

    it('should add panel with default title', () => {
      layout.setMode('pro')
      layout.addPanel('terminal')

      const addedPanel = layout.layout.panels.find((p) => p.type === 'terminal')
      expect(addedPanel?.title).toContain('Terminal')
    })

    it('should set new panel as active', () => {
      layout.setMode('pro')
      const newId = layout.addPanel('terminal')

      expect(layout.layout.activePanelId).toBe(newId)
    })

    it('should replace panel in simple mode', () => {
      // In simple mode, addPanel replaces the single panel
      const initialId = layout.layout.panels[0].id

      const newId = layout.addPanel('terminal')

      expect(layout.layout.panels.length).toBe(1)
      expect(newId).not.toBe(initialId)
    })
  })

  describe('removePanel', () => {
    it('should remove panel by id in pro mode', () => {
      layout.setMode('pro')
      const panelId = layout.layout.panels[1]?.id || layout.layout.panels[0].id
      const initialCount = layout.layout.panels.length

      layout.removePanel(panelId)

      expect(layout.layout.panels.length).toBe(initialCount - 1)
      expect(layout.layout.panels.find((p) => p.id === panelId)).toBeUndefined()
    })

    it('should not remove last panel', () => {
      layout.setMode('simple')
      const panelId = layout.layout.panels[0].id
      const initialCount = layout.layout.panels.length

      layout.removePanel(panelId)

      expect(layout.layout.panels.length).toBe(initialCount) // Should still have 1
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

  describe('getDefaultLayout', () => {
    it('should return simple mode panels', () => {
      const panels = getDefaultLayout('simple')

      expect(panels).toHaveLength(1)
      expect(panels.every((p) => p.type === 'agent')).toBe(true)
    })

    it('should return pro mode panels', () => {
      const panels = getDefaultLayout('pro')

      expect(panels.length).toBeGreaterThan(1)
      const types = panels.map((p) => p.type)
      expect(types).toContain('explorer')
      expect(types).toContain('agent')
      expect(types).toContain('terminal')
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
    const validTypes: PanelType[] = ['agent', 'explorer', 'terminal']

    validTypes.forEach((type) => {
      const panel: PanelConfig = {
        id: `panel-${type}`,
        type,
        title: `${type} panel`,
        position: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
        tabs: [`panel-${type}`],
      }
      expect(panel.type).toBe(type)
    })
  })
})