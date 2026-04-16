/**
 * Provider Types - Provider层类型定义
 *
 * 参考来源: opencode/packages/opencode/src/provider/
 */

import { z } from 'zod'

// ============================================================================
// Model Types
// ============================================================================

/**
 * Provider ID
 */
export const ProviderID = z.string()
export type ProviderID = z.infer<typeof ProviderID>

/**
 * Model ID
 */
export const ModelID = z.string()
export type ModelID = z.infer<typeof ModelID>

/**
 * Model capabilities
 */
export interface ModelCapabilities {
  temperature: boolean
  topP: boolean
  topK: boolean
  reasoning: boolean
  toolcall: boolean
  inputModalities: ('text' | 'image')[]
  outputModalities: ('text' | 'image')[]
}

/**
 * Model cost configuration
 */
export interface ModelCost {
  input: number // per 1M tokens
  output: number // per 1M tokens
  cache?: {
    input: number
    output: number
  }
}

/**
 * Model limits
 */
export interface ModelLimits {
  context: number // max context tokens
  input: number // max input tokens
  output: number // max output tokens
}

/**
 * Model definition
 */
export interface Model {
  id: ModelID
  providerID: ProviderID
  name: string
  family: string
  capabilities: ModelCapabilities
  cost: ModelCost
  limits: ModelLimits
}

// ============================================================================
// Provider Types
// ============================================================================

/**
 * Provider configuration
 */
export interface ProviderConfig {
  id: ProviderID
  name: string
  apiKey?: string
  baseURL?: string
  region?: string
}

/**
 * Provider capability
 */
export interface Provider {
  id: ProviderID
  name: string
  models: Model[]
  createClient(config: ProviderConfig): AIProviderClient
}

/**
 * AI Provider client interface
 */
export interface AIProviderClient {
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse>
  embed(text: string): Promise<number[]>
}

/**
 * Chat message
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/**
 * Chat options
 */
export interface ChatOptions {
  model?: string
  temperature?: number
  maxTokens?: number
  topP?: number
  tools?: ToolDefinition[]
}

/**
 * Tool definition for chat
 */
export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
}

/**
 * Chat response
 */
export interface ChatResponse {
  content: string
  reasoning?: string
  toolCalls?: ToolCall[]
  usage: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
}

/**
 * Tool call from model
 */
export interface ToolCall {
  name: string
  input: Record<string, unknown>
  callID: string
}
