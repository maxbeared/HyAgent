import { Component, For, Show, createSignal, onMount, onCleanup } from 'solid-js'
import { useI18n } from '../../i18n'
import { TerminalIcon, PlusIcon, CloseIcon, TrashIcon } from '../Icons'
import { Command } from '@tauri-apps/plugin-shell'
import './PanelSystem.css'

interface TerminalTab {
  id: string
  title: string
  cwd?: string
}

interface TerminalLine {
  type: 'output' | 'command' | 'error'
  content: string
  timestamp: Date
}

export const TerminalPanel: Component = () => {
  const { t } = useI18n()
  const [tabs, setTabs] = createSignal<TerminalTab[]>([
    { id: '1', title: 'Terminal 1', cwd: 'd:\\agent-core-compare\\hybrid-agent' }
  ])
  const [activeTabId, setActiveTabId] = createSignal('1')
  const [lines, setLines] = createSignal<Record<string, TerminalLine[]>>({
    '1': [
      { type: 'output', content: 'Terminal ready. Type a command and press Enter.', timestamp: new Date() }
    ]
  })
  const [input, setInput] = createSignal('')

  let outputRef: HTMLDivElement | undefined

  const scrollToBottom = () => {
    if (outputRef) {
      outputRef.scrollTop = outputRef.scrollHeight
    }
  }

  const executeCommand = async (command: string) => {
    const tabId = activeTabId()
    const currentTab = tabs().find(t => t.id === tabId)

    // Add command line
    setLines(prev => ({
      ...prev,
      [tabId]: [...(prev[tabId] || []), { type: 'command', content: `$ ${command}`, timestamp: new Date() }]
    }))

    const trimmedCommand = command.trim()
    if (trimmedCommand === '') {
      scrollToBottom()
      return
    }

    if (trimmedCommand === 'clear') {
      setLines(prev => ({ ...prev, [tabId]: [] }))
      return
    }

    try {
      // Determine shell based on platform
      const isWindows = navigator.userAgent.includes('Windows')
      const shell = isWindows ? 'cmd' : 'bash'
      const shellArgs = isWindows ? ['/C', trimmedCommand] : ['-c', trimmedCommand]

      const cmd = Command.create(shell, shellArgs, {
        cwd: currentTab?.cwd || undefined,
      })

      const output = await cmd.execute()

      const newLines: TerminalLine[] = []

      if (output.stdout) {
        newLines.push({ type: 'output', content: output.stdout, timestamp: new Date() })
      }
      if (output.stderr) {
        newLines.push({ type: 'error', content: output.stderr, timestamp: new Date() })
      }
      if (output.code !== 0 && !output.stderr) {
        newLines.push({ type: 'error', content: `Process exited with code ${output.code}`, timestamp: new Date() })
      }

      setLines(prev => ({
        ...prev,
        [tabId]: [...(prev[tabId] || []), ...newLines]
      }))
    } catch (error) {
      setLines(prev => ({
        ...prev,
        [tabId]: [...(prev[tabId] || []), { type: 'error', content: `Error: ${error}`, timestamp: new Date() }]
      }))
    }

    setInput('')
    setTimeout(scrollToBottom, 0)
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      const cmd = input().trim()
      if (cmd) {
        executeCommand(cmd)
      }
    }
  }

  const addTab = () => {
    const newId = `${Date.now()}`
    const newTab: TerminalTab = { id: newId, title: `Terminal ${tabs().length + 1}`, cwd: tabs()[0]?.cwd }
    setTabs([...tabs(), newTab])
    setLines(prev => ({ ...prev, [newId]: [{ type: 'output', content: 'Terminal ready.', timestamp: new Date() }] }))
    setActiveTabId(newId)
  }

  const closeTab = (id: string) => {
    if (tabs().length === 1) return // Keep at least one tab
    const tabIndex = tabs().findIndex(t => t.id === id)
    const newTabs = tabs().filter(t => t.id !== id)
    setTabs(newTabs)

    // Clean up lines for closed tab
    setLines(prev => {
      const newLines = { ...prev }
      delete newLines[id]
      return newLines
    })

    if (activeTabId() === id) {
      setActiveTabId(newTabs[Math.max(0, tabIndex - 1)].id)
    }
  }

  const clearTerminal = () => {
    const tabId = activeTabId()
    setLines(prev => ({ ...prev, [tabId]: [] }))
  }

  onMount(() => {
    scrollToBottom()
  })

  return (
    <div class="terminal-panel">
      <div class="terminal-header">
        <div class="terminal-tabs">
          <For each={tabs()}>
            {(tab) => (
              <div
                class={`terminal-tab ${activeTabId() === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTabId(tab.id)}
              >
                <TerminalIcon size={12} />
                <span>{tab.title}</span>
                <Show when={tabs().length > 1}>
                  <button
                    class="terminal-tab-close"
                    onClick={(e) => {
                      e.stopPropagation()
                      closeTab(tab.id)
                    }}
                  >
                    <CloseIcon size={10} />
                  </button>
                </Show>
              </div>
            )}
          </For>
          <button class="terminal-tab" onClick={addTab} title={t().newTab}>
            <PlusIcon size={12} />
          </button>
        </div>
        <div class="terminal-actions">
          <button class="explorer-btn" onClick={clearTerminal} title={t().clearTerminal}>
            <TrashIcon size={14} />
          </button>
        </div>
      </div>

      <div class="terminal-content" ref={outputRef}>
        <div class="terminal-output">
          <For each={lines()[activeTabId()] || []}>
            {(line) => (
              <div class={`terminal-line ${line.type}`}>{line.content}</div>
            )}
          </For>
        </div>
      </div>

      <div class="terminal-input-line">
        <span class="terminal-prompt">$</span>
        <input
          type="text"
          class="terminal-input"
          value={input()}
          onInput={(e) => setInput(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a command..."
        />
      </div>
    </div>
  )
}

export default TerminalPanel