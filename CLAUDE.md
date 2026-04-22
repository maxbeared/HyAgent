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
| Tools | `src/agent/tools.ts` | 14工具、并发执行、abort signal、agent类型过滤、Claude Code风格元数据、plan_exit |
| Permission | `src/permission/` | Zsh攻击检测、拒绝追踪、wildcard规则匹配 |
| Session | `src/session/` | SQLite持久化、fork、checkpoint |
| MCP | `src/mcp/` | OAuth、Prompts/Resources、多transport |
| Snapshot | `src/snapshot/` | Git-based文件跟踪、回滚、增量StepPatch跟踪 |
| Compaction | `src/agent/compaction.ts` | 选择性裁剪、reactive压缩警告 |
| Provider | `src/provider/` | LiteLLM/Bedrock转换 |
| Hooks | `src/agent/hooks.ts` | onTurnEnd/onTaskComplete等生命周期 |
| Tool Budget | `src/tool/toolResultBudget.ts` | 工具结果预算、输出持久化、自动清理 |
| Task Decompose | `src/agent/taskDecompose.ts` | 任务分解、依赖跟踪、并行任务执行 |
| Verification | `src/agent/verification.ts` | 对抗性测试、构建验证、测试运行、回归检测 |
| Plan Mode | `src/agent/planMode.ts` | 5阶段规划工作流、探索agent、设计、实施、审批 |

详细文档见 [README.md](README.md)
