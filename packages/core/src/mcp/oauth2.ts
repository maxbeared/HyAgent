/**
 * MCP OAuth 2.0 Dynamic Client Registration
 *
 * Dynamic client registration, SSE transport, per-server timeout.
 *
 * Reference: opencode/packages/opencode/src/mcp/oauth2.ts
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import { z } from 'zod'
import { randomUUID } from 'crypto'

// ============================================================================
// OAuth 2.0 Types
// ============================================================================

export const OAuth2ClientSchema = z.object({
  clientId: z.string(),
  clientSecret: z.string().optional(),
  registrationAccessToken: z.string().optional(),
  registeredAt: z.number(),
  expiresAt: z.number().optional(),
  metadata: z.record(z.unknown()).optional(),
})

export type OAuth2Client = z.infer<typeof OAuth2ClientSchema>

export const OAuth2TokenSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  expiresIn: z.number().optional(),
  expiresAt: z.number().optional(),
  tokenType: z.string().default('Bearer'),
  scope: z.string().optional(),
})

export type OAuth2Token = z.infer<typeof OAuth2TokenSchema>

// ============================================================================
// Dynamic Client Registration
// ============================================================================

export const DynamicRegistrationRequestSchema = z.object({
  clientName: z.string().default('HyAgent MCP'),
  redirectUris: z.array(z.string()),
  grantTypes: z.array(z.enum(['authorization_code', 'refresh_token'])).optional(),
  responseTypes: z.array(z.enum(['code'])).optional(),
  tokenEndpointAuthMethod: z.enum(['client_secret_basic', 'client_secret_post', 'none']).default('client_secret_basic'),
  scope: z.string().optional(),
})

export type DynamicRegistrationRequest = z.infer<typeof DynamicRegistrationRequestSchema>

export const DynamicRegistrationResponseSchema = z.object({
  clientId: z.string(),
  clientSecret: z.string().optional(),
  registrationAccessToken: z.string().optional(),
  registeredAt: z.number(),
  expiresAt: z.number().optional(),
})

export type DynamicRegistrationResponse = z.infer<typeof DynamicRegistrationResponseSchema>

// ============================================================================
// OAuth 2.0 Provider
// ============================================================================

const OAUTH2_CLIENT_STORE_PATH = join(homedir(), '.hyagent', 'mcp-oauth2-clients.json')

function ensureOAuth2Dir(): void {
  const dir = dirname(OAUTH2_CLIENT_STORE_PATH)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function loadOAuth2ClientStore(): Record<string, OAuth2Client> {
  ensureOAuth2Dir()
  if (!existsSync(OAUTH2_CLIENT_STORE_PATH)) {
    return {}
  }
  try {
    return JSON.parse(readFileSync(OAUTH2_CLIENT_STORE_PATH, 'utf-8'))
  } catch {
    return {}
  }
}

function saveOAuth2ClientStore(store: Record<string, OAuth2Client>): void {
  ensureOAuth2Dir()
  writeFileSync(OAUTH2_CLIENT_STORE_PATH, JSON.stringify(store, null, 2))
}

export class OAuth2Provider {
  private serverUrl: string
  private tokenEndpoint: string
  private registrationEndpoint: string
  private client: OAuth2Client | null = null
  private token: OAuth2Token | null = null

  constructor(options: {
    serverUrl: string
    tokenEndpoint?: string
    registrationEndpoint?: string
  }) {
    this.serverUrl = options.serverUrl
    this.tokenEndpoint = options.tokenEndpoint || `${this.serverUrl}/oauth/token`
    this.registrationEndpoint = options.registrationEndpoint || `${this.serverUrl}/oauth/register`
  }

  /**
   * Load stored client for this server
   */
  loadClient(serverName: string): void {
    const store = loadOAuth2ClientStore()
    this.client = store[serverName] || null
  }

  /**
   * Save client for this server
   */
  saveClient(serverName: string): void {
    if (!this.client) return
    const store = loadOAuth2ClientStore()
    store[serverName] = this.client
    saveOAuth2ClientStore(store)
  }

  /**
   * Register a new client dynamically
   */
  async registerClient(request: DynamicRegistrationRequest): Promise<OAuth2Client> {
    const response = await fetch(this.registrationEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    })

    if (!response.ok) {
      throw new Error(`Client registration failed: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()
    const result = DynamicRegistrationResponseSchema.parse(data)

    const client: OAuth2Client = {
      clientId: result.clientId,
      clientSecret: result.clientSecret,
      registrationAccessToken: result.registrationAccessToken,
      registeredAt: result.registeredAt || Date.now(),
      expiresAt: result.expiresAt,
    }

    this.client = client
    return client
  }

  /**
   * Unregister client
   */
  async unregisterClient(serverName: string): Promise<void> {
    if (!this.client?.registrationAccessToken) {
      return
    }

    try {
      await fetch(`${this.registrationEndpoint}/${this.client.clientId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${this.client.registrationAccessToken}`,
        },
      })
    } catch {
      // Ignore errors
    }

    const store = loadOAuth2ClientStore()
    delete store[serverName]
    saveOAuth2ClientStore(store)
    this.client = null
  }

  /**
   * Get or create client for server
   */
  async getOrCreateClient(serverName: string, request: DynamicRegistrationRequest): Promise<OAuth2Client> {
    this.loadClient(serverName)

    if (this.client) {
      // Check if client needs re-registration
      if (this.client.expiresAt && Date.now() >= this.client.expiresAt) {
        await this.unregisterClient(serverName)
        return this.registerClient(request)
      }
      return this.client
    }

    return this.registerClient(request)
  }

  /**
   * Obtain token using authorization code
   */
  async obtainToken(code: string, redirectUri: string): Promise<OAuth2Token> {
    if (!this.client) {
      throw new Error('No client registered')
    }

    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: this.client.clientId,
    })

    if (this.client.clientSecret) {
      params.set('client_secret', this.client.clientSecret)
    }

    const response = await fetch(this.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    })

    if (!response.ok) {
      throw new Error(`Token exchange failed: ${response.status}`)
    }

    const data = await response.json()
    this.token = OAuth2TokenSchema.parse(data)

    if (this.token.expiresIn) {
      this.token.expiresAt = Date.now() + this.token.expiresIn * 1000
    }

    return this.token
  }

  /**
   * Refresh access token
   */
  async refreshAccessToken(): Promise<OAuth2Token> {
    if (!this.client) {
      throw new Error('No client registered')
    }

    if (!this.token?.refreshToken) {
      throw new Error('No refresh token available')
    }

    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.token.refreshToken,
      client_id: this.client.clientId,
    })

    if (this.client.clientSecret) {
      params.set('client_secret', this.client.clientSecret)
    }

    const response = await fetch(this.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    })

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.status}`)
    }

    const data = await response.json()
    this.token = OAuth2TokenSchema.parse(data)

    if (this.token.expiresIn) {
      this.token.expiresAt = Date.now() + this.token.expiresIn * 1000
    }

    return this.token
  }

  /**
   * Get current access token (refreshing if needed)
   */
  async getAccessToken(): Promise<string> {
    if (!this.token) {
      throw new Error('No token obtained')
    }

    // Check if expired and refresh
    if (this.token.expiresAt && Date.now() >= this.token.expiresAt - 60000) {
      await this.refreshAccessToken()
    }

    return this.token!.accessToken
  }

  /**
   * Get current token info
   */
  getToken(): OAuth2Token | null {
    return this.token
  }

  /**
   * Clear token
   */
  clearToken(): void {
    this.token = null
  }

  /**
   * Get authorization header
   */
  async getAuthorizationHeader(): Promise<string> {
    const token = await this.getAccessToken()
    return `Bearer ${token}`
  }
}

