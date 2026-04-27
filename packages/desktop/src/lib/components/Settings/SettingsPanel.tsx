import { Component, For, Show, createSignal } from 'solid-js'
import { useSettings } from '../../stores/settings'
import { useI18n } from '../../i18n'
import { CloseIcon, MoonIcon, SunIcon, MonitorIcon } from '../Icons'
import './Settings.css'

interface SettingsPanelProps {
  onClose: () => void
}

export const SettingsPanel: Component<SettingsPanelProps> = (props) => {
  const { t } = useI18n()
  const settings = useSettings()
  const [activeTab, setActiveTab] = createSignal('provider')

  const tabs = [
    { id: 'provider', label: t.provider, description: t.providerDesc },
    { id: 'permission', label: t.permission, description: t.permissionDesc },
    { id: 'compaction', label: t.compaction, description: t.compactionDesc },
    { id: 'voice', label: t.voice, description: t.voiceDesc },
    { id: 'theme', label: t.theme, description: t.themeDesc },
    { id: 'language', label: t.language, description: t.languageDesc },
  ]

  return (
    <div class="settings-overlay" onClick={props.onClose}>
      <div class="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div class="settings-header">
          <h2>{t.settings}</h2>
          <button class="close-btn" onClick={props.onClose}>
            <CloseIcon size={16} />
          </button>
        </div>

        <div class="settings-body">
          <nav class="settings-nav">
            <For each={tabs}>
              {(tab) => (
                <button
                  class="nav-item"
                  classList={{ active: activeTab() === tab.id }}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <span class="nav-label">{tab.label}</span>
                  <span class="nav-desc">{tab.description}</span>
                </button>
              )}
            </For>
          </nav>

          <div class="settings-content">
            <Show when={activeTab() === 'provider'}>
              <ProviderSettings />
            </Show>
            <Show when={activeTab() === 'permission'}>
              <PermissionSettings />
            </Show>
            <Show when={activeTab() === 'compaction'}>
              <CompactionSettings />
            </Show>
            <Show when={activeTab() === 'voice'}>
              <VoiceSettings />
            </Show>
            <Show when={activeTab() === 'theme'}>
              <ThemeSettings />
            </Show>
            <Show when={activeTab() === 'language'}>
              <LanguageSettings />
            </Show>
          </div>
        </div>
      </div>
    </div>
  )
}

const ProviderSettings: Component = () => {
  const { t } = useI18n()
  const settings = useSettings()

  return (
    <div class="settings-section">
      <h3>{t.providerConfig}</h3>
      <p class="section-desc">{t.providerDesc}</p>

      <div class="form-group">
        <label>{t.aiProvider}</label>
        <select
          value={settings.settings.provider.provider}
          onChange={(e) => settings.updateProvider({ provider: e.currentTarget.value as any })}
        >
          <option value="anthropic">Anthropic</option>
          <option value="openai">OpenAI</option>
          <option value="google">Google</option>
          <option value="minimaxi">MiniMax</option>
        </select>
      </div>

      <div class="form-group">
        <label>{t.apiKey}</label>
        <input
          type="password"
          value={settings.settings.provider.apiKey}
          onInput={(e) => settings.updateProvider({ apiKey: e.currentTarget.value })}
          placeholder="Enter API key..."
        />
      </div>

      <div class="form-group">
        <label>{t.baseUrl}</label>
        <input
          type="text"
          value={settings.settings.provider.baseUrl}
          onInput={(e) => settings.updateProvider({ baseUrl: e.currentTarget.value })}
          placeholder="https://api.anthropic.com"
        />
      </div>

      <div class="form-group">
        <label>{t.model}</label>
        <input
          type="text"
          value={settings.settings.provider.model}
          onInput={(e) => settings.updateProvider({ model: e.currentTarget.value })}
          placeholder="claude-3-5-sonnet-20241022"
        />
      </div>

      <button class="btn-primary">{t.testConnection}</button>
    </div>
  )
}

