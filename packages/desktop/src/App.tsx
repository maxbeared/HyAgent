import { Component, onMount } from 'solid-js'
import { I18nProvider } from './lib/i18n'
import { PanelSystem } from './lib/components/Panel/PanelSystem'
import { getEffectiveTheme, getSettings } from './lib/stores/settings'

const BASE_FONT_SIZE = 13

const App: Component = () => {
  onMount(() => {
    const s = getSettings()
    document.documentElement.setAttribute('data-theme', getEffectiveTheme())
    const scale = s.fontSize / BASE_FONT_SIZE
    document.documentElement.style.setProperty('--font-scale', String(scale))
    const fontStacks: Record<string, string> = {
      'JetBrains Mono': 'var(--font-stack-jetbrains)',
      'Fira Code': 'var(--font-stack-fira)',
      'Consolas': 'var(--font-stack-consolas)',
      'Monaco': 'var(--font-stack-monaco)',
    }
    document.documentElement.style.setProperty('--font-mono', fontStacks[s.fontFamily] ?? 'var(--font-stack-jetbrains)')
  })

  return (
    <I18nProvider>
      <PanelSystem />
    </I18nProvider>
  )
}

export default App
