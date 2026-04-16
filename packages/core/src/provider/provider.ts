/**
 * Provider Service - Provider层抽象
 *
 * 继承OpenCode的AI SDK v3集成，支持多Provider:
 * - Anthropic (Claude)
 * - OpenAI
 * - Google
 * - AWS Bedrock
 * - Azure
 *
 * 参考来源: opencode/packages/opencode/src/provider/provider.ts
 */

import { Effect, Layer, Context } from 'effect'
import type { Model, Provider, ProviderConfig, AIProviderClient } from './types.js'

// ============================================================================
// Bundled Providers
// ============================================================================

/**
 * Provider registry
 */
export interface ProviderRegistry {
  register(provider: Provider): Effect.Effect<void>
  get(id: string): Effect.Effect<Provider>
  list(): Effect.Effect<Provider[]>
  getDefault(): Effect.Effect<Provider>
}

/**
 * Provider registry tag
 */
export const ProviderRegistryTag = Context.GenericTag<ProviderRegistry>('@hybrid-agent/provider-registry')

/**
 * Create Provider Registry layer
 */
export const ProviderRegistryLayer = Layer.effect(
  ProviderRegistryTag,
  Effect.gen(function* () {
    const providers = new Map<string, Provider>()

    return ProviderRegistry.of({
      register(provider) {
        return Effect.sync(() => {
          providers.set(provider.id, provider)
        })
      },

      get(id) {
        return Effect.sync(() => {
          const provider = providers.get(id)
          if (!provider) {
            throw new Error(`Provider not found: ${id}`)
          }
          return provider
        })
      },

      list() {
        return Effect.sync(() => Array.from(providers.values()))
      },

      getDefault() {
        return Effect.gen(function* () {
          // Return first registered provider or anthropic as default
          const list = yield* Effect.sync(() => Array.from(providers.values()))
          if (list.length === 0) {
            // Default to anthropic if no providers registered
            return yield* Effect.sync(() => {
              const defaultProvider = createAnthropicProvider()
              providers.set(defaultProvider.id, defaultProvider)
              return defaultProvider
            })
          }
          return list[0]
        })
      },
    })
  })
)

// ============================================================================
// Provider Factory Functions
// ============================================================================

/**
 * Create Anthropic provider
 * 来自: opencode/packages/opencode/src/provider/
 */
function createAnthropicProvider(): Provider {
  return {
    id: 'anthropic',
    name: 'Anthropic',
    models: [
      {
        id: 'claude-opus-4-6',
        providerID: 'anthropic',
        name: 'Claude Opus 4.6',
        family: 'claude',
        capabilities: {
          temperature: true,
          topP: true,
          topK: true,
          reasoning: true,
          toolcall: true,
          inputModalities: ['text', 'image'],
          outputModalities: ['text', 'image'],
        },
        cost: {
          input: 3.75, // $3.75 per 1M input
          output: 18.75, // $18.75 per 1M output
          cache: {
            input: 0.30,
            output: 18.75,
          },
        },
        limits: {
          context: 200000,
          input: 180000,
          output: 8192,
        },
      },
      {
        id: 'claude-sonnet-4-6',
        providerID: 'anthropic',
        name: 'Claude Sonnet 4.6',
        family: 'claude',
        capabilities: {
          temperature: true,
          topP: true,
          topK: true,
          reasoning: true,
          toolcall: true,
          inputModalities: ['text', 'image'],
          outputModalities: ['text', 'image'],
        },
        cost: {
          input: 1.5,
          output: 7.5,
          cache: {
            input: 0.30,
            output: 7.5,
          },
        },
        limits: {
          context: 200000,
          input: 180000,
          output: 8192,
        },
      },
    ],
    createClient(config: ProviderConfig): AIProviderClient {
      // Placeholder - in real implementation, create actual AI SDK client
      return {
        async chat(messages, options) {
          // Placeholder implementation
          return {
            content: 'Placeholder response',
            usage: {
              inputTokens: 100,
              outputTokens: 50,
              totalTokens: 150,
            },
          }
        },
        async embed(text) {
          // Placeholder implementation
          return new Array(1536).fill(0).map(() => Math.random())
        },
      }
    },
  }
}

/**
 * Create OpenAI provider
 */
