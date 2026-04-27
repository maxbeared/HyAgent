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

**内置 Skills（5个）：**
- `/verify` — 验证代码更改
- `/debug` — 调试问题
- `/review` — 代码审查
- `/simplify` — 简化复杂代码
- `/remember` — 记住重要信息

### LSP (`src/lsp/`)
语言服务器协议支持，连接 40+ 种语言服务器。

**支持的语言/格式：**
| 类别 | 语言 |
|------|------|
| 编程语言 | TypeScript, Python, Rust, Go, Java, C#, C/C++, Swift, Zig, Lua, Dart, Scala, Kotlin, Elixir, Erlang, Clojure, Fortran, Pascal, OCaml, Verilog, VHDL, Haskell, Julia, R, Ruby, PHP |
| 标记/文档 | HTML, CSS, JSON, Markdown, YAML, XML, LaTeX, GraphQL, TOML |
| DevOps/配置 | Dockerfile, Terraform, Kubernetes, Properties, Makefile, Ninja |
| 数据/查询 | SQL |
| 其他 | Diff/Patch |

**工具函数：**
- `lspHover()` — 获取悬停信息
- `lspDefinition()` — 查找定义
- `lspReferences()` — 查找引用
- `lspDocumentSymbols()` — 文档符号
- `lspWorkspaceSymbol()` — 工作区符号搜索
- `lspDiagnostics()` — 诊断信息

### Document Tools (`src/tool/document.ts`)
Office 文档、多媒体和二进制文件处理。

**支持的文件类型：**
| 类别 | 扩展名 |
|------|--------|
| Office 文档 | .docx, .xlsx, .pptx, .odt, .ods, .odp |
| 图片 | .png, .jpg, .gif, .bmp, .webp, .svg, .ico, .tiff, .heic |
| 音频 | .mp3, .wav, .flac, .ogg, .m4a, .aac, .wma |
| 视频 | .mp4, .mkv, .avi, .mov, .wmv, .flv, .webm |
| 存档 | .zip, .tar, .gz, .bz2, .xz, .7z, .rar |
| 字体 | .ttf, .otf, .woff, .woff2, .eot |
| 3D/CAD | .stl, .obj, .fbx, .gltf, .glb, .step, .iges, .dwg |

**功能：**
- `extractText()` — 从 Office 文档提取文本内容
- `getFileMetadata()` — 获取文件元信息
- `detectFileFormat()` — 通过魔数检测文件格式
- `listSupportedTypes()` — 列出支持的文件类型

## 文件结构

```
.
├── packages/
│   ├── core/               # 核心 Agent 模块
│   │   └── src/
│   └── desktop/            # 桌面应用 (Tauri 2.x + Solid.js)
│       ├── src/            # 前端源码
│       └── src-tauri/      # Rust 后端
└── README.md
```

### Core 模块结构 (`packages/core/src/`)

```
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
│   ├── comprehensive-hooks.ts  # 全面钩子系统
│   ├── dynamic/        # 动态 Agent 生成
│   └── coordinator/    # 多Agent协调
│       ├── index.ts   # 协调服务
│       ├── types.ts   # 协调类型
│       └── subagent.ts # Subagent 工具
├── skill/              # Skill 系统
│   ├── index.ts       # Skill 管理
│   ├── discovery.ts   # Skill 发现
│   ├── types.ts      # Skill 类型
│   ├── service.ts    # Skill 服务
│   ├── url.ts        # Skill URL 拉取
│   └── builtin/      # 内置 Skills
│       └── index.ts  # verify, debug, review, simplify, remember
├── lsp/                 # LSP 支持
│   ├── index.ts       # LSP 服务 (40+ 语言服务器)
│   ├── client.ts      # LSP 客户端
│   ├── spawn.ts       # 服务器进程启动
│   ├── language.ts    # 语言 ID 映射
│   └── tool.ts        # LSP 工具函数
├── tool/               # 工具实现
│   ├── document.ts    # Office/多媒体文件处理
├── mcp/                # MCP 支持
│   ├── index.ts       # MCP 入口
│   ├── auth.ts        # OAuth 认证
│   ├── oauth2.ts     # OAuth 2.0 动态注册
│   ├── client.ts      # MCP 客户端
│   ├── manager.ts     # MCP 管理器
│   └── types.ts      # MCP 类型
├── plugin/             # Plugin 系统
├── provider/           # Provider 抽象
├── snapshot/           # 快照系统
│   ├── index.ts       # 快照管理
│   └── batch.ts       # 批量操作
├── bridge/             # WebSocket Bridge
├── bus/                # PubSub 事件
│   ├── index.ts       # 事件总线
│   ├── enhanced.ts    # 增强型事件（通配符订阅）
│   └── types.ts       # 事件类型
├── ide/                # IDE 扩展集成
├── mailbox/            # 邮箱系统（React Context）
├── notification/        # 通知队列
├── worktree/           # Git Worktree 管理
├── acp/                # Agent 通信协议
└── permission/         # 权限分类器
```

