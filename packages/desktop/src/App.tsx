import { Component } from 'solid-js'
import { I18nProvider } from './lib/i18n'
import { PanelSystem } from './lib/components/Panel/PanelSystem'

const App: Component = () => {
  return (
    <I18nProvider>
      <PanelSystem />
    </I18nProvider>
  )
}

export default App