// ============================================================================
// OAuth 2.0 Manager
// ============================================================================

export class OAuth2Manager {
  private providers: Map<string, OAuth2Provider> = new Map()

  /**
   * Get or create provider for server
   */
  getProvider(serverUrl: string): OAuth2Provider {
    let provider = this.providers.get(serverUrl)
    if (!provider) {
      provider = new OAuth2Provider({ serverUrl })
      this.providers.set(serverUrl, provider)
    }
    return provider
  }

  /**
   * Register client for server
   */
  async registerClient(
    serverName: string,
    serverUrl: string,
    request?: Partial<DynamicRegistrationRequest>
  ): Promise<OAuth2Client> {
    const provider = this.getProvider(serverUrl)
    const fullRequest: DynamicRegistrationRequest = {
      clientName: request?.clientName || 'HyAgent MCP',
      redirectUris: request?.redirectUris || ['http://localhost:19876/callback'],
      tokenEndpointAuthMethod: request?.tokenEndpointAuthMethod || 'client_secret_basic',
      scope: request?.scope,
    }

    const client = await provider.getOrCreateClient(serverName, fullRequest)
    provider.saveClient(serverName)
    return client
  }

  /**
   * Obtain token for server
   */
  async obtainToken(
    serverUrl: string,
    code: string,
    redirectUri: string
  ): Promise<OAuth2Token> {
    const provider = this.getProvider(serverUrl)
    return provider.obtainToken(code, redirectUri)
  }

