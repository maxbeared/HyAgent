import { Component, For, Show, createSignal, onCleanup } from 'solid-js'
import { useAgent, type Message } from '../../stores/agent'
import { agentService } from '../../services/agentService'
import { useSettings } from '../../stores/settings'
import './AgentChatPanel.css'

interface AgentChatPanelProps {
  panelId: string
}

export const AgentChatPanel: Component<AgentChatPanelProps> = (props) => {
  const agent = useAgent()
  const settings = useSettings()
  const [messages, setMessages] = createSignal<Message[]>([])
  const [input, setInput] = createSignal('')
  const [isStreaming, setIsStreaming] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  let messagesEndRef: HTMLDivElement | undefined

  const scrollToBottom = () => {
    if (messagesEndRef) {
      messagesEndRef.scrollIntoView({ behavior: 'smooth' })
    }
  }

  const handleSend = async () => {
    const text = input().trim()
    if (!text || isStreaming()) return

    const config = settings.settings.provider
    if (!config.apiKey) {
      setError('Please configure API key in Settings')
      return
    }

    agentService.configure({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
    })

    // Add user message
    const userMessage: Message = {
      id: `msg_${Date.now()}_user`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    }
    setMessages(m => [...m, userMessage])
    setInput('')
    setError(null)
    setIsStreaming(true)

    // Create a session for this conversation
    const sessionId = agent.createSession()

    try {
      let fullResponse = ''

      for await (const event of agentService.streamChat(sessionId, [], text)) {
        if (event.type === 'text') {
          fullResponse += event.content || ''
          // Update or create agent message
          setMessages(m => {
            const last = m[m.length - 1]
            if (last?.role === 'user') {
              return [...m, {
                id: `msg_${Date.now()}_agent`,
                role: 'agent',
                content: fullResponse,
                timestamp: Date.now(),
              }]
            } else {
              return m.map((msg, i) =>
                i === m.length - 1
                  ? { ...msg, content: fullResponse }
                  : msg
              )
            }
          })
          scrollToBottom()
        } else if (event.type === 'tool_start') {
          // Add tool call indicator
          setMessages(m => [...m, {
            id: `msg_${Date.now()}_tool`,
            role: 'agent',
            content: `[Using tool: ${event.toolName}]`,
            timestamp: Date.now(),
            toolCalls: [{
              id: event.toolId || '',
              name: event.toolName || '',
              input: event.toolInput,
              status: 'pending',
            }],
          }])
        } else if (event.type === 'error') {
          setError(event.error || 'Unknown error')
        }
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setIsStreaming(false)
    }
  }

  return (
    <div class="agent-chat-panel">
      <div class="chat-messages">
        <Show when={messages().length === 0}>
          <div class="empty-state">
            <div class="empty-icon">💬</div>
            <div class="empty-title">Start a conversation</div>
            <div class="empty-desc">Type a message to begin chatting with the agent</div>
          </div>
        </Show>

        <For each={messages()}>
          {(msg) => (
            <div class={`message ${msg.role}`}>
              <div class="message-header">
                <span class="message-role">{msg.role === 'user' ? 'You' : 'Agent'}</span>
                <span class="message-time">{new Date(msg.timestamp).toLocaleTimeString()}</span>
              </div>
              <div class="message-content">
                <pre>{msg.content}</pre>
              </div>
              <Show when={msg.toolCalls && msg.toolCalls.length > 0}>
                <div class="tool-calls">
                  <For each={msg.toolCalls}>
                    {(tool) => (
                      <div class={`tool-call ${tool.status}`}>
                        <span class="tool-name">[{tool.name}]</span>
                        <Show when={tool.status === 'pending'}>
                          <span class="tool-status">running...</span>
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          )}
        </For>

        <div ref={messagesEndRef} />
      </div>

      <Show when={error()}>
        <div class="error-banner">
          <span>{error()}</span>
          <button onClick={() => setError(null)}>×</button>
        </div>
      </Show>

      <div class="chat-input">
        <input
          type="text"
          placeholder={isStreaming() ? 'Agent is thinking...' : 'Type a message...'}
          value={input()}
          onInput={(e) => setInput(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
          disabled={isStreaming()}
        />
        <button
          class="send-btn"
          onClick={handleSend}
          disabled={isStreaming() || !input().trim()}
        >
          {isStreaming() ? '...' : '➤'}
        </button>
      </div>
    </div>
  )
}

export default AgentChatPanel