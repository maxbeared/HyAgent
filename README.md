# Hybrid Agent

结合 Claude Code 安全特性与 OpenCode 架构的 AI 编码 Agent。

## 项目起源

本项目融合两个参考项目的最佳特性：
- **Claude Code**: 成熟的安全沙箱、权限管道、Coordinator模式
- **OpenCode**: Provider无关性、Effect架构、函数式设计

## 核心特性

### Agent Loop (`src/agent/loop.ts`)
核心 Agent 执行循环，能独立完成复杂任务。

**关键特性：**
- 并发工具执行（read/glob/grep 并行，bash/edit/write 串行）
- **精确 Doom loop 检测**：检查最近N(=3)条消息是否完全相同的工具+输入
- **丰富 StopReason**：completed, end_turn, max_iterations, doom_loop_detected, consecutive_tool_only, token_budget_exceeded, tool_execution_error, api_error, stopped_by_hook
- **LLM 重试机制**：支持 `retry-after` 头和指数退避
- **SSE 非阻塞流**：工具失败保持 SSE 流开放
- **Checkpoint 恢复**：失败后可从 checkpoint 恢复
- **Reactive Compaction**：70% 阈值警告

### Tools (`src/agent/tools.ts`)
13 个内置工具，支持 AbortSignal 取消和 Per-Agent 过滤。

| 工具 | 并发安全 | 说明 |
|------|---------|------|
| read | ✓ | 读文件（~ 展开） |
| glob | ✓ | 文件模式搜索 |
| grep | ✓ | 内容搜索 |
| bash | ✗ | 执行命令 |
| write | ✗ | 写文件 |
| edit | ✗ | 替换内容 |
| websearch | ✓ | 网页搜索 |
| webfetch | ✓ | 获取网页 |
| task | ✓ | 后台任务 |
| task_result | ✓ | 获取结果 |
| task_list | ✓ | 列出任务 |
| notebook | ✓ | Jupyter编辑 |
| skill | ✓ | 调用Skills |

**Agent 类型过滤：**
- `default` - 所有工具
- `research` - 只读
- `coding` - 所有工具
- `review` - 只读+任务
- `exploration` - Web+只读

### Permission (`src/permission.ts`)
借鉴 Claude Code 的纵深防御安全检查。

