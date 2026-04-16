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

## 核心模块

### Permission (src/permission/)
融合Claude Code和OpenCode的权限系统。

**关键文件：**
- `index.ts` - Effect服务入口
- `pipeline.ts` - 7步权限检查管道 (来自Claude Code)
- `evaluate.ts` - 扁平规则匹配 (来自OpenCode)
- `pathValidation.ts` - 路径安全检查 (来自Claude Code)
- `sandbox.ts` - 沙箱决策 (来自Claude Code)

**安全特性：**
- UNC路径阻止 (防止NTLM泄露)
- 设备路径阻止 (/dev/*)
- 敏感路径保护 (.git/, .ssh/, .aws/)
- 路径遍历检测
- 危险命令检测 (rm -rf /)

### Coordinator (src/agent/coordinator/)
多Agent协作编排服务。

**关键文件：**
- `index.ts` - Coordinator服务 (Effect fiber实现)
- `types.ts` - Worker/Phase类型定义

**特性：**
- Phase工作流: Research → Synthesis → Implementation → Verification
- Effect.forkScoped隔离的Worker
- 消息通过Effect Queue传递

### Tool (src/tool/)
安全增强的工具系统。

**关键文件：**
- `tool.ts` - 工具接口定义
- `bash.ts` - 安全增强的bash工具
- `read.ts` / `edit.ts` - 带路径检查的文件工具
- `registry.ts` - 工具注册表

**安全特性：**
- 执行前路径安全检查
- 沙箱执行决策
- Permission集成

### Session (src/session/)
会话管理与压缩。

**关键文件：**
- `index.ts` - Session服务
- `types.ts` - 会话/消息类型

**特性：**
- 会话CRUD操作
- 自动压缩 (Compaction)
- Token预算管理

### Provider (src/provider/)
多Provider支持 (AI SDK v3)。

**关键文件：**
- `provider.ts` - Provider服务
- `types.ts` - Model/Provider类型

**支持：**
- Anthropic (Claude)
- OpenAI
- Google

### Server (src/server/)
Hono服务端。

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
