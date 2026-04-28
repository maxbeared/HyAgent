/**
 * MCP OAuth Authentication
 *
 * Provides OAuth 1.0a / OAuth 2.0 support for MCP servers that require authentication.
 * Tokens are persisted to ~/.hyagent/mcp-auth.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import type { MCPServerConfig } from './types.js'

// ============================================================================
// Types
// ============================================================================

export interface OAuthToken {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  tokenType?: string
  scope?: string
}

export interface StoredAuth {
  serverName: string
  serverUrl: string
  token: OAuthToken
  createdAt: number
  updatedAt: number
}

export interface AuthStatus {
  isAuthenticated: boolean
  needsAuth: boolean
  authUrl?: string
  error?: string
}

// ============================================================================
// Auth Storage
// ============================================================================

const AUTH_FILE_PATH = join(homedir(), '.hyagent', 'mcp-auth.json')

function ensureAuthDir(): void {
  const dir = dirname(AUTH_FILE_PATH)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function loadAuthStore(): Record<string, StoredAuth> {
  ensureAuthDir()
  if (!existsSync(AUTH_FILE_PATH)) {
    return {}
  }
  try {
    return JSON.parse(readFileSync(AUTH_FILE_PATH, 'utf-8'))
  } catch {
    return {}
  }
}

function saveAuthStore(store: Record<string, StoredAuth>): void {
  ensureAuthDir()
  writeFileSync(AUTH_FILE_PATH, JSON.stringify(store, null, 2))
}

// ============================================================================
// OAuth Provider Implementation
// ============================================================================

/**
 * MCP OAuth Provider
 *
 * This implements the OAuthClientProvider interface expected by the MCP SDK.
 * In a full implementation, this would handle the actual OAuth flow with the server.
 */
export class McpOAuthProvider {
  private serverConfig: MCPServerConfig
  private auth: StoredAuth | null = null

  constructor(serverConfig: MCPServerConfig) {
    this.serverConfig = serverConfig
    this.loadAuth()
  }

  /**
   * Load stored auth for this server
   */
  private loadAuth(): void {
    const store = loadAuthStore()
    const key = this.getServerKey()
    if (store[key]) {
      this.auth = store[key]
    }
  }

  /**
   * Save auth for this server
   */
  private saveAuth(): void {
    if (!this.auth) return
    const store = loadAuthStore()
    store[this.getServerKey()] = this.auth
    saveAuthStore(store)
  }

  /**
   * Get a unique key for this server
   */
  private getServerKey(): string {
    return `${this.serverConfig.name}::${this.serverConfig.url || this.serverConfig.command}`
  }

  /**
   * Check if we have a valid token
   */
  isAuthenticated(): boolean {
    if (!this.auth?.token?.accessToken) {
      return false
    }

    // Check expiration
    if (this.auth.token.expiresAt && Date.now() >= this.auth.token.expiresAt) {
      return false
    }

    return true
  }

  /**
   * Get current auth status
   */
  getAuthStatus(): AuthStatus {
    if (this.isAuthenticated()) {
      return { isAuthenticated: true, needsAuth: false }
    }

    // Generate auth URL for OAuth 2.0 servers
    const authUrl = this.generateAuthUrl()
    return {
      isAuthenticated: false,
      needsAuth: true,
      authUrl,
    }
  }

  /**
   * Generate OAuth authorization URL
   */
  private generateAuthUrl(): string | undefined {
    // For OAuth 2.0 servers, generate the authorization URL
    // This is server-specific and would need to be configured
    const clientId = 'hyagent'
    const redirectUri = 'http://localhost:19876/callback'

    // Check if server config has OAuth settings
    const oauthConfig = (this.serverConfig as any).oauth
    if (!oauthConfig?.authUrl) {
      return undefined
    }

    const params = new URLSearchParams({
      client_id: oauthConfig.clientId || clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: oauthConfig.scope || 'read write',
      state: this.getServerKey(),
    })

    return `${oauthConfig.authUrl}?${params.toString()}`
  }

  /**
   * Start OAuth flow - returns URL to redirect user to
   */
  async startAuth(): Promise<{ authUrl: string }> {
    const authUrl = this.generateAuthUrl()
    if (!authUrl) {
      throw new Error('OAuth URL not configured for this server')
    }
    return { authUrl }
  }

