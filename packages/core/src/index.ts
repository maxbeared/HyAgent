/**
 * Hybrid Agent - 结合Claude Code安全特性与OpenCode架构
 *
 * 本项目融合两个参考项目的最佳特性:
 * - Claude Code: 成熟的安全沙箱、权限管道、Coordinator模式
 * - OpenCode: Provider无关性、Effect架构、函数式设计
 *
 * 参考来源:
 * - opencode/packages/opencode/src/
 * - Anthropic-Leaked-Source-Code/
 */

// ============================================================================
// Permission Module
// ============================================================================

export {
  PermissionServiceLayer,
  PermissionServiceTag,
  createDefaultContext,
  createPermissiveContext,
  createRestrictiveContext,
  createPlanContext,
  defaultBuildRuleset,
  defaultPlanRuleset,
  defaultExploreRuleset,
  sandboxManager,
  SandboxManager,
} from './permission/index.js'

export {
  validatePathSafety,
  validateCommandPaths,
  isUncPath,
  isBlockedDevicePath,
  isProtectedPath,
  isShellConfigPath,
  containsDangerousCommand,
  containsPathTraversal,
  BLOCKED_DEVICE_PATHS,
  PROTECTED_PATTERNS,
} from './permission/pathValidation.js'

export { evaluate, Wildcard, mergeRulesets } from './permission/evaluate.js'

export type {
  PermissionMode,
  PermissionResult,
  PermissionRequest,
  PermissionContext,
  Rule,
  Ruleset,
  PermissionDecision,
  PermissionRule,
  PermissionRuleSource,
  PathValidationResult,
  ClassifierResult,
} from './permission/types.js'

// ============================================================================
// Coordinator Module
// ============================================================================

export {
  CoordinatorServiceLayer,
  CoordinatorServiceTag,
  DEFAULT_PHASES,
  PHASE_DESCRIPTIONS,
} from './agent/coordinator/index.js'

export type {
  WorkerConfig,
  WorkerHandle,
  WorkerResult,
  WorkerStatus,
  WorkerMessage,
  CoordinatorResult,
  CoordinatorEvent,
  CoordinatorPhase,
  CoordinatorConfig,
  PhaseResult,
  AgentType,
  AgentInfo,
} from './agent/coordinator/types.js'

// ============================================================================
// Tool Module
// ============================================================================

export { BashTool, createBashTool } from './tool/bash.js'
export { ReadTool } from './tool/read.js'
export { EditTool } from './tool/edit.js'
export { ToolRegistryImpl, ToolRegistryLayer, ToolRegistryTag, executeTool } from './tool/registry.js'

export type {
  ToolDef,
  ToolContext,
  ToolMessage,
  ExecuteResult,
  ToolAttachment,
  Metadata,
  PermissionResult as ToolPermissionResult,
  SandboxContext,
  SandboxManager,
  ToolRegistry,
} from './tool/tool.js'

export {
  BashInput,
  ReadInput,
  EditInput,
  WriteInput,
  GlobInput,
  GrepInput,
} from './tool/tool.js'

// ============================================================================
// Session Module
// ============================================================================

export {
  SessionServiceLayer,
  SessionServiceTag,
  DEFAULT_COMPACTION_CONFIG,
  AGGRESSIVE_COMPACTION_CONFIG,
} from './session/index.js'

export type {
  Session,
  Message,
  MessagePart,
  CompactionConfig,
  CompactionResult,
  TokenBudget,
  SessionService,
} from './session/types.js'

// ============================================================================
// Provider Module
// ============================================================================

export {
  ProviderServiceLayer,
  ProviderServiceTag,
  ProviderRegistryLayer,
  getProviderFromEnv,
} from './provider/provider.js'

export type {
  Model,
  Provider,
  ProviderConfig,
  AIProviderClient,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  ToolCall,
} from './provider/types.js'

// ============================================================================
// Server Module
// ============================================================================

export {
  createServer,
  startServer,
  ServerServiceLayer,
} from './server/server.js'

export type {
  ServerConfig,
  ServerHandle,
  ServerService,
} from './server/server.js'
