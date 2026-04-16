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
├── server.ts           # Hono HTTP 路由（~250行）
└── agent/
    ├── loop.ts         # Agent 核心循环（并发工具执行、doom loop 检测、compaction）
    ├── tools.ts        # 工具定义 + 并发执行（read/glob/grep 并行，bash/edit 串行）
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
- Doom loop 检测（连续 3 次无实质文本输出的 tool-only 迭代 → 中止）
- Token budget 追踪（超 80k tokens 触发 session compaction）
- 消息格式正确（保留完整 assistant content，包括 text + tool_use）
- SSE 流式输出（`runAgentLoopStream` 异步生成器）

**API：**
- `POST /api/agent/execute` — 阻塞式执行
- `GET/POST /api/agent/stream` — SSE 流式执行

### Permission (src/permission.ts)
借鉴 Claude Code 的纵深防御安全检查。

**安全特性：**
- UNC 路径阻止（防止 NTLM 凭证泄露）
- 设备路径阻止（/dev/*）
- 敏感路径保护（.git/, .ssh/, .aws/）
- 路径遍历检测（../）
- 危险命令检测（rm -rf /, fork bomb, curl|sh）

### Tools (src/agent/tools.ts)
6 个内置工具，支持并发执行。

| 工具 | 并发安全 | 说明 |
|------|---------|------|
| read | ✓ | 读文件 |
| glob | ✓ | 文件模式搜索 |
| grep | ✓ | 内容搜索 |
| bash | ✗ | 执行命令 |
| write | ✗ | 写文件 |
| edit | ✗ | 替换文件内容 |

### Config (src/config.ts)
- hybrid-agent 自己的配置直接使用
- Claude Code / OpenCode 配置作为"建议"，需要用户通过 `POST /api/config/apply` 确认

### Server (src/server.ts)
Hono 服务端，提供完整 REST API。

## 开发

```bash
# 安装依赖
pnpm install

# 配置 (创建config.json)
cp config.json.example config.json
# 编辑config.json填入你的API key

# 开发模式
pnpm dev

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
