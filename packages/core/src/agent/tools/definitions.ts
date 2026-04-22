/**
 * Tool Definitions and Types
 *
 * Separated from tools.ts to reduce file size and improve maintainability.
 * Contains type definitions, tool metadata, and tool definitions array.
 */

/**
 * Agent type for tool filtering
 */
export type AgentType = 'default' | 'research' | 'coding' | 'review' | 'exploration'

// ============================================================================
// Tool Result Types
// ============================================================================

export interface ToolResult {
  output: string
  success: boolean
  truncated?: boolean
  requiresPermission?: boolean  // True when dangerous op needs user confirmation
  permissionReasons?: string[]  // Reasons why permission is needed
}

// ============================================================================
// Enhanced Tool Metadata (Claude Code style)
// ============================================================================

/**
 * Tool metadata for enhanced tool selection and UI rendering
 */
export interface ToolMetadata {
  /** Short keyword hint for ToolSearch (3-10 words) */
  searchHint?: string
  /** Whether this tool can run concurrently with others */
  isConcurrencySafe?: (input?: unknown) => boolean
  /** Whether this tool only reads data, never modifies */
  isReadOnly?: (input?: unknown) => boolean
  /** Whether this tool irreversibly modifies data */
  isDestructive?: (input?: unknown) => boolean
  /** UI hints for collapsing search/read operations */
  isSearchOrReadCommand?: (input?: unknown) => {
    isSearch: boolean
    isRead: boolean
    isList?: boolean
  }
  /** Max result size before truncation/persistence */
  maxResultSizeChars?: number
  /** User-facing name for this specific invocation */
  userFacingName?: (input?: unknown) => string
}

/**
 * Tool definition with full metadata
 */
export interface ToolDefinition {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
  metadata?: ToolMetadata
}

// ============================================================================
// Agent Type Tool Filters
// ============================================================================

export const CONCURRENT_SAFE_TOOLS = new Set(['read', 'glob', 'grep', 'websearch', 'webfetch', 'task', 'task_result', 'task_list', 'notebook', 'skill', 'plan_exit'])

/**
 * Tools available for each agent type
 */
export const AGENT_TOOL_FILTERS: Record<AgentType, string[]> = {
  default: [],
  research: ['read', 'glob', 'grep', 'websearch', 'webfetch'],
  coding: [],
  review: ['read', 'glob', 'grep', 'task', 'task_result', 'task_list'],
  exploration: ['websearch', 'webfetch', 'read', 'glob', 'grep'],
}

// ============================================================================
// Anthropic tool_use schema definitions
// ============================================================================

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'bash',
    description: 'Execute shell commands. Use for running scripts, installing packages, starting servers, and other system operations.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute' },
        cwd: { type: 'string', description: 'Working directory for the command' },
        timeout: { type: 'number', description: 'Timeout in milliseconds (default: 30000)' },
      },
      required: ['command'],
    },
  },
  {
    name: 'read',
    description: 'Read the contents of a file. Returns the file content as text.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or relative path to the file' },
        offset: { type: 'number', description: 'Line number to start reading from (0-indexed)' },
        limit: { type: 'number', description: 'Maximum number of lines to read' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write',
    description: 'Write content to a file. Creates the file if it does not exist, overwrites if it does.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path of the file to write' },
        content: { type: 'string', description: 'Content to write to the file' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit',
    description: 'Edit a file by replacing a specific string with a new string. The old_string must match exactly.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path of the file to edit' },
        old_string: { type: 'string', description: 'The exact string to find and replace' },
        new_string: { type: 'string', description: 'The replacement string' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'glob',
    description: 'Find files matching a glob pattern. Returns a list of matching file paths.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern (e.g. "**/*.ts", "src/**/*.json")' },
        cwd: { type: 'string', description: 'Directory to search in (default: current directory)' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'grep',
    description: 'Search for a pattern in files. Returns matching lines with file paths and line numbers.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regular expression or string to search for' },
        path: { type: 'string', description: 'File or directory to search in' },
        include: { type: 'string', description: 'File pattern to include (e.g. "*.ts")' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'websearch',
    description: 'Search the web for information. Use this when you need to find current information, look up facts, or research topics that require internet access.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Maximum number of results (default: 5)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'webfetch',
    description: 'Fetch the content of a web page. Use this to get detailed information from a specific URL.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to fetch' },
        maxLength: { type: 'number', description: 'Maximum content length (default: 10000)' },
      },
      required: ['url'],
    },
  },
  {
    name: 'task',
    description: 'Create and execute a background task. The task runs asynchronously and can be queried with task_result.',
    input_schema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'The task to execute (prompt for the agent)' },
        description: { type: 'string', description: 'Optional description of what this task does' },
      },
      required: ['task'],
    },
  },
  {
    name: 'task_result',
    description: 'Get the result of a background task created with the task tool.',
    input_schema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'The task ID returned from the task tool' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'task_list',
    description: 'List all running background tasks.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'notebook',
    description: 'Edit Jupyter notebooks. Use to view or modify notebook cells.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the notebook file (.ipynb)' },
        operation: { type: 'string', description: 'Operation: read, execute, insert, delete' },
        cell_index: { type: 'number', description: 'Cell index for insert/delete operations' },
        cell_type: { type: 'string', description: 'Cell type: code or markdown' },
        source: { type: 'string', description: 'Cell content for insert/update operations' },
      },
      required: ['path', 'operation'],
    },
  },
  {
    name: 'skill',
    description: 'Invoke a reusable skill by name. Skills are pre-defined prompt templates.',
    input_schema: {
      type: 'object',
      properties: {
        skill: { type: 'string', description: 'The skill name to invoke' },
        args: { type: 'string', description: 'Optional arguments for the skill' },
      },
      required: ['skill'],
    },
  },
  {
    name: 'plan_exit',
    description: 'Exit plan mode and request user approval for the proposed plan.',
    input_schema: {
      type: 'object',
      properties: {
        approve: { type: 'boolean', description: 'Whether to approve the plan' },
        reason: { type: 'string', description: 'Optional reason for approval/rejection' },
      },
      required: ['approve'],
    },
  },
]