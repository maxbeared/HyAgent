/**
 * Provider Transform - Provider差异标准化
 *
 * 处理不同Provider之间的差异:
 * - LiteLLM proxy兼容
 * - AWS Bedrock cache tokens
 * - Anthropic/MiniMax 错误格式统一
 *
 * 参考来源: opencode/packages/opencode/src/provider/transform.ts
 */

/**
 * Provider类型标识
 */
export type ProviderType = 'anthropic' | 'openai' | 'google' | 'bedrock' | 'azure' | 'litellm' | 'minimax'

/**
 * 检测Provider类型
 */
export function detectProviderType(baseUrl: string, model?: string): ProviderType {
  const url = baseUrl.toLowerCase()

  if (url.includes('anthropic') || url.includes('ai.anthropic')) {
    return 'anthropic'
  }
  if (url.includes('openai') || url.includes('api.openai')) {
    return 'openai'
  }
  if (url.includes('google') || url.includes('generativelanguage')) {
    return 'google'
  }
  if (url.includes('bedrock') || url.includes('amazonaws')) {
    return 'bedrock'
  }
  if (url.includes('azure') || url.includes('microsoft')) {
    return 'azure'
  }
  if (url.includes('litellm') || url.includes('proxy')) {
    return 'litellm'
  }
  if (url.includes('minimax')) {
    return 'minimax'
  }

  return 'openai' // Default
}

/**
 * 检测是否为LiteLLM proxy
 */
export function isLiteLLMProxy(baseUrl: string): boolean {
  const url = baseUrl.toLowerCase()
  return url.includes('litellm') || url.includes('/v1') && url.includes('proxy')
}

/**
 * LiteLLM proxy请求转换
 *
 * LiteLLM会在以下情况返回错误:
 * - rate limit: 429
 * - context length: 422
 * - auth失败: 401
 *
 * 它也支持:
 * - model alias
 * - drop params
 * - retry-after header
 */
export function transformRequestForLiteLLM(request: {
  model?: string
  messages?: Array<{ role: string; content: string }>
  [key: string]: unknown
}): typeof request {
  // LiteLLM需要明确的model参数
  if (!request.model) {
    request.model = 'gpt-4o'
  }

  // 移除不支持的参数
  delete request.frequency_penalty
  delete request.presence_penalty

  // Anthropic特定的参数需要转换
  if (request.max_tokens === undefined) {
    request.max_tokens = 4096
  }

  return request
}

/**
 * LiteLLM proxy响应转换
 *
 * 将LiteLLM的错误响应标准化
 */
export function transformResponseFromLiteLLM(response: any): any {
  if (!response) return response

  // LiteLLM在错误时返回的格式
  if (response.error) {
    const error = response.error
    // Standardize error format
    return {
      ...response,
      error: {
        type: error.type || 'rate_limit_error',
        message: error.message || error.message,
        code: error.code,
      },
    }
  }

  return response
}

/**
 * AWS Bedrock请求转换
 *
 * Bedrock需要:
 * - 不同region的endpoint
 * - sigv4签名
 * - 特定的模型ID格式
 *
 * Cache tokens:
 * - 输入token的cache reads
 * - 需要追踪cache hit/miss
 */
export interface BedrockCacheMetrics {
  cacheHits?: number
  cacheMisses?: number
  cacheReadTokens?: number
}

export function transformRequestForBedrock(request: {
  model?: string
  messages?: Array<{ role: string; content: string }>
  [key: string]: unknown
}): { request: typeof request; cacheMetrics?: BedrockCacheMetrics } {
  const cacheMetrics: BedrockCacheMetrics = {}

  // Bedrock模型ID格式
  if (request.model) {
    // 例如: anthropic.claude-3-5-sonnet-20241022-v2:0
    // 保持原样，由AWS SDK处理
  }

  // Bedrock支持anthropic消息格式
  return { request, cacheMetrics }
}

/**
 * Bedrock响应转换
 *
 * 提取cache token使用情况
 */
export function transformResponseFromBedrock(response: any): { response: any; cacheMetrics?: BedrockCacheMetrics } {
  if (!response) return { response }

  const cacheMetrics: BedrockCacheMetrics = {}

  // Bedrock可能返回usage字段包含cache信息
  if (response.usage) {
    // Anthropic/Bedrock的cache tokens
    if (response.usage.cache_creation_tokens || response.usage.cache_read_tokens) {
      cacheMetrics.cacheReadTokens = response.usage.cache_read_tokens
    }
  }

  return { response, cacheMetrics }
}

/**
 * 通用请求转换
 *
 * 根据Provider类型应用适当的转换
 */
export function transformRequest(
  request: {
    model?: string
    messages?: Array<{ role: string; content: string }>
    [key: string]: unknown
  },
  providerType: ProviderType
): typeof request {
  switch (providerType) {
    case 'litellm':
      return transformRequestForLiteLLM(request)
    case 'bedrock':
      return transformRequestForBedrock(request).request
    default:
      return request
  }
}

/**
 * 通用响应转换
 *
 * 标准化不同Provider的响应格式
 */
export function transformResponse(
  response: any,
  providerType: ProviderType
): { response: any; cacheMetrics?: BedrockCacheMetrics } {
  switch (providerType) {
    case 'litellm':
      return { response: transformResponseFromLiteLLM(response) }
    case 'bedrock':
      return transformResponseFromBedrock(response)
    default:
      return { response }
  }
}

/**
 * 检测是否为rate limit错误
 */
export function isRateLimitError(error: any): boolean {
  if (!error) return false

  const status = error.status || error.statusCode
  if (status === 429 || status === '429') return true

  const type = error.type || error.error?.type
  if (type === 'rate_limit_error' || type === 'rate_limit') return true

  const code = error.code || error.error?.code
  if (code === 'rate_limit_exceeded' || code === 'RATE_LIMIT') return true

  return false
}

/**
 * 检测是否为context length错误
 */
export function isContextLengthError(error: any): boolean {
  if (!error) return false

  const status = error.status || error.statusCode
  if (status === 422 || status === '422') return true

  const type = error.type || error.error?.type
  if (type === 'context_length_exceeded' || type === 'invalid_request_error') return true

  const message = error.message || error.error?.message || ''
  if (message.includes('context') && message.includes('length')) return true

  return false
}

/**
 * 从错误响应中提取有用的信息
 */
export function extractErrorInfo(error: any): {
  message: string
  retryable: boolean
  retryAfterMs?: number
  code?: string
} {
  const message = error?.message || error?.error?.message || String(error)
  const code = error?.code || error?.error?.code
  const status = error?.status || error?.statusCode

  // Rate limit通常是可重试的
  const retryable = isRateLimitError(error)

  // 尝试从响应头获取retry-after
  let retryAfterMs: number | undefined
  if (error?.headers?.['retry-after-ms']) {
    retryAfterMs = parseInt(error.headers['retry-after-ms'], 10)
  } else if (error?.headers?.['retry-after']) {
    const retryAfter = parseInt(error.headers['retry-after'], 10)
    if (!isNaN(retryAfter)) {
      retryAfterMs = retryAfter * 1000
    }
  }

  return { message, retryable, retryAfterMs, code }
}