function createOpenAIProvider(): Provider {
  return {
    id: 'openai',
    name: 'OpenAI',
    models: [
      {
        id: 'gpt-4o',
        providerID: 'openai',
        name: 'GPT-4o',
        family: 'gpt',
        capabilities: {
          temperature: true,
          topP: true,
          topK: false,
          reasoning: false,
          toolcall: true,
          inputModalities: ['text', 'image'],
          outputModalities: ['text', 'image'],
        },
        cost: {
          input: 5.0,
          output: 15.0,
        },
        limits: {
          context: 128000,
          input: 120000,
          output: 16384,
        },
      },
    ],
    createClient(config: ProviderConfig): AIProviderClient {
      return {
        async chat(messages, options) {
          return {
            content: 'Placeholder response',
            usage: {
              inputTokens: 100,
              outputTokens: 50,
              totalTokens: 150,
            },
          }
        },
        async embed(text) {
          return new Array(1536).fill(0).map(() => Math.random())
        },
      }
    },
  }
}

/**
 * Create Google provider
 */
function createGoogleProvider(): Provider {
  return {
    id: 'google',
    name: 'Google',
    models: [
      {
        id: 'gemini-2.5-pro',
        providerID: 'google',
        name: 'Gemini 2.5 Pro',
        family: 'gemini',
        capabilities: {
          temperature: true,
          topP: true,
          topK: true,
          reasoning: true,
          toolcall: true,
          inputModalities: ['text', 'image'],
          outputModalities: ['text', 'image'],
        },
        cost: {
          input: 0.125,
          output: 0.5,
        },
        limits: {
          context: 1000000,
          input: 80000,
          output: 8192,
        },
      },
    ],
    createClient(config: ProviderConfig): AIProviderClient {
      return {
        async chat(messages, options) {
          return {
            content: 'Placeholder response',
            usage: {
              inputTokens: 100,
              outputTokens: 50,
              totalTokens: 150,
            },
          }
        },
        async embed(text) {
          return new Array(1536).fill(0).map(() => Math.random())
        },
      }
    },
  }
}

// ============================================================================
// Provider Service (for runtime use)
// ============================================================================

/**
 * Provider service for making LLM calls
 */
export interface ProviderService {
  chat(
    providerID: string,
    messages: { role: string; content: string }[],
    options?: {
      model?: string
      temperature?: number
      maxTokens?: number
    }
  ): Effect.Effect<{
    content: string
    reasoning?: string
    toolCalls?: { name: string; input: Record<string, unknown>; callID: string }[]
    usage: { inputTokens: number; outputTokens: number; totalTokens: number }
  }>
}

/**
 * Provider service tag for Effect context
 */
export const ProviderServiceTag = Context.GenericTag<ProviderService>('@hybrid-agent/provider')

/**
 * Create Provider Service layer
 */
export const ProviderServiceLayer = Layer.effect(
  ProviderServiceTag,
  Effect.gen(function* () {
    const registry = yield* ProviderRegistryTag

    // Register bundled providers
    yield* registry.register(createAnthropicProvider())
    yield* registry.register(createOpenAIProvider())
    yield* registry.register(createGoogleProvider())

    return ProviderService.of({
      chat(providerID, messages, options) {
        return Effect.gen(function* () {
          const provider = yield* registry.get(providerID)
          const config: ProviderConfig = {
            id: providerID,
            name: provider.name,
          }
          const client = provider.createClient(config)

          const response = yield* Effect.promise(() =>
            client.chat(
              messages.map((m) => ({ role: m.role as 'system' | 'user' | 'assistant', content: m.content })),
              options
            )
          )

          return {
            content: response.content,
            reasoning: response.reasoning,
            toolCalls: response.toolCalls,
            usage: response.usage,
          }
        })
      },
    })
  })
)

// ============================================================================
// Default Provider Selection
// ============================================================================

/**
 * Environment-based provider selection
 */
export function getProviderFromEnv(): { providerID: string; modelID?: string } {
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  const openaiKey = process.env.OPENAI_API_KEY
  const googleKey = process.env.GOOGLE_API_KEY

  if (anthropicKey) {
    return { providerID: 'anthropic', modelID: 'claude-opus-4-6' }
  }

  if (openaiKey) {
    return { providerID: 'openai', modelID: 'gpt-4o' }
  }

  if (googleKey) {
    return { providerID: 'google', modelID: 'gemini-2.5-pro' }
  }

  // Default
  return { providerID: 'anthropic', modelID: 'claude-sonnet-4-6' }
}
