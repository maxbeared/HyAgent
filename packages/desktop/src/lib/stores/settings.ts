import { createStore } from 'solid-js/store'

export type ThemeMode = 'dark' | 'light' | 'system'
export type Locale = 'zh' | 'en'

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

export type FontSizeScheme = 'small' | 'medium' | 'large' | 'xlarge'
export type FontFamilyScheme = 'jetbrains' | 'fira' | 'consolas' | 'monaco'

export const FONT_SIZE_PRESETS: Record<FontSizeScheme, number> = {
  small: 11,
  medium: 13,
  large: 16,
  xlarge: 19,
}

export const FONT_FAMILY_PRESETS: Record<FontFamilyScheme, string> = {
  jetbrains: 'JetBrains Mono',
  fira: 'Fira Code',
  consolas: 'Consolas',
  monaco: 'Monaco',
}

export interface SettingsState {
  provider: ProviderConfig
  permission: PermissionConfig
  compaction: CompactionConfig
  voice: VoiceConfig
  theme: ThemeMode
  fontSize: number
  fontFamily: string
  language: Locale
}

function detectSystemLanguage(): Locale {
  if (typeof navigator !== 'undefined') {
    const lang = navigator.language.toLowerCase()
    if (lang.startsWith('zh')) return 'zh'
  }
  return 'en'
}

function detectSystemTheme(): 'dark' | 'light' {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'dark'
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
  theme: 'system',
  fontSize: 13,
  fontFamily: 'JetBrains Mono',
  language: detectSystemLanguage(),
}

function loadSettings(): SettingsState | null {
  try {
    const saved = localStorage.getItem('hybrid-agent-settings')
    if (saved) {
      const parsed = JSON.parse(saved)
      // If no language is saved (old settings), use system language
      if (!parsed.language) {
        parsed.language = detectSystemLanguage()
      }
      return parsed
    }
  } catch (e) {
    console.error('Failed to load settings:', e)
  }
  return null
}

const [settings, setSettings] = createStore<SettingsState>(
  loadSettings() || defaultSettings
)

// Get effective theme (resolving 'system' to actual theme)
export function getEffectiveTheme(): 'dark' | 'light' {
  if (settings.theme === 'system') {
    return detectSystemTheme()
  }
  return settings.theme
}

// Apply theme to document
function applyTheme() {
  if (typeof document !== 'undefined') {
    const effectiveTheme = getEffectiveTheme()
    document.documentElement.setAttribute('data-theme', effectiveTheme)
  }
}

// Font stack map: maps user-selected font name to full CSS font stack
const FONT_STACK_VARS: Record<string, string> = {
  'JetBrains Mono': 'var(--font-stack-jetbrains)',
  'Fira Code': 'var(--font-stack-fira)',
  'Consolas': 'var(--font-stack-consolas)',
  'Monaco': 'var(--font-stack-monaco)',
}

// Baseline font size — matches --fs-base: calc(13px * var(--font-scale))
const BASE_FONT_SIZE = 13

// Apply font styles via CSS custom properties
function applyFontStyles() {
  if (typeof document !== 'undefined') {
    const scale = settings.fontSize / BASE_FONT_SIZE
    document.documentElement.style.setProperty('--font-scale', String(scale))
    const stack = FONT_STACK_VARS[settings.fontFamily] ?? 'var(--font-stack-jetbrains)'
    document.documentElement.style.setProperty('--font-mono', stack)
  }
}

// Listen for system theme changes (applyTheme is also called from updateTheme)
if (typeof document !== 'undefined' && window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (settings.theme === 'system') {
      applyTheme()
    }
  })
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

    updateTheme(theme: ThemeMode) {
      setSettings('theme', theme)
      applyTheme()
      saveSettings()
    },

    updateFontSizeScheme(scheme: FontSizeScheme) {
      setSettings('fontSize', FONT_SIZE_PRESETS[scheme])
      applyFontStyles()
      saveSettings()
    },

    updateFontFamilyScheme(scheme: FontFamilyScheme) {
      setSettings('fontFamily', FONT_FAMILY_PRESETS[scheme])
      applyFontStyles()
      saveSettings()
    },

    updateLanguage(language: Locale) {
      setSettings('language', language)
      saveSettings()
    },

    resetToDefaults() {
      setSettings(defaultSettings)
      applyTheme()
      applyFontStyles()
      saveSettings()
    },
  }
}

export function getSettings() {
  return settings
}