  /**
   * Get access token for server
   */
  async getAccessToken(serverUrl: string): Promise<string> {
    const provider = this.getProvider(serverUrl)
    return provider.getAccessToken()
  }

  /**
   * Check if server has valid token
   */
  hasValidToken(serverUrl: string): boolean {
    const provider = this.providers.get(serverUrl)
    if (!provider) return false

    const token = provider.getToken()
    if (!token) return false

    if (token.expiresAt && Date.now() >= token.expiresAt) {
      return false
    }

    return true
  }
}

// ============================================================================
// SSE Transport with OAuth
// ============================================================================

export interface SSEOAuthTransportOptions {
  url: string
  oauth?: {
    serverUrl: string
    serverName: string
  }
  timeout?: number
  headers?: Record<string, string>
}

export class SSEOAuthTransport {
  private url: string
  private oauth: OAuth2Provider | null = null
  private timeout: number
  private headers: Record<string, string>
  private eventSource: EventSource | null = null
  private reconnectAttempts: number = 0
  private maxReconnectAttempts: number = 5
  private handlers: Map<string, Set<(data: unknown) => void>> = new Map()

  constructor(options: SSEOAuthTransportOptions) {
    this.url = options.url
    this.timeout = options.timeout || 30000
    this.headers = options.headers || {}

    if (options.oauth) {
      this.oauth = new OAuth2Provider({ serverUrl: options.oauth.serverUrl })
      this.oauth.loadClient(options.oauth.serverName)
    }
  }

  /**
   * Connect to SSE endpoint
   */
  async connect(): Promise<void> {
    // Add auth header if available
    const headers = { ...this.headers }

    if (this.oauth) {
      try {
        const authHeader = await this.oauth.getAuthorizationHeader()
        headers['Authorization'] = authHeader
      } catch {
        // No auth available yet
      }
    }

    // Build URL with headers
    // Note: EventSource doesn't support custom headers, so we use query params or cookies
    // In a real implementation, might use fetch with ReadableStream instead

    this.eventSource = new EventSource(this.url)

    this.eventSource.onopen = () => {
      this.reconnectAttempts = 0
    }

    this.eventSource.onerror = (err) => {
      console.error('[SSE] Error:', err)

      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++
        setTimeout(() => this.connect(), 1000 * this.reconnectAttempts)
      }
    }

    // Handle specific event types
    this.eventSource.addEventListener('message', (event: MessageEvent) => {
      this.emit('message', JSON.parse(event.data))
    })

