import { Component, For, Show, createSignal } from 'solid-js'
import { useSettings } from '../../stores/settings'
import './Settings.css'

interface SettingsPanelProps {
  onClose: () => void
}

export const SettingsPanel: Component<SettingsPanelProps> = (props) => {
  const settings = useSettings()
  const [activeTab, setActiveTab] = createSignal('provider')

  const tabs = [
    { id: 'provider', label: 'Provider', description: 'API 配置' },
    { id: 'permission', label: 'Permission', description: '权限设置' },
    { id: 'compaction', label: 'Compaction', description: '会话压缩' },
    { id: 'voice', label: 'Voice', description: '语音输入' },
    { id: 'theme', label: 'Theme', description: '主题外观' },
  ]

  return (
    <div class="settings-overlay" onClick={props.onClose}>
      <div class="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div class="settings-header">
          <h2>Settings</h2>
          <button class="close-btn" onClick={props.onClose}>×</button>
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
          </div>
        </div>
      </div>
    </div>
  )
}

const ProviderSettings: Component = () => {
  const settings = useSettings()

  return (
    <div class="settings-section">
      <h3>Provider Configuration</h3>
      <p class="section-desc">配置 AI 模型 Provider</p>

      <div class="form-group">
        <label>Provider</label>
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
        <label>API Key</label>
        <input
          type="password"
          value={settings.settings.provider.apiKey}
          onInput={(e) => settings.updateProvider({ apiKey: e.currentTarget.value })}
          placeholder="Enter API key..."
        />
      </div>

      <div class="form-group">
        <label>Base URL</label>
        <input
          type="text"
          value={settings.settings.provider.baseUrl}
          onInput={(e) => settings.updateProvider({ baseUrl: e.currentTarget.value })}
          placeholder="https://api.anthropic.com"
        />
      </div>

      <div class="form-group">
        <label>Model</label>
        <input
          type="text"
          value={settings.settings.provider.model}
          onInput={(e) => settings.updateProvider({ model: e.currentTarget.value })}
          placeholder="claude-3-5-sonnet-20241022"
        />
      </div>

      <button class="btn-primary">Test Connection</button>
    </div>
  )
}

const PermissionSettings: Component = () => {
  const settings = useSettings()

  return (
    <div class="settings-section">
      <h3>Permission Configuration</h3>
      <p class="section-desc">配置权限模式和危险工具行为</p>

      <div class="form-group">
        <label>Permission Mode</label>
        <select
          value={settings.settings.permission.mode}
          onChange={(e) => settings.updatePermission({ mode: e.currentTarget.value as any })}
        >
          <option value="permissive">Permissive - 允许所有操作</option>
          <option value="default">Default - 安全操作直接允许</option>
          <option value="askAll">Ask All - 所有操作询问</option>
          <option value="plan">Plan - 只读模式</option>
        </select>
      </div>

      <div class="form-group">
        <label>Dangerous Tools</label>
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
                  <option value="allow">Allow</option>
                  <option value="deny">Deny</option>
                  <option value="ask">Ask</option>
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
  const settings = useSettings()

  return (
    <div class="settings-section">
      <h3>Compaction Configuration</h3>
      <p class="section-desc">配置会话压缩行为</p>

      <div class="form-group">
        <label>Token Threshold</label>
        <input
          type="number"
          value={settings.settings.compaction.tokenThreshold}
          onInput={(e) =>
            settings.updateCompaction({ tokenThreshold: parseInt(e.currentTarget.value) || 80000 })
          }
        />
        <span class="hint">触发压缩的 token 阈值</span>
      </div>

      <div class="form-group">
        <label>Warning Threshold (%)</label>
        <input
          type="number"
          value={settings.settings.compaction.warningThreshold}
          onInput={(e) =>
            settings.updateCompaction({ warningThreshold: parseInt(e.currentTarget.value) || 70 })
          }
        />
        <span class="hint">警告阈值百分比</span>
      </div>

      <div class="form-group">
        <label>Protected Tools</label>
        <div class="tool-list">
          <For each={settings.settings.compaction.protectedTools}>
            {(tool) => <span class="tag">{tool}</span>}
          </For>
        </div>
        <span class="hint">这些工具不会被裁剪</span>
      </div>
    </div>
  )
}

const VoiceSettings: Component = () => {
  const settings = useSettings()

  return (
    <div class="settings-section">
      <h3>Voice Configuration</h3>
      <p class="section-desc">配置语音输入</p>

      <div class="form-group">
        <label class="checkbox-label">
          <input
            type="checkbox"
            checked={settings.settings.voice.enabled}
            onChange={(e) => settings.updateVoice({ enabled: e.currentTarget.checked })}
          />
          Enable Voice Input
        </label>
      </div>

      <div class="form-group">
        <label>Recognition Engine</label>
        <select
          value={settings.settings.voice.engine}
          onChange={(e) => settings.updateVoice({ engine: e.currentTarget.value as any })}
          disabled={!settings.settings.voice.enabled}
        >
          <option value="webspeech">Web Speech API</option>
          <option value="whisper">Whisper.cpp (Local)</option>
        </select>
      </div>

      <div class="form-group">
        <label>Shortcut</label>
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
          Auto-send without pressing Enter
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
          Show Waveform Animation
        </label>
      </div>
    </div>
  )
}

const ThemeSettings: Component = () => {
  const settings = useSettings()

  return (
    <div class="settings-section">
      <h3>Theme Configuration</h3>
      <p class="section-desc">配置外观和显示效果</p>

      <div class="form-group">
        <label>Theme</label>
        <div class="theme-options">
          <button
            class="theme-btn"
            classList={{ active: settings.settings.theme === 'dark' }}
            onClick={() => settings.updateTheme('dark')}
          >
            🌙 Dark
          </button>
          <button
            class="theme-btn"
            classList={{ active: settings.settings.theme === 'light' }}
            onClick={() => settings.updateTheme('light')}
          >
            ☀️ Light
          </button>
        </div>
      </div>

      <div class="form-group">
        <label>Font Size</label>
        <input
          type="number"
          min="10"
          max="24"
          value={settings.settings.fontSize}
          onInput={(e) => settings.updateFontSize(parseInt(e.currentTarget.value) || 14)}
        />
        <span class="hint">px</span>
      </div>

      <div class="form-group">
        <label>Font Family</label>
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
        Reset to Defaults
      </button>
    </div>
  )
}

export default SettingsPanel
