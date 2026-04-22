/**
 * Tools Module
 *
 * Re-exports from submodules for backward compatibility.
 * Type definitions and tool executors have been moved to submodules
 * to reduce file size and improve maintainability.
 */

// Re-export types and definitions
export {
  type ToolResult,
  type ToolMetadata,
  type ToolDefinition,
  TOOL_DEFINITIONS,
  AGENT_TOOL_FILTERS,
  CONCURRENT_SAFE_TOOLS,
} from './definitions.js'

// Re-export executors
export {
  getToolDefinitions,
  getAgentTypes,
  isToolAvailableForAgent,
  executeTool,
  executeToolCallsConcurrently,
} from './executors.js'