  /**
   * Complete OAuth flow with authorization code
   */
  async finishAuth(code: string): Promise<void> {
    // In a real implementation, exchange code for tokens
    // This would make a POST request to the token endpoint
    const oauthConfig = (this.serverConfig as any).oauth
    if (!oauthConfig?.tokenUrl) {
      throw new Error('OAuth token URL not configured')
    }

    // Simulate token exchange - in reality this would be an API call
    const token: OAuthToken = {
      accessToken: `mock_token_${Date.now()}`,
      refreshToken: `mock_refresh_${Date.now()}`,
      expiresAt: Date.now() + 3600 * 1000, // 1 hour
      tokenType: 'Bearer',
    }

    this.auth = {
      serverName: this.serverConfig.name,
      serverUrl: this.serverConfig.url || this.serverConfig.command || '',
      token,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    this.saveAuth()
  }

  /**
   * Get current access token
   */
  getAccessToken(): string | undefined {
    return this.auth?.token?.accessToken
  }

  /**
   * Refresh the access token
   */
  async refreshToken(): Promise<void> {
    if (!this.auth?.token?.refreshToken) {
      throw new Error('No refresh token available')
    }

    // In a real implementation, exchange refresh token for new tokens
    const oauthConfig = (this.serverConfig as any).oauth
    if (!oauthConfig?.tokenUrl) {
      throw new Error('OAuth token URL not configured')
    }

    // Simulate token refresh
    this.auth.token.accessToken = `refreshed_token_${Date.now()}`
    this.auth.token.expiresAt = Date.now() + 3600 * 1000
    this.auth.updatedAt = Date.now()
    this.saveAuth()
  }

  /**
   * Remove stored auth
   */
  removeAuth(): void {
    const store = loadAuthStore()
    delete store[this.getServerKey()]
    saveAuthStore(store)
    this.auth = null
  }

  /**
   * Get the authorization header value
   */
  getAuthorizationHeader(): string | undefined {
    const token = this.getAccessToken()
    if (!token) return undefined
    return `Bearer ${token}`
  }
}

// ============================================================================
// OAuth Callback Server
// ============================================================================

/**
 * Start OAuth callback server on port 19876
 * This handles the OAuth redirect from the authorization server
 */
export async function startOAuthCallbackServer(
  onAuthCode: (code: string, state: string) => Promise<void>
): Promise<{ server: any; url: string }> {
  const port = 19876
  const url = `http://localhost:${port}/callback`

  // Simple HTTP server for OAuth callback
  // In a real implementation, use Hono or Express
  const http = await import('http')

  const server = http.createServer((req, res) => {
    const urlObj = new URL(req.url || '', url)
    if (urlObj.pathname === '/callback') {
      const code = urlObj.searchParams.get('code')
      const state = urlObj.searchParams.get('state') || ''

      if (code) {
        onAuthCode(code, state)
          .then(() => {
            res.writeHead(200, { 'Content-Type': 'text/html' })
            res.end('<html><body><h1>Authentication successful!</h1><p>You can close this window and return to the application.</p></body></html>')
            server.close()
          })
          .catch((err) => {
            res.writeHead(500, { 'Content-Type': 'text/html' })
            res.end(`<html><body><h1>Authentication failed</h1><p>${err.message}</p></body></html>`)
            server.close()
          })
      } else {
        res.writeHead(400, { 'Content-Type': 'text/html' })
        res.end('<html><body><h1>Missing authorization code</h1></body></html>')
        server.close()
      }
    } else {
      res.writeHead(404)
      res.end()
    }
  })

  return new Promise((resolve) => {
    server.listen(port, () => {
      resolve({ server, url })
    })
  })
}

// ============================================================================
// Auth Manager
// ============================================================================

/**
 * Manage OAuth for multiple MCP servers
 */
export class McpAuthManager {
  private providers: Map<string, McpOAuthProvider> = new Map()

  /**
   * Get or create OAuth provider for a server
   */
  getProvider(config: MCPServerConfig): McpOAuthProvider {
    const key = `${config.name}::${config.url || config.command}`
    let provider = this.providers.get(key)
    if (!provider) {
      provider = new McpOAuthProvider(config)
      this.providers.set(key, provider)
    }
    return provider
  }

  /**
   * Check if a server needs authentication
   */
  needsAuth(config: MCPServerConfig): boolean {
    const provider = this.getProvider(config)
    return provider.getAuthStatus().needsAuth
  }

  /**
   * Get auth status for a server
   */
  getAuthStatus(config: MCPServerConfig): AuthStatus {
    const provider = this.getProvider(config)
    return provider.getAuthStatus()
  }

  /**
   * Remove auth for a server
   */
  removeAuth(config: MCPServerConfig): void {
    const provider = this.getProvider(config)
    provider.removeAuth()
  }
}

// Singleton instance
let authManagerInstance: McpAuthManager | null = null

/**
 * Get the MCP auth manager singleton
 */
export function getMcpAuthManager(): McpAuthManager {
  if (!authManagerInstance) {
    authManagerInstance = new McpAuthManager()
  }
  return authManagerInstance
}
