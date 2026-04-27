import { render } from 'solid-js/web'
import App from './App'
import './styles/global.css'

// Apply saved theme on startup
const savedTheme = localStorage.getItem('hybrid-agent-settings')
if (savedTheme) {
  try {
    const settings = JSON.parse(savedTheme)
    if (settings.theme) {
      document.documentElement.setAttribute('data-theme', settings.theme)
    }
  } catch (e) {
    // Use default theme
  }
}

const root = document.getElementById('root')

if (root) {
  render(() => <App />, root)
}