const PermissionSettings: Component = () => {
  const { t } = useI18n()
  const settings = useSettings()

  const modeOptions = [
    { value: 'permissive', label: t.permissive },
    { value: 'default', label: t.defaultMode },
    { value: 'askAll', label: t.askAll },
    { value: 'plan', label: t.planMode },
  ]

  return (
    <div class="settings-section">
      <h3>{t.permissionConfig}</h3>
      <p class="section-desc">{t.permissionDesc}</p>

      <div class="form-group">
        <label>{t.permissionMode}</label>
        <select
          value={settings.settings.permission.mode}
          onChange={(e) => settings.updatePermission({ mode: e.currentTarget.value as any })}
        >
          <For each={modeOptions}>
            {(opt) => <option value={opt.value}>{opt.label}</option>}
          </For>
        </select>
      </div>

      <div class="form-group">
        <label>{t.dangerousTools}</label>
        <div class="tool-list">
          <For each={Object.entries(settings.settings.permission.dangerousTools)}>
            {([tool, action]) => (
              <div class="tool-item">
                <span class="tool-name">{tool}</span>
                <select
                  value={action}
                  onChange={(e) =>
                    settings.updatePermission({
                      dangerousTools: {
                        ...settings.settings.permission.dangerousTools,
                        [tool]: e.currentTarget.value as any,
                      },
                    })
                  }
                >
                  <option value="allow">{t.allow}</option>
                  <option value="deny">{t.deny}</option>
                  <option value="ask">{t.ask}</option>
                </select>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  )
}

const CompactionSettings: Component = () => {
  const { t } = useI18n()
  const settings = useSettings()

  return (
    <div class="settings-section">
      <h3>{t.compactionConfig}</h3>
      <p class="section-desc">{t.compactionDesc}</p>

      <div class="form-group">
        <label>{t.tokenThreshold}</label>
        <input
          type="number"
          value={settings.settings.compaction.tokenThreshold}
          onInput={(e) =>
            settings.updateCompaction({ tokenThreshold: parseInt(e.currentTarget.value) || 80000 })
          }
        />
        <span class="hint">{t.compactionWarning}</span>
      </div>

      <div class="form-group">
        <label>{t.compactionWarning}</label>
        <input
          type="number"
          value={settings.settings.compaction.warningThreshold}
          onInput={(e) =>
            settings.updateCompaction({ warningThreshold: parseInt(e.currentTarget.value) || 70 })
          }
        />
      </div>

      <div class="form-group">
        <label>{t.protectedTools}</label>
        <div class="tool-list">
          <For each={settings.settings.compaction.protectedTools}>
            {(tool) => <span class="tag">{tool}</span>}
          </For>
        </div>
        <span class="hint">{t.protectedToolsHint}</span>
      </div>
    </div>
  )
}

const VoiceSettings: Component = () => {
  const { t } = useI18n()
  const settings = useSettings()

  return (
    <div class="settings-section">
      <h3>{t.voiceConfig}</h3>
      <p class="section-desc">{t.voiceDesc}</p>

      <div class="form-group">
        <label class="checkbox-label">
          <input
            type="checkbox"
            checked={settings.settings.voice.enabled}
            onChange={(e) => settings.updateVoice({ enabled: e.currentTarget.checked })}
          />
          {t.enableVoice}
        </label>
      </div>

      <div class="form-group">
        <label>{t.recognitionEngine}</label>
        <select
          value={settings.settings.voice.engine}
          onChange={(e) => settings.updateVoice({ engine: e.currentTarget.value as any })}
          disabled={!settings.settings.voice.enabled}
        >
          <option value="webspeech">{t.webSpeech}</option>
          <option value="whisper">{t.whisperLocal}</option>
        </select>
      </div>

      <div class="form-group">
        <label>{t.shortcut}</label>
        <input
          type="text"
          value={settings.settings.voice.shortcut}
          onInput={(e) => settings.updateVoice({ shortcut: e.currentTarget.value })}
          disabled={!settings.settings.voice.enabled}
        />
      </div>

      <div class="form-group">
        <label class="checkbox-label">
          <input
            type="checkbox"
            checked={settings.settings.voice.autoSend}
            onChange={(e) => settings.updateVoice({ autoSend: e.currentTarget.checked })}
            disabled={!settings.settings.voice.enabled}
          />
          {t.autoSend}
        </label>
      </div>

      <div class="form-group">
        <label class="checkbox-label">
          <input
            type="checkbox"
            checked={settings.settings.voice.showWaveform}
            onChange={(e) => settings.updateVoice({ showWaveform: e.currentTarget.checked })}
            disabled={!settings.settings.voice.enabled}
          />
          {t.showWaveform}
        </label>
      </div>
    </div>
  )
}

const ThemeSettings: Component = () => {
  const { t } = useI18n()
  const settings = useSettings()

  return (
    <div class="settings-section">
      <h3>{t.themeConfig}</h3>
      <p class="section-desc">{t.themeDesc}</p>

      <div class="form-group">
        <label>{t.theme}</label>
        <div class="theme-options">
          <button
            class="theme-btn"
            classList={{ active: settings.settings.theme === 'system' }}
            onClick={() => settings.updateTheme('system')}
          >
            <MonitorIcon size={16} />
            <span>{t.systemTheme}</span>
          </button>
          <button
            class="theme-btn"
            classList={{ active: settings.settings.theme === 'dark' }}
            onClick={() => settings.updateTheme('dark')}
          >
            <MoonIcon size={16} />
            <span>{t.darkTheme}</span>
          </button>
          <button
            class="theme-btn"
            classList={{ active: settings.settings.theme === 'light' }}
            onClick={() => settings.updateTheme('light')}
          >
            <SunIcon size={16} />
            <span>{t.lightTheme}</span>
          </button>
        </div>
      </div>

      <div class="form-group">
        <label>{t.fontSize}</label>
        <div class="input-with-suffix">
          <input
            type="number"
            min="10"
            max="24"
            value={settings.settings.fontSize}
            onInput={(e) => settings.updateFontSize(parseInt(e.currentTarget.value) || 14)}
          />
          <span class="suffix">px</span>
        </div>
      </div>

      <div class="form-group">
        <label>{t.fontFamily}</label>
        <select
          value={settings.settings.fontFamily}
          onChange={(e) => settings.updateFontFamily(e.currentTarget.value)}
        >
          <option value="JetBrains Mono">JetBrains Mono</option>
          <option value="Fira Code">Fira Code</option>
          <option value="Consolas">Consolas</option>
          <option value="Monaco">Monaco</option>
        </select>
      </div>

      <button class="btn-secondary" onClick={settings.resetToDefaults}>
        {t.resetDefaults}
      </button>
    </div>
  )
}

const LanguageSettings: Component = () => {
  const { t, locale, setLocale } = useI18n()

  return (
    <div class="settings-section">
      <h3>{t.languageConfig}</h3>
      <p class="section-desc">{t.languageDesc}</p>

      <div class="form-group">
        <label>{t.language}</label>
        <div class="theme-options">
          <button
            class="theme-btn"
            classList={{ active: locale() === 'zh' }}
            onClick={() => setLocale('zh')}
          >
            <span>{t.chinese}</span>
          </button>
          <button
            class="theme-btn"
            classList={{ active: locale() === 'en' }}
            onClick={() => setLocale('en')}
          >
            <span>{t.english}</span>
          </button>
        </div>
      </div>
    </div>
  )
}

export default SettingsPanel
