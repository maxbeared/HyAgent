/**
 * Configuration management
 * Scans for config files from hybrid-agent, Claude Code, and OpenCode.
 * hybrid-agent config is applied directly; others are presented as suggestions.
 */

import { existsSync, readFileSync } from 'fs'
import path from 'path'
import os from 'os'

export interface Config {
  provider: string
  baseUrl: string
  apiKey: string
  model: string
}

export interface ConfigSuggestion {
  source: 'hybrid-agent' | 'claude' | 'opencode'
  path: string
  config: Partial<Config>
}

function scanConfigPaths(): string[] {
  const candidates = [
    // hybrid-agent
    path.join(os.homedir(), '.hybrid-agent', 'config.json'),
    path.join(os.homedir(), '.config', 'hybrid-agent', 'config.json'),
    path.join(process.env.APPDATA || '', 'hybrid-agent', 'config.json'),
    // Claude Code
    path.join(os.homedir(), '.claude', 'settings.json'),
    path.join(process.env.APPDATA || '', 'Claude', 'settings.json'),
    path.join(process.env.LOCALAPPDATA || '', 'Claude', 'settings.json'),
    // OpenCode
    path.join(os.homedir(), '.config', 'opencode', 'opencode.jsonc'),
    path.join(os.homedir(), '.config', 'opencode', 'opencode.json'),
    path.join(os.homedir(), '.config', 'opencode', 'config.json'),
    path.join(process.env.APPDATA || '', 'opencode', 'opencode.jsonc'),
    path.join(process.env.APPDATA || '', 'opencode', 'opencode.json'),
    path.join(process.env.APPDATA || '', 'opencode', 'config.json'),
    // local
    path.join(process.cwd(), 'config.json'),
    path.join(process.cwd(), 'config.local.json'),
  ]
  return candidates.filter(p => existsSync(p))
}

function importConfig(configPath: string, base: Config): Config {
  try {
    const content = readFileSync(configPath, 'utf-8')
    let data: any
    try {
      data = JSON.parse(content)
    } catch {
      const jsonContent = content
        .replace(/\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
      data = JSON.parse(jsonContent)
    }

    // hybrid-agent native format: { provider, apiKey, baseUrl, model }
    if (data.provider && data.apiKey && typeof data.provider === 'string') {
      return { ...base, ...data }
    }

    // OpenCode format: { provider: { "providerId": { options: { apiKey, baseURL } } }, model: "provider/model" }
    if (data.provider && typeof data.provider === 'object') {
      for (const [providerName, providerData] of Object.entries(data.provider) as [string, any][]) {
        if (providerData?.options?.apiKey) {
          const imported: Partial<Config> = {
            provider: providerName,
            apiKey: providerData.options.apiKey,
          }
          if (providerData.options.baseURL) {
            imported.baseUrl = providerData.options.baseURL
          }
          if (data.model && typeof data.model === 'string' && data.model.includes('/')) {
            imported.model = data.model.split('/')[1]
          }
          return { ...base, ...imported }
        }
      }
    }

    // Claude Code settings.json: uses env vars
    if (data.env?.ANTHROPIC_API_KEY || data.env?.ANTHROPIC_AUTH_TOKEN) {
      return {
        ...base,
        apiKey: data.env.ANTHROPIC_API_KEY || data.env.ANTHROPIC_AUTH_TOKEN,
        baseUrl: data.env.ANTHROPIC_BASE_URL || base.baseUrl,
        model: data.env.ANTHROPIC_MODEL || base.model,
      }
    }

    return { ...base, ...data }
  } catch (e: any) {
    console.log(`Failed to parse config from ${configPath}: ${e.message}`)
    return base
  }
}

function sourceFromPath(configPath: string): 'hybrid-agent' | 'claude' | 'opencode' {
  if (configPath.includes('.claude')) return 'claude'
  if (configPath.includes('opencode')) return 'opencode'
  return 'hybrid-agent'
}

export function loadConfig(): { config: Config; suggestions: ConfigSuggestion[] } {
  let config: Config = {
    provider: 'minimaxi',
    baseUrl: 'https://api.minimaxi.com/anthropic',
    apiKey: process.env.ANTHROPIC_API_KEY ?? '',
    model: 'MiniMax-M2.7',
  }
  const suggestions: ConfigSuggestion[] = []

  for (const configPath of scanConfigPaths()) {
    const imported = importConfig(configPath, config)
    if (!imported.apiKey) continue

    const source = sourceFromPath(configPath)
    if (source === 'hybrid-agent') {
      config = imported
      console.log(`Loaded hybrid-agent config from: ${configPath}`)
    } else {
      suggestions.push({ source, path: configPath, config: imported })
      console.log(`Found ${source} config at: ${configPath} (as suggestion)`)
    }
  }

  return { config, suggestions }
}
