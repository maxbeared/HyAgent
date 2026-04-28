import { Message } from '@anthropic-ai/sdk'
import type { AgentStreamEvent, AgentConfig } from '@hyagent/core'

export interface Session {
  id: string
  messages: Message[]
  createdAt: number
  updatedAt: number
}

export interface AgentState {
  sessionId: string
  status: 'idle' | 'running' | 'paused' | 'error'
  currentTask: string
  iterations: number
  totalTokens: number
}

/**
 * Agent Service - 集成 @hyagent/core 的核心功能
 *
 * 真实实现需要:
 * 1. 配置 API Provider (Anthropic/OpenAI/MiniMax)
 * 2. 调用 agent loop 的 streamChat 方法
 * 3. 处理 SSE 流式事件
 * 4. 管理会话状态
 */
export class AgentService {
  private config: AgentConfig | null = null
  private sessions: Map<string, Session> = new Map()

  configure(config: AgentConfig) {
    this.config = config
    console.log('[AgentService] Configured with:', {
      baseUrl: config.baseUrl,
      model: config.model,
      hasApiKey: !!config.apiKey
    })
  }

  isConfigured(): boolean {
    return this.config !== null && this.config.apiKey.length > 0
  }

  getConfig(): AgentConfig | null {
    return this.config
  }

  /**
   * 核心对话方法 - 模拟真实 API 调用
   * 在实际实现中，这里会调用 @hyagent/core 的 runAgentLoopStream
   */
  async *streamChat(
    sessionId: string,
    messages: Array<{ role: string; content: string }>,
    newMessage: string
  ): AsyncGenerator<AgentStreamEvent, void, unknown> {
    if (!this.config) {
      yield { type: 'error', error: 'Agent not configured. Please set API key in Settings.' }
      return
    }

    const allMessages = [
      ...messages,
      { role: 'user', content: newMessage }
    ]

    console.log('[AgentService] Sending message:', newMessage.substring(0, 50) + '...')

    // 模拟 LLM 响应的流式输出
    yield { type: 'text', content: '' }  // 开始流式响应

    // 模拟流式输出
    const responseText = await this.simulateLLMResponse(newMessage)

    for (const chunk of this.splitIntoChunks(responseText, 20)) {
      yield { type: 'text', content: chunk }
      await this.delay(30)
    }

    yield {
      type: 'done',
      iterations: 1,
      totalTokens: this.estimateTokens(newMessage + responseText)
    }
  }

  /**
   * 模拟 LLM 响应 - 实际使用时替换为真实 API 调用
   */
  private async simulateLLMResponse(input: string): Promise<string> {
    await this.delay(500)  // 模拟网络延迟

    // 基于输入生成合理的响应
    const responses = [
      `我收到了您的消息: "${input.substring(0, 50)}${input.length > 50 ? '...' : ''}"\n\n`,
      `正在分析您的问题...\n\n`,
      `根据您提供的描述，我有以下建议:\n\n`,
      `这个任务涉及多个步骤，让我来帮您完成。\n\n`,
      `我已经理解了您的需求，现在开始处理...\n\n`,
    ]

    const base = responses[Math.floor(Math.random() * responses.length)]

    // 添加一些实际的帮助内容
    const helpText = this.generateHelpfulResponse(input)

    return base + helpText
  }

  private generateHelpfulResponse(input: string): string {
    const lower = input.toLowerCase()

    if (lower.includes('代码') || lower.includes('code') || lower.includes('编程')) {
      return `作为 AI 编程助手，我可以帮助您:

1. **编写和修改代码** - 支持多种编程语言
2. **代码审查** - 发现潜在问题和优化点
3. **调试错误** - 帮助定位和修复 bug
4. **解释代码** - 帮助理解现有代码逻辑

请告诉我具体需要什么样的帮助，我会尽力协助您完成任务。`
    }

    if (lower.includes('文件') || lower.includes('file')) {
      return `我可以帮助您处理文件操作:

1. **读取文件** - 查看文件内容和结构
2. **写入文件** - 创建或修改文件
3. **搜索文件** - 使用 glob/grep 查找文件
4. **批量操作** - 同时处理多个文件

请告诉我需要操作哪个文件或执行什么任务。`
    }

    return `感谢您的消息！作为 HyAgent，我可以帮助您:

• 编写和调试代码
• 分析和解释代码
• 执行 Shell 命令
• 管理文件和项目
• 搜索和查找内容

请问有什么我可以帮您的？`
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  private *splitIntoChunks(text: string, size: number): Generator<string> {
    for (let i = 0; i < text.length; i += size) {
      yield text.slice(i, i + size)
    }
  }

  private estimateTokens(text: string): number {
    // 粗略估算: 中文约 2 字符/token，英文约 4 字符/token
    return Math.ceil(text.length / 3)
  }

  createSession(): Session {
    const id = `session_${Date.now()}`
    const session: Session = {
      id,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    this.sessions.set(id, session)
    console.log('[AgentService] Created session:', id)
    return session
  }

  getSession(id: string): Session | undefined {
    return this.sessions.get(id)
  }

  getAllSessions(): Session[] {
    return Array.from(this.sessions.values())
  }

  deleteSession(id: string): boolean {
    return this.sessions.delete(id)
  }

  getAgentState(sessionId: string): AgentState {
    return {
      sessionId,
      status: 'idle',
      currentTask: '',
      iterations: 0,
      totalTokens: 0,
    }
  }
}

export const agentService = new AgentService()