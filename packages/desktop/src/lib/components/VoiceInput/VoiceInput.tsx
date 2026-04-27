import { Component, createSignal, Show, onCleanup } from 'solid-js'
import './VoiceInput.css'

export interface VoiceInputProps {
  onTranscript: (text: string) => void
  onCommand?: (command: string) => boolean
  disabled?: boolean
}

type RecognitionState = 'idle' | 'listening' | 'processing'

export const VoiceInput: Component<VoiceInputProps> = (props) => {
  const [state, setState] = createSignal<RecognitionState>('idle')
  const [transcript, setTranscript] = createSignal('')
  const [error, setError] = createSignal<string | null>(null)

  let recognition: any = null

  const isSupported = () => {
    return 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window
  }

  const initRecognition = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) return null

    recognition = new SpeechRecognition()
    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang = 'zh-CN'

    recognition.onstart = () => {
      setState('listening')
      setError(null)
    }

    recognition.onresult = (event: any) => {
      const result = event.results[event.results.length - 1]
      const text = result[0].transcript
      setTranscript(text)

      if (result.isFinal) {
        setState('processing')

        if (text.startsWith('/')) {
          const command = text.slice(1).toLowerCase().trim()
          const handled = props.onCommand?.(command)
          if (handled) {
            setTimeout(() => {
              setState('idle')
              setTranscript('')
            }, 500)
            return
          }
        }

        props.onTranscript(text)
        setTimeout(() => {
          setState('idle')
          setTranscript('')
        }, 300)
      }
    }

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error)
      if (event.error === 'not-allowed') {
        setError('Microphone access denied')
      } else if (event.error === 'no-speech') {
        setError('No speech detected')
      } else {
        setError(`Error: ${event.error}`)
      }
      setState('idle')
    }

    recognition.onend = () => {
      if (state() === 'listening') {
        setState('idle')
      }
    }

    return recognition
  }

  const startListening = () => {
    if (props.disabled) return

    if (!recognition) {
      recognition = initRecognition()
    }

    if (!recognition) {
      setError('Speech recognition not supported')
      return
    }

    try {
      recognition.start()
    } catch (e) {
      console.error('Failed to start recognition:', e)
    }
  }

  const stopListening = () => {
    if (recognition && state() === 'listening') {
      recognition.stop()
    }
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'v' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
      e.preventDefault()
      if (state() === 'idle') {
        startListening()
      }
    }
    if (e.key === 'Escape' && state() !== 'idle') {
      stopListening()
    }
  }

  document.addEventListener('keydown', handleKeyDown)

  onCleanup(() => {
    document.removeEventListener('keydown', handleKeyDown)
    if (recognition) {
      recognition.abort()
    }
  })

  return (
    <div class="voice-input-container">
      <button
        class="voice-btn"
        classList={{
          listening: state() === 'listening',
          processing: state() === 'processing',
          disabled: props.disabled || !isSupported(),
        }}
        onClick={() => (state() === 'idle' ? startListening() : stopListening())}
        title={`Voice input (Ctrl+Shift+V)`}
        disabled={props.disabled || !isSupported()}
      >
        <Show when={state() === 'listening'}>
          <div class="wave-animation">
            <span></span>
            <span></span>
            <span></span>
            <span></span>
            <span></span>
          </div>
        </Show>
        <Show when={state() !== 'listening'}>
          <span class="mic-icon">🎤</span>
        </Show>
      </button>

      <Show when={state() !== 'idle' || transcript()}>
        <div class="transcript-preview">
          <Show when={state() === 'listening'}>
            <span class="listening-text">{transcript() || 'Listening...'}</span>
          </Show>
          <Show when={state() === 'processing'}>
            <span class="processing-text">Processing...</span>
          </Show>
        </div>
      </Show>

      <Show when={error()}>
        <div class="error-toast">{error()}</div>
      </Show>
    </div>
  )
}

export default VoiceInput
