/**
 * Plugin System
 *
 * 提供插件扩展机制，支持动态加载 npm 包或本地路径的插件。
 *
 * 插件可以提供：
 * - 额外的工具
 * - 生命周期钩子
 *
 * 参考来源:
 * - Anthropic-Leaked-Source-Code/plugins/
 * - opencode/packages/opencode/src/plugin/
 */

// Re-export types
export {
  type Plugin,
  type PluginManifest,
  type PluginHooks,
  type PluginHooks as PluginHookTypes,
  type HookContext,
  type IterationResult,
  type PluginRegistration,
  type PluginLoadOptions,
  PluginManifestSchema,
} from './types.js'

// Re-export loader
export {
  PluginRegistry,
  PluginLoadError,
  PluginNotFoundError,
  loadPlugin,
  getPluginRegistry,
  PluginRegistryTag,
  PluginRegistryLayer,
} from './loader.js'
