import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

describe('PanelSystem Component', () => {
  const componentPath = path.join(__dirname, '../../src/lib/components/Panel/PanelSystem.tsx')

  describe('component file', () => {
    it('should exist', () => {
      expect(fs.existsSync(componentPath)).toBe(true)
    })

    it('should export PanelSystem', () => {
      const content = fs.readFileSync(componentPath, 'utf-8')
      expect(content).toContain('export const PanelSystem')
    })
  })

  describe('CSS classes', () => {
    it('should have expected CSS class references in code', () => {
      const content = fs.readFileSync(componentPath, 'utf-8')

      // Check for key CSS classes used in the component
      expect(content).toContain('panel-system')
      expect(content).toContain('title-bar')
      expect(content).toContain('panel-container')
      expect(content).toContain('panel-grid')
      expect(content).toContain('status-bar')
    })

    it('should have mode switch buttons', () => {
      const content = fs.readFileSync(componentPath, 'utf-8')

      expect(content).toContain('简洁模式')
      expect(content).toContain('专业模式')
    })
  })

  describe('Panel CSS file', () => {
    const cssPath = path.join(__dirname, '../../src/lib/components/Panel/PanelSystem.css')

    it('should have CSS file', () => {
      expect(fs.existsSync(cssPath)).toBe(true)
    })

    it('should have expected CSS classes', () => {
      const content = fs.readFileSync(cssPath, 'utf-8')

      expect(content).toContain('.panel')
      expect(content).toContain('.panel-header')
      expect(content).toContain('.panel-content')
    })
  })
})
