import { createStore } from 'solid-js/store'
import { createSignal } from 'solid-js'

export interface ProviderConfig {
  provider: 'anthropic' | 'openai' | 'google' | 'minimaxi'
  apiKey: string
  baseUrl: string
  model: string
}

export interface PermissionConfig {
  mode: 'permissive' | 'default' | 'askAll' | 'plan'
  dangerousTools: Record<string, 'allow' | 'deny' | 'ask'>
}

export interface CompactionConfig {
  tokenThreshold: number
  warningThreshold: number
  protectTokens: number
  minMessages: number
  protectedTools: string[]
}

export interface VoiceConfig {
  enabled: boolean
  engine: 'whisper' | 'webspeech'
  shortcut: string
  autoSend: boolean
  showWaveform: boolean
}

export interface SettingsState {
  provider: ProviderConfig
  permission: PermissionConfig
  compaction: CompactionConfig
  voice: VoiceConfig
  theme: 'dark' | 'light'
  fontSize: number
  fontFamily: string
}

const defaultSettings: SettingsState = {
  provider: {
    provider: 'anthropic',
    apiKey: '',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-3-5-sonnet-20241022',
  },
  permission: {
    mode: 'default',
    dangerousTools: {
      bash: 'ask',
      write: 'ask',
      edit: 'ask',
      notebook: 'ask',
    },
  },
  compaction: {
    tokenThreshold: 80000,
    warningThreshold: 70,
    protectTokens: 40000,
    minMessages: 5,
    protectedTools: ['skill', 'read', 'glob', 'grep'],
  },
  voice: {
    enabled: true,
    engine: 'webspeech',
    shortcut: 'Ctrl+Shift+V',
    autoSend: true,
    showWaveform: true,
  },
  theme: 'dark',
  fontSize: 14,
  fontFamily: 'JetBrains Mono',
}

const [settings, setSettings] = createStore<SettingsState>(
  loadSettings() || defaultSettings
)

function loadSettings(): SettingsState | null {
  try {
    const saved = localStorage.getItem('hybrid-agent-settings')
    if (saved) {
      return JSON.parse(saved)
    }
  } catch (e) {
    console.error('Failed to load settings:', e)
  }
  return null
}

export function useSettings() {
  const saveSettings = () => {
    try {
      localStorage.setItem('hybrid-agent-settings', JSON.stringify(settings))
    } catch (e) {
      console.error('Failed to save settings:', e)
    }
  }

  return {
    settings,

    updateProvider(provider: Partial<ProviderConfig>) {
      setSettings('provider', (p) => ({ ...p, ...provider }))
      saveSettings()
    },

    updatePermission(permission: Partial<PermissionConfig>) {
      setSettings('permission', (p) => ({ ...p, ...permission }))
      saveSettings()
    },

    updateCompaction(compaction: Partial<CompactionConfig>) {
      setSettings('compaction', (c) => ({ ...c, ...compaction }))
      saveSettings()
    },

    updateVoice(voice: Partial<VoiceConfig>) {
      setSettings('voice', (v) => ({ ...v, ...voice }))
      saveSettings()
    },

    updateTheme(theme: 'dark' | 'light') {
      setSettings('theme', theme)
      saveSettings()
    },

    updateFontSize(size: number) {
      setSettings('fontSize', size)
      saveSettings()
    },

    updateFontFamily(family: string) {
      setSettings('fontFamily', family)
      saveSettings()
    },

    resetToDefaults() {
      setSettings(defaultSettings)
      saveSettings()
    },
  }
}

export function getSettings() {
  return settings
}
