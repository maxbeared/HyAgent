# Hybrid Agent

结合 Claude Code 安全特性与 OpenCode 架构的 AI 编码 Agent。

## 重要规则

1. **未经用户允许，不能提交代码**
2. **单个代码文件超过500行需要重构**
3. **提交前先更新文档**

## 核心模块

| 模块 | 文件 | 关键特性 |
|------|------|----------|
| Agent Loop | `src/agent/loop.ts` | doom检测、重试、SSE流、checkpoint、hooks |
| Tools | `src/agent/tools.ts` | 13工具、并发执行、abort signal、agent类型过滤 |
| Permission | `src/permission.ts` | Zsh攻击、flag混淆、brace expansion检测 |
| Session | `src/session/` | SQLite持久化、fork、checkpoint |
| MCP | `src/mcp/` | OAuth、Prompts/Resources、多transport |
| Snapshot | `src/snapshot/` | Git-based文件跟踪、回滚 |
| Compaction | `src/agent/compaction.ts` | 选择性裁剪、reactive压缩警告 |
| Provider | `src/provider/` | LiteLLM/Bedrock转换 |
| Hooks | `src/agent/hooks.ts` | onTurnEnd/onTaskComplete等生命周期 |

## 架构原则

1. Effect优先 - 新代码使用Effect函数式模式
2. 安全第一 - 纵深防御安全检查
3. Provider无关 - 保持多Provider支持
4. 不修改原项目 - 仅作参考

## 开发

```bash
pnpm install && cp config.json.example config.json
pnpm dev    # 开发模式
pnpm repl   # REPL交互
pnpm build  # 构建
```

详细文档见 [README.md](README.md)