## 桌面应用 (packages/desktop)

跨平台桌面客户端，基于 Tauri 2.x + Solid.js 构建。

### 技术特性

| 指标 | 数值 |
|------|------|
| Windows 安装包 | ~5 MB |
| macOS 安装包 | ~8 MB |
| 离线支持 | 完全可离线运行 |

### 双模式设计

**简洁模式**：适合日常轻量使用，单一 Agent 对话视图
**专业模式**：完整面板布局，支持多 Agent 并行调度

### 面板系统

| 面板 | 说明 |
|------|------|
| Agent Chat | Agent 对话，支持流式输出、Markdown 渲染 |
| Console | 实时日志输出 |
| Explorer | 文件资源管理器 |
| Editor | 多 Tab 代码编辑器 |
| Settings | Provider、权限、压缩、语音等配置 |
| MCP | MCP Server 管理 |

### 交互特性

- **自由面板布局**：拖拽标题栏移动、边缘拖拽调整大小
- **右键菜单**：在空白区右键快速添加面板
- **系统托盘**：最小化到托盘，支持 show/hide/quit
- **语音输入**：支持 Web Speech API（需浏览器支持）
- **主题切换**：深色/浅色主题

### 构建

```bash
# 开发模式
cd packages/desktop
pnpm tauri dev

# 生产构建
pnpm tauri build

# 构建产物
# Windows: src-tauri/target/release/bundle/
#   ├── Hybrid-Agent_0.0.0_x64-setup.exe  (~3 MB)
#   ├── Hybrid-Agent_0.0.0_x64.msi        (~3.7 MB)
#   └── Hybrid-Agent_0.0.0_x64_en-US.msi
```

### 项目结构

```
packages/desktop/
├── src/
│   ├── lib/
│   │   ├── components/
│   │   │   ├── Panel/           # 面板系统
│   │   │   ├── AgentChat/       # Agent 对话
│   │   │   ├── Settings/        # 设置面板
│   │   │   ├── MCP/             # MCP 管理
│   │   │   └── VoiceInput/      # 语音输入
│   │   ├── stores/
│   │   │   ├── layout.ts        # 布局状态
│   │   │   ├── agent.ts        # Agent 会话
│   │   │   └── mcp.ts           # MCP 状态
│   │   └── services/
│   │       └── agentService.ts  # Agent 服务
│   ├── App.tsx
│   └── index.tsx
├── src-tauri/
│   ├── src/
│   │   ├── lib.rs               # Rust 入口
│   │   └── main.rs              # 主程序
│   ├── Cargo.toml
│   └── tauri.conf.json
└── package.json
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

## 测试

项目使用 Vitest 进行单元测试，Playwright 进行 E2E 测试。

### 运行测试

```bash
# 运行所有单元测试
pnpm --filter @hybrid-agent/core test

# 运行单元测试并查看覆盖率
pnpm --filter @hybrid-agent/core exec vitest run --coverage

# 运行 E2E 测试
pnpm --filter @hybrid-agent/core test:e2e

# 类型检查
pnpm --filter @hybrid-agent/core typecheck
```

### 测试覆盖率

| 指标 | 百分比 |
|------|--------|
| Statements | 86.21% |
| Branches | 72.24% |
| Functions | 94.82% |
| Lines | 86.31% |

### 测试结构

```
packages/core/
├── vitest.config.ts          # Vitest 配置
├── playwright.config.ts       # Playwright 配置
└── tests/
    ├── unit/                  # 单元测试
    │   ├── permission.test.ts    # 权限规则评估、Wildcard 匹配
    │   ├── classifier.test.ts    # YOLO 分类器、持久化
    │   ├── doomDetect.test.ts    # Doom 循环检测、进度跟踪
    │   ├── compaction.test.ts    # 会话压缩、Token 阈值
    │   └── session.test.ts        # Session 类型、Message 类型
    └── e2e/                   # E2E 测试
        └── agent-loop.spec.ts    # Agent 循环测试
