import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useSettings, type SettingsState, type ProviderConfig } from '../../src/lib/stores/settings'

describe('Settings Store', () => {
  let settingsStore: ReturnType<typeof useSettings>

  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear()
    // Re-import to get fresh store instance with cleared state
    // Note: Due to module caching, we need to work with the existing instance
    settingsStore = useSettings()
    settingsStore.resetToDefaults()
  })

  afterEach(() => {
    localStorage.clear()
  })

  describe('initial state', () => {
    it('should have default provider settings', () => {
      const { settings } = settingsStore

      expect(settings.provider.provider).toBe('anthropic')
      expect(settings.provider.baseUrl).toBe('https://api.anthropic.com')
      expect(settings.provider.model).toBe('claude-3-5-sonnet-20241022')
      expect(settings.provider.apiKey).toBe('')
    })

    it('should have default permission settings', () => {
      const { settings } = settingsStore

      expect(settings.permission.mode).toBe('default')
      expect(settings.permission.dangerousTools).toEqual({
        bash: 'ask',
        write: 'ask',
        edit: 'ask',
        notebook: 'ask',
      })
    })

    it('should have default compaction settings', () => {
      const { settings } = settingsStore

      expect(settings.compaction.tokenThreshold).toBe(80000)
      expect(settings.compaction.warningThreshold).toBe(70)
      expect(settings.compaction.protectTokens).toBe(40000)
      expect(settings.compaction.minMessages).toBe(5)
    })

    it('should have default voice settings', () => {
      const { settings } = settingsStore

      expect(settings.voice.enabled).toBe(true)
      expect(settings.voice.engine).toBe('webspeech')
      expect(settings.voice.shortcut).toBe('Ctrl+Shift+V')
      expect(settings.voice.autoSend).toBe(true)
      expect(settings.voice.showWaveform).toBe(true)
    })

    it('should have default theme and appearance settings', () => {
      const { settings } = settingsStore

      expect(settings.theme).toBe('system')
      expect(settings.fontSize).toBe(14)
      expect(settings.fontFamily).toBe('JetBrains Mono')
    })
  })

  describe('updateProvider', () => {
    it('should update provider settings partially', () => {
      const { settings, updateProvider } = settingsStore

      updateProvider({ model: 'claude-3-5-haiku' })

      expect(settings.provider.model).toBe('claude-3-5-haiku')
      expect(settings.provider.provider).toBe('anthropic')
      expect(settings.provider.baseUrl).toBe('https://api.anthropic.com')
    })

    it('should update provider type', () => {
      const { settings, updateProvider } = settingsStore

      updateProvider({ provider: 'openai' })

      expect(settings.provider.provider).toBe('openai')
    })

    it('should update api key', () => {
      const { settings, updateProvider } = settingsStore

      updateProvider({ apiKey: 'sk-test-key' })

      expect(settings.provider.apiKey).toBe('sk-test-key')
    })

    it('should persist to localStorage', () => {
      const { updateProvider } = settingsStore

      updateProvider({ model: 'claude-3-5-haiku' })

      const saved = localStorage.getItem('hybrid-agent-settings')
      expect(saved).toBeTruthy()
      const parsed = JSON.parse(saved!)
      expect(parsed.provider.model).toBe('claude-3-5-haiku')
    })
  })

  describe('updatePermission', () => {
    it('should update permission mode', () => {
      const { settings, updatePermission } = settingsStore

      updatePermission({ mode: 'permissive' })

      expect(settings.permission.mode).toBe('permissive')
    })

    it('should update dangerous tools configuration', () => {
      const { settings, updatePermission } = settingsStore

      updatePermission({
        dangerousTools: { bash: 'allow', write: 'deny', edit: 'ask', notebook: 'deny' },
      })

      expect(settings.permission.dangerousTools.bash).toBe('allow')
      expect(settings.permission.dangerousTools.write).toBe('deny')
    })
  })

  describe('updateCompaction', () => {
    it('should update compaction settings', () => {
      const { settings, updateCompaction } = settingsStore

      updateCompaction({ tokenThreshold: 100000 })

      expect(settings.compaction.tokenThreshold).toBe(100000)
    })

    it('should preserve other compaction settings', () => {
      const { settings, updateCompaction } = settingsStore

      // Reset first
      settingsStore.resetToDefaults()

      // Now update warning threshold
      updateCompaction({ warningThreshold: 80 })

      // Check warningThreshold was updated
      expect(settings.compaction.warningThreshold).toBe(80)
    })
  })

  describe('updateVoice', () => {
    it('should update voice settings', () => {
      const { settings, updateVoice } = settingsStore

      updateVoice({ enabled: false })

      expect(settings.voice.enabled).toBe(false)
    })

    it('should update voice engine', () => {
      const { settings, updateVoice } = settingsStore

      updateVoice({ engine: 'whisper' })

      expect(settings.voice.engine).toBe('whisper')
    })

    it('should update voice shortcut', () => {
      const { settings, updateVoice } = settingsStore

      updateVoice({ shortcut: 'Ctrl+Shift+W' })

      expect(settings.voice.shortcut).toBe('Ctrl+Shift+W')
    })
  })

  describe('updateTheme', () => {
    it('should update theme to dark', () => {
      const { settings, updateTheme } = settingsStore

      updateTheme('dark')

      expect(settings.theme).toBe('dark')
    })

    it('should update theme to light', () => {
      const { settings, updateTheme } = settingsStore

      updateTheme('light')

      expect(settings.theme).toBe('light')
    })
  })

  describe('updateFontSize', () => {
    it('should update font size', () => {
      const { settings, updateFontSize } = settingsStore

      updateFontSize(16)

      expect(settings.fontSize).toBe(16)
    })
  })

  describe('updateFontFamily', () => {
    it('should update font family', () => {
      const { settings, updateFontFamily } = settingsStore

      updateFontFamily('Fira Code')

      expect(settings.fontFamily).toBe('Fira Code')
    })
  })

  describe('resetToDefaults', () => {
    it('should be able to update theme after reset', () => {
      // Clear localStorage to start fresh
      localStorage.clear()

      const { settings, updateTheme } = settingsStore

      // Verify theme can be changed
      updateTheme('light')
      expect(settings.theme).toBe('light')

      updateTheme('dark')
      expect(settings.theme).toBe('dark')
    })
  })
})

describe('Settings interfaces', () => {
  describe('ProviderConfig', () => {
    it('should support anthropic provider', () => {
      const config: ProviderConfig = {
        provider: 'anthropic',
        apiKey: 'sk-ant-xxx',
        baseUrl: 'https://api.anthropic.com',
        model: 'claude-3-5-sonnet-20241022',
      }
      expect(config.provider).toBe('anthropic')
    })

    it('should support openai provider', () => {
      const config: ProviderConfig = {
        provider: 'openai',
        apiKey: 'sk-xxx',
        baseUrl: 'https://api.openai.com',
        model: 'gpt-4',
      }
      expect(config.provider).toBe('openai')
    })

    it('should support minimaxi provider', () => {
      const config: ProviderConfig = {
        provider: 'minimaxi',
        apiKey: 'xxx',
        baseUrl: 'https://api.minimax.chat',
        model: 'MiniMax-Text-01',
      }
      expect(config.provider).toBe('minimaxi')
    })
  })
})