**检测类型：**
- UNC 路径阻止（防止 NTLM 泄露）
- 设备路径阻止（/dev/*）
- 敏感路径保护（.git/, .ssh/, .aws/）
- 路径遍历检测
- 危险命令检测（rm -rf /, fork bomb）
- **Zsh 攻击检测**（zmodload, sysopen, sysread, zpty, ztcp）
- **Brace expansion 检测**
- **Flag 混淆检测**（ANSI-C quoting, locale quoting）
- **Backslash 转义操作符检测**
- **IFS 注入检测**

### Session (`src/session/`)

**文件结构：**
- `types.ts` - Session/Message 类型定义
- `db.ts` - SQLite 持久化（better-sqlite3）
- `index.ts` - SessionService (Effect-based)

**API：**
- `POST /api/sessions` — 创建 session
- `GET /api/sessions` — 列出所有 session
- `POST /api/sessions/:id/fork` — Fork session
- `GET /api/sessions/:id/forks` — 获取子 forks
- `POST /api/sessions/:id/resume` — 从 checkpoint 恢复

**Session Fork：**
- 支持从任意消息点分叉
- 消息 ID 映射（original → new）
- 标题自动添加 `(fork #N)`
- 数据库字段：`parent_id`, `fork_count`

### MCP (`src/mcp/`)

**功能：**
- Stdio/HTTP/StreamableHTTP transport
- OAuth 认证支持
- Prompts/Resources 列表和读取
- Tool change notifications

**OAuth 流程：**
1. `GET /api/mcp/servers/:name/auth` — 获取认证状态
2. `POST /api/mcp/servers/:name/auth/start` — 启动 OAuth
3. `POST /api/mcp/servers/:name/auth/callback` — 完成认证
4. Token 持久化到 `~/.hybrid-agent/mcp-auth.json`

### Snapshot (`src/snapshot/`)
Git-based 文件跟踪和回滚系统。

**功能：**
- `createSnapshot()` — 创建快照
- `listSnapshots()` — 列出所有快照
- `diffSnapshots()` — 比较快照
- `restoreSnapshot()` — 从快照恢复
- `createRevertPoint()` — 创建回滚点

### Compaction (`src/agent/compaction.ts`)
会话压缩防止 context window 溢出。

**特性：**
- Token 阈值 80k
- 警告阈值 70%
- 选择性裁剪：保留最近 40k tokens + 保护工具（skill, read, glob, grep）
- 工具结果标记 `time.compacted: true`

### Provider Transform (`src/provider/transform.ts`)
Provider 差异标准化。

**支持：**
- LiteLLM proxy 兼容
- AWS Bedrock cache tokens
- `isRateLimitError()` / `isContextLengthError()` 检测
- `extractErrorInfo()` 统一错误提取

### Hooks (`src/agent/hooks.ts`)
生命周期钩子系统。

**钩子类型：**
- `onTurnEnd` — Turn 结束
- `onTaskComplete` — 任务完成
- `onIterationStart` — 迭代开始
- `onIterationEnd` — 迭代结束
- `onError` — 错误发生
- `onBeforeTool` / `onAfterTool` — 工具执行前后

### Server (`src/server.ts`)
Hono 服务端，完整 REST API。

**API 端点：**
- `POST /api/agent/execute` — 阻塞式执行
- `GET /api/agent/stream` — SSE 流式执行
- `POST /api/chat/:sessionId` — 连续对话
- `POST /api/tools/execute` — 执行单工具
- MCP/Plugin/Session 等完整管理 API

**SSE 事件类型：** `text`, `tool_start`, `tool_result`, `compaction`, `retry`, `done`, `error`

### REPL (`src/repl.ts`)
CLI REPL 工具，通过 SSE 与 agent 实时交互。

**命令：**
- `:help` — 显示帮助
- `:new` — 创建新 session
- `:sessions` — 列出所有 session
- `:session <id>` — 切换 session
- `:info` — 显示当前 session 信息
- `:checkpoint` — 查看 checkpoint
- `:quit` — 退出

**快捷键：** `Ctrl+C` 中断, `Ctrl+D` 退出, `Ctrl+L` 清屏

### Skills (`src/skill/`)
可复用提示模板系统。

**搜索目录（优先级递减）：**
1. `packages/core/src/skill/presets/` — 预置 Skills
2. `~/.agents/skills/`
3. `~/.claude/skills/`
4. `~/.hybrid-agent/skills/`
5. `.hybrid-agent/skills/` 或 `skills/`

**预置 Skills（6个）：**
- `agent-browser` — 无头浏览器自动化
- `find-skills` — 搜索 OpenClaw skills
- `github` — GitHub CLI 交互
- `multi-search-engine` — 16 搜索引擎
- `self-improvement` — 持续改进
- `skill-creator` — 创建新技能

## 文件结构

```
packages/core/src/
├── dev.ts              # 入口，启动 Hono 服务
├── config.ts           # 配置加载
├── permission.ts       # 安全检查
├── server.ts           # HTTP 路由
├── repl.ts             # CLI REPL
├── session/            # Session 管理
├── agent/
│   ├── loop.ts        # 核心循环
│   ├── doomDetect.ts  # Doom 检测
│   ├── tools.ts       # 工具系统
│   ├── checkpoint.ts   # Checkpoint
│   ├── compaction.ts  # 压缩
│   ├── hooks.ts       # 生命周期钩子
│   └── coordinator/    # 多Agent协调
├── skill/              # Skill 系统
├── tool/               # 工具实现
├── mcp/                # MCP 支持
├── plugin/             # Plugin 系统
├── provider/           # Provider 抽象
├── snapshot/           # 快照系统
├── bridge/             # WebSocket Bridge
├── bus/                # PubSub 事件
└── permission/         # 权限分类器
```

## 开发

```bash
# 安装依赖
pnpm install

# 配置
cp config.json.example config.json
# 编辑 config.json 填入 API key

# 开发模式
pnpm dev

# REPL 交互
pnpm repl

# 构建
pnpm build
```

## 配置文件

`config.json`（不提交到 git）：
```json
{
  "provider": "minimaxi",
  "baseUrl": "https://api.minimaxi.com/anthropic",
  "apiKey": "your-api-key-here",
  "model": "MiniMax-M2.7"
}
```

## 架构原则

1. **Effect优先** - 所有新代码使用 Effect 函数式模式
2. **安全第一** - Claude Code 的纵深防御安全
3. **Provider无关** - 保持多 Provider 支持能力
4. **不修改原项目** - 原项目仅作为参考
