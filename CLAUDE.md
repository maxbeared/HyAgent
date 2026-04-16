# Hybrid Agent

结合Claude Code安全特性与OpenCode架构的AI编码Agent。

## 项目起源

本项目融合两个参考项目的最佳特性：

- **Claude Code (Anthropic-Leaked-Source-Code/)**: 成熟的安全沙箱、权限管道、Coordinator模式
- **OpenCode (../opencode/)**: Provider无关性、Effect架构、函数式设计

## 重要规则

1. **未经用户允许，不能提交代码**。所有代码变更必须经过用户明确确认后才能提交到git。
2. **单个代码文件过大时需要重构**。当一个文件超过500行时，应考虑拆分为多个小文件，保持代码可维护性。
3. **提交代码前先更新CLAUDE.md**。每次代码提交前，应先更新CLAUDE.md说明本次修改内容，再提交代码。

## 文件结构

```
packages/core/src/
├── dev.ts              # 入口（~30行），启动 Hono 服务
├── config.ts           # 配置加载：扫描 hybrid-agent/Claude/OpenCode 配置文件
├── permission.ts       # 路径/命令安全检查（借鉴 Claude Code pathValidation）
├── server.ts           # Hono HTTP 路由（~500行）
├── repl.ts             # CLI REPL 工具（与 agent 交互的终端界面）
└── agent/
    ├── loop.ts         # Agent 核心循环（精确 doom loop 检测、丰富 stop reasons、compaction）
    ├── doomDetect.ts   # 精确 doom loop 检测（借鉴 OpenCode：同工具+同输入重复N次）
    ├── tools.ts        # 工具定义 + 并发执行（read/glob/grep 并行，bash/edit 串行）+ 输出截断
    ├── checkpoint.ts   # 任务可恢复性（每轮保存 checkpoint，支持 resume）
    └── compaction.ts   # 会话压缩（token 超阈值时调用 LLM 生成摘要）
```

## 核心模块

### Agent Loop (src/agent/loop.ts)
核心 Agent 执行循环，能独立完成复杂任务（如开发完整 React 网页）。

**设计来源：**
- Claude Code `query.ts`: while(true) 循环，stop_reason 判断
- OpenCode `processor.ts`: doom loop 检测 (DOOM_LOOP_THRESHOLD=3)

**关键特性：**
- 并发工具执行（read/glob/grep 并行，bash/edit/write 串行）
- **精确 Doom loop 检测**（`doomDetect.ts`）：检查最近N(=3)条消息是否完全相同的工具+输入；`hasSubstantialText` 阈值 10 字符，短文本（如"继续"、"好的"）即可重置计数器
- **丰富的 StopReason 类型**：`completed`, `end_turn`, `max_turns`, `max_iterations`, `doom_loop_detected`, `consecutive_tool_only`, `token_budget_exceeded`, `tool_execution_error`, `api_error`
- **LLM 重试机制**：`callLLM` 单次调用，重试逻辑在上层；`formatAPIError()` 通用解析多种 provider 错误格式（OpenAI/Anthropic/MiniMax）
- **SSE 非阻塞流**：工具失败等非终止错误保持 SSE 流开放，agent 可继续运行
- **工具输出截断**：`tools.ts` 中所有工具输出超 8000 字符自动截断；`bash` 错误格式为 `Error (exit code N): ...`，`success: false` 明确
- **Checkpoint 恢复**：`checkpoint.ts` 每轮保存状态，失败后可 `POST /api/sessions/:id/resume` 恢复
- Token budget 追踪（超 80k tokens 触发 session compaction）
- 消息格式正确（保留完整 assistant content，包括 text + tool_use）
- SSE 流式输出（`runAgentLoopStream` 异步生成器）

**API：**
- `POST /api/agent/execute` — 阻塞式执行
- `GET/POST /api/agent/stream` — SSE 流式执行
- `POST /api/sessions/:id/resume` — 从 checkpoint 恢复任务

### Permission (src/permission.ts)
借鉴 Claude Code 的纵深防御安全检查。

**安全特性：**
- UNC 路径阻止（防止 NTLM 凭证泄露）
- 设备路径阻止（/dev/*）
- 敏感路径保护（.git/, .ssh/, .aws/）
- 路径遍历检测（../）
- 危险命令检测（rm -rf /, fork bomb, curl|sh）

### Tools (src/agent/tools.ts)
6 个内置工具，支持并发执行。所有工具路径支持 `~` 展开为用户目录。

| 工具 | 并发安全 | 说明 |
|------|---------|------|
| read | ✓ | 读文件（~ 展开） |
| glob | ✓ | 文件模式搜索 |
| grep | ✓ | 内容搜索 |
| bash | ✗ | 执行命令，错误格式 `Error (exit code N): ...` |
| write | ✗ | 写文件（~ 展开） |
| edit | ✗ | 替换文件内容（~ 展开） |

### Config (src/config.ts)
- hybrid-agent 自己的配置直接使用
- Claude Code / OpenCode 配置作为"建议"，需要用户通过 `POST /api/config/apply` 确认

### Server (src/server.ts)
Hono 服务端，提供完整 REST API。

**新增端点（2026-04-16）：**
- `GET /api/sessions/:id/resume` — 查看 session 的 checkpoint
- `POST /api/sessions/:id/resume` — 从 checkpoint 恢复并继续任务
- `DELETE /api/sessions/:id/checkpoint` — 删除 checkpoint

**SSE 事件类型：** `text`, `tool_start`, `tool_result`, `compaction`, `retry`, `done`, `error`
非终止错误（如 `tool_execution_error`）不会关闭 SSE 流，agent 可继续处理。

### REPL (src/repl.ts)
最小化 CLI 界面，通过 SSE 与 agent 实时交互，支持 session 管理和 checkpoint 查看。

默认连接 `http://localhost:3001`，可通过 `HYBRID_AGENT_URL` 环境变量修改。

```bash
# 默认端口 3001
pnpm repl

# 自定义端口
HYBRID_AGENT_URL=http://localhost:3000 pnpm repl
```

**REPL 命令：**
- `:help` — 显示帮助
- `:new` — 创建新 session
- `:sessions` — 列出所有 session
- `:session <id>` — 切换到指定 session
- `:info` — 显示当前 session 信息
- `:checkpoint` — 查看当前 session 的 checkpoint
- `:quit` — 退出 REPL

**快捷键：** `Ctrl+C` 中断当前任务，`Ctrl+D` 退出，`Ctrl+L` 清屏

## 开发

```bash
# 安装依赖
pnpm install

# 配置 (创建config.json)
cp config.json.example config.json
# 编辑config.json填入你的API key

# 开发模式
pnpm dev

# REPL 交互界面
pnpm repl

# 构建
pnpm build
```

## 配置文件

本地配置文件 `config.json` 包含敏感信息，**不要提交到git**：

```json
{
  "provider": "minimaxi",
  "baseUrl": "https://api.minimaxi.com/anthropic",
  "apiKey": "your-api-key-here",
  "model": "MiniMax-M2.7"
}
```

**配置导入**：系统会扫描Claude Code、OpenCode、hybrid-agent的配置文件作为建议，导入的配置不直接使用，需要用户通过API确认后才应用。

## 架构原则

1. **Effect优先** - 所有新代码使用Effect函数式模式
2. **安全第一** - 来自Claude Code的纵深防御安全
3. **Provider无关** - 保持多Provider支持能力
4. **不修改原项目** - 原项目仅作为参考