```

### 桌面应用测试

桌面应用使用 Vitest + jsdom 进行前端测试，Cargo 进行 Rust 后端测试。

```bash
# 前端测试
cd packages/desktop
pnpm test              # 运行所有测试
pnpm test:watch        # 监听模式
pnpm test:coverage     # 覆盖率报告
pnpm test:unit         # 纯单元测试
pnpm test:component     # 组件测试

# Rust 后端测试
cd packages/desktop/src-tauri
cargo test
```

### 桌面测试结构

```
packages/desktop/
├── vitest.config.ts           # Vitest 配置 (jsdom + solid)
├── tests/
│   ├── setup/
│   │   └── global.ts          # 测试全局设置 (localStorage mock)
│   ├── unit/                  # 单元测试
│   │   ├── agent.test.ts      # Agent Store 测试
│   │   ├── settings.test.ts   # Settings Store 测试
│   │   ├── layout.test.ts     # Layout Store 测试
│   │   ├── mcp.test.ts        # MCP Store 测试
│   │   └── agentService.test.ts  # AgentService 测试
│   └── component/             # 组件测试
│       └── PanelSystem.test.tsx  # 面板系统测试
└── src-tauri/
    └── src/
        └── lib.rs             # Rust 测试 (cargo test)
```

### 编写新测试

```typescript
// tests/unit/example.test.ts
import { describe, it, expect } from 'vitest'

describe('module name', () => {
  it('should do something', () => {
    expect(true).toBe(true)
  })
})
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

## 质量优化特性

### 任务分解 (Task Decomposition)
- 复杂任务分解为可并行的子任务
- 依赖关系跟踪，确保执行顺序正确
- 支持嵌套任务树
- 进度追踪和结果聚合

### 验证 Agent (Verification Agent)
- **对抗性测试原则**: "你的工作不是确认实现有效，而是尝试破坏它"
- 必需验证步骤：build → test → linter → type-check
- 边界值测试、幂等性检查、错误处理探测
- 自动发现项目验证命令（从package.json读取）

### Plan Mode (5阶段工作流)
1. **Understanding**: 并行启动探索agent，理解问题空间
2. **Design**: 基于发现设计实现方案
3. **Review**: 评审计划完整性和正确性
4. **Final**: 将最终计划写入计划文件
5. **Approval**: 通过plan_exit tool请求用户批准

### Doom Loop 检测增强
- **Exact Loop**: 相同工具+相同输入重复N次
- **Pattern Loop**: 相同工具+类似输入（如同一文件不同offset）
- **Output Loop**: 工具输出重复，检测无进展
- **Progress Tracker**: 跟踪累积工具调用，检测"工作但无进展"状态

### 拒绝追踪 (Claude Code 风格)
- 追踪工具+模式拒绝次数
- 连续拒绝后建议 `always deny` 规则
- 时间窗口自动清理
- 支持持久化

### 工具元数据
- `searchHint`: 关键词提示帮助ToolSearch
- `isConcurrencySafe`: 工具是否可并发
- `isReadOnly`/`isDestructive`: 读写/破坏性标识
- `isSearchOrReadCommand`: UI折叠提示
- `userFacingName`: 用户友好名称

### 工具结果预算
- 累积输出大小追踪
- 超限时持久化到磁盘
- 返回预览+文件路径
- 7天自动清理

## 架构原则

1. **Effect优先** - 所有新代码使用 Effect 函数式模式
2. **安全第一** - Claude Code 的纵深防御安全
3. **Provider无关** - 保持多 Provider 支持能力
4. **不修改原项目** - 原项目仅作为参考

## 已知问题

### TypeScript 构建

部分深层架构问题需要较大范围重构才能彻底解决：

| 问题类型 | 数量 | 说明 |
|---------|------|------|
| Effect 类型不匹配 | ~10 | 实现返回 `Error, never` 但接口定义 `never, never` |
| Message content/parts | 6 | 代码使用 `content` 属性但类型定义要求 `parts` 数组 |
| Coordinator Effect | 8 | Queue/Scope/asUnit 等高层抽象类型问题 |
| Provider/ToolRegistry | 2 | 接口类型被当作值使用 |

**临时解决**：代码可正常运行，但 `pnpm build` 会报类型错误。

### 未实现功能（参考 OpenCode/Claude Code）

（已全部实现，详见各模块源码）