    this.eventSource.addEventListener('tool', (event: MessageEvent) => {
      this.emit('tool', JSON.parse(event.data))
    })

    this.eventSource.addEventListener('error', (event: Event) => {
      this.emit('error', (event as any).data || 'Unknown error')
    })
  }

  /**
   * Disconnect from SSE endpoint
   */
  disconnect(): void {
    if (this.eventSource) {
      this.eventSource.close()
      this.eventSource = null
    }
  }

  /**
   * Subscribe to event
   */
  on(event: string, handler: (data: unknown) => void): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set())
    }
    this.handlers.get(event)!.add(handler)

    return () => {
      this.handlers.get(event)?.delete(handler)
    }
  }

  /**
   * Emit event to handlers
   */
  private emit(event: string, data: unknown): void {
    const handlers = this.handlers.get(event)
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data)
        } catch (e) {
          console.error(`[SSE] Handler error for ${event}:`, e)
        }
      }
    }
  }
}

// ============================================================================
// Per-Server Timeout
// ============================================================================

export interface ServerTimeoutConfig {
  connectTimeout: number
  idleTimeout: number
  maxLifetime: number
}

export const DEFAULT_TIMEOUT_CONFIG: ServerTimeoutConfig = {
  connectTimeout: 10000,
  idleTimeout: 60000,
  maxLifetime: 3600000, // 1 hour
}

export class ServerTimeoutManager {
  private timeouts: Map<string, {
    connectTimer: NodeJS.Timeout | null
    idleTimer: NodeJS.Timeout | null
    lifetimeTimer: NodeJS.Timeout | null
  }> = new Map()

  constructor(private config: ServerTimeoutConfig = DEFAULT_TIMEOUT_CONFIG) {}

  /**
   * Start timeouts for server
   */
  start(serverName: string, callbacks: {
    onConnectTimeout?: () => void
    onIdleTimeout?: () => void
    onMaxLifetime?: () => void
  }): void {
    const timers = {
      connectTimer: null,
      idleTimer: null,
      lifetimeTimer: null,
    }

    // Connect timeout
    if (callbacks.onConnectTimeout) {
      timers.connectTimer = setTimeout(() => {
        callbacks.onConnectTimeout!()
      }, this.config.connectTimeout)
    }

    // Idle timeout
    if (callbacks.onIdleTimeout) {
      timers.idleTimer = setTimeout(() => {
        callbacks.onIdleTimeout!()
      }, this.config.idleTimeout)
    }

    // Max lifetime
    if (callbacks.onMaxLifetime) {
      timers.lifetimeTimer = setTimeout(() => {
        callbacks.onMaxLifetime!()
      }, this.config.maxLifetime)
    }

    this.timeouts.set(serverName, timers)
  }

  /**
   * Reset idle timeout
   */
  resetIdle(serverName: string): void {
    const timers = this.timeouts.get(serverName)
    if (timers?.idleTimer) {
      clearTimeout(timers.idleTimer)
      // Will be restarted by caller
    }
  }

  /**
   * Stop timeouts for server
   */
  stop(serverName: string): void {
    const timers = this.timeouts.get(serverName)
    if (timers) {
      if (timers.connectTimer) clearTimeout(timers.connectTimer)
      if (timers.idleTimer) clearTimeout(timers.idleTimer)
      if (timers.lifetimeTimer) clearTimeout(timers.lifetimeTimer)
      this.timeouts.delete(serverName)
    }
  }

  /**
   * Stop all timeouts
   */
  stopAll(): void {
    for (const serverName of this.timeouts.keys()) {
      this.stop(serverName)
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let oauth2ManagerInstance: OAuth2Manager | null = null

export function getOAuth2Manager(): OAuth2Manager {
  if (!oauth2ManagerInstance) {
    oauth2ManagerInstance = new OAuth2Manager()
  }
  return oauth2ManagerInstance
}
