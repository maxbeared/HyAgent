# Hybrid Agent

结合 Claude Code 安全特性与 OpenCode 架构的 AI 编码 Agent。

## 重要规则

1. **未经用户允许，不能提交代码**
2. **单个代码文件超过500行需要重构**
3. **提交前先更新文档**

## 核心模块

| 模块 | 文件 | 关键特性 |
|------|------|----------|
| Agent Loop | `src/agent/loop.ts` | doom检测、重试、SSE流、checkpoint、hooks、增强系统提示 |
| Tools | `src/agent/tools.ts` | 13工具、并发执行、abort signal、agent类型过滤、Claude Code风格元数据 |
| Permission | `src/permission/` | Zsh攻击检测、拒绝追踪、wildcard规则匹配 |
| Session | `src/session/` | SQLite持久化、fork、checkpoint |
| MCP | `src/mcp/` | OAuth、Prompts/Resources、多transport |
| Snapshot | `src/snapshot/` | Git-based文件跟踪、回滚、增量StepPatch跟踪 |
| Compaction | `src/agent/compaction.ts` | 选择性裁剪、reactive压缩警告 |
| Provider | `src/provider/` | LiteLLM/Bedrock转换 |
| Hooks | `src/agent/hooks.ts` | onTurnEnd/onTaskComplete等生命周期 |
| Tool Budget | `src/tool/toolResultBudget.ts` | 工具结果预算、输出持久化、自动清理 |

## 质量优化特性

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
