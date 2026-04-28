/**
 * Plugin Loader - 动态加载插件
 *
 * 支持从 npm 包或本地路径加载插件。
 */

import { Effect, Layer, Context } from 'effect'
import type { Plugin, PluginRegistration, PluginHooks, PluginLoadOptions, HookContext } from './types.js'
import { PluginManifestSchema } from './types.js'
import type { ToolDef } from '../tool/tool.js'

// ============================================================================
// Errors
// ============================================================================

export class PluginLoadError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message)
    this.name = 'PluginLoadError'
  }
}

export class PluginNotFoundError extends Error {
  constructor(name: string) {
    super(`Plugin not found: ${name}`)
    this.name = 'PluginNotFoundError'
  }
}

// ============================================================================
// Plugin Loader
// ============================================================================

/**
 * Load a plugin from a package name or local path
 */
export async function loadPlugin(options: PluginLoadOptions): Promise<Plugin> {
  const { name, options: pluginOptions } = options

  try {
    // Try to import the package
    let mod: Record<string, unknown>

    try {
      // Try as npm package first
      mod = await import(name)
    } catch {
      // Try as local path
      mod = await import(name)
    }

    // Find the plugin export
    const plugin = findPluginExport(mod)

    if (!plugin) {
      throw new PluginLoadError(`No valid plugin export found in ${name}`)
    }

    // Initialize the plugin if it has an init function
    if (typeof plugin.init === 'function') {
      await plugin.init()
    }

    return plugin
  } catch (err) {
    if (err instanceof PluginLoadError || err instanceof PluginNotFoundError) {
      throw err
    }
    throw new PluginLoadError(`Failed to load plugin ${name}`, err)
  }
}

/**
 * Find the plugin export from a module
 *
 * Plugins can export:
 * - A default export that is a Plugin instance
 * - A named export 'plugin' that is a Plugin instance
 * - A named export that matches the package name
 */
function findPluginExport(mod: Record<string, unknown>): Plugin | null {
  // Check default export
  if (mod.default && isPlugin(mod.default)) {
    return mod.default as Plugin
  }

  // Check 'plugin' named export
  if (mod.plugin && isPlugin(mod.plugin)) {
    return mod.plugin as Plugin
  }

  // Check for first Plugin-like export
  for (const [key, value] of Object.entries(mod)) {
    if (key !== 'default' && isPlugin(value)) {
      return value as Plugin
    }
  }

  return null
}

/**
 * Check if an object is a Plugin
 */
function isPlugin(obj: unknown): obj is Plugin {
  if (typeof obj !== 'object' || obj === null) {
    return false
  }

  const plugin = obj as Plugin

  // Must have name and version
  if (typeof plugin.name !== 'string' || typeof plugin.version !== 'string') {
    return false
  }

  // Must have at least one of the extension points
  return (
    typeof plugin.init === 'function' ||
    typeof plugin.getTools === 'function' ||
    typeof plugin.getHooks === 'function' ||
    typeof plugin.unload === 'function'
  )
}

// ============================================================================
// Plugin Registry
// ============================================================================

/**
 * Plugin Registry for managing loaded plugins
 */
export class PluginRegistry {
  private plugins: Map<string, PluginRegistration> = new Map()
  private globalHooks: PluginHooks[] = []

  /**
   * Register a plugin
   */
  register(plugin: Plugin): void {
    if (this.plugins.has(plugin.name)) {
      throw new PluginLoadError(`Plugin already registered: ${plugin.name}`)
    }

    const registration: PluginRegistration = {
      name: plugin.name,
      version: plugin.version,
      instance: plugin,
      tools: plugin.getTools?.() ?? [],
      hooks: plugin.getHooks?.() ?? {},
    }

    this.plugins.set(plugin.name, registration)

    // Register hooks
    if (Object.keys(registration.hooks).length > 0) {
      this.globalHooks.push(registration.hooks)
    }
  }

  /**
   * Unregister a plugin
   */
  async unregister(name: string): Promise<void> {
    const plugin = this.plugins.get(name)
    if (!plugin) {
      throw new PluginNotFoundError(name)
    }

    // Call unload if present
    if (typeof plugin.instance.unload === 'function') {
      await plugin.instance.unload()
    }

    this.plugins.delete(name)
  }

  /**
   * Get a plugin by name
   */
  get(name: string): PluginRegistration | undefined {
    return this.plugins.get(name)
  }

  /**
   * List all registered plugins
   */
  list(): PluginRegistration[] {
    return Array.from(this.plugins.values())
  }

  /**
   * Get all tools from all plugins
   */
  getAllTools(): ToolDef[] {
    const tools: ToolDef[] = []
    for (const plugin of this.plugins.values()) {
      tools.push(...plugin.tools)
    }
    return tools
  }

  /**
   * Execute a hook across all plugins
   */
  async executeHook<K extends keyof PluginHooks>(
    hookName: K,
    context: Parameters<NonNullable<PluginHooks[K]>>[0]
  ): Promise<void> {
    for (const hooks of this.globalHooks) {
      const hook = hooks[hookName]
      if (typeof hook === 'function') {
        try {
          await hook(context as any)
        } catch (err) {
          console.error(`Error executing hook ${hookName}:`, err)
        }
      }
    }
  }

  /**
   * Process tool definitions through all onToolDefinition hooks.
   * Each plugin can modify, add, or remove tool definitions.
   *
   * @param tools - Initial tool definitions
   * @returns Modified tool definitions after all hooks have been applied
   */
  async processToolDefinitions(tools: any[]): Promise<any[]> {
    let modifiedTools = [...tools]

    for (const hooks of this.globalHooks) {
      const hook = hooks.onToolDefinition
      if (typeof hook === 'function') {
        try {
          const result = await hook(modifiedTools)
          if (Array.isArray(result)) {
            modifiedTools = result
          }
        } catch (err) {
          console.error('Error in onToolDefinition hook:', err)
        }
      }
    }

    return modifiedTools
  }
}

// Singleton instance
let registryInstance: PluginRegistry | null = null

/**
 * Get the plugin registry singleton
 */
export function getPluginRegistry(): PluginRegistry {
  if (!registryInstance) {
    registryInstance = new PluginRegistry()
  }
  return registryInstance
}

// ============================================================================
// Effect Layer
// ============================================================================

/**
 * Plugin Registry tag for Effect context
 */
export const PluginRegistryTag = Context.GenericTag<PluginRegistry>('@hyagent/plugin-registry')

/**
 * Create a layer that provides the plugin registry
 */
export const PluginRegistryLayer = Layer.effect(
  PluginRegistryTag,
  Effect.sync(() => getPluginRegistry())
)
