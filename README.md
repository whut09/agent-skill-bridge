# agent-skill-bridge

`agent-skill-bridge` is a universal skill runtime for existing AI agents. It lets any agent use standard `SKILL.md` skill packages without re-implementing skill parsing, routing, progressive loading, resource reading, script execution, or runtime tracing.

It works as an embeddable SDK, an MCP server, and an OpenAI-compatible proxy, so agent developers can integrate skills by code, by tool protocol, or by changing the model base URL.

SkillBridge does not invent a new skill standard. It bridges existing Agent Skills into real agent execution loops.

## 项目定位

你的项目核心不是：

- Skill 标准
- Skill 市场
- Skill 集合
- Prompt 模板库
- MCP 工具集合

而是：

```text
标准 SKILL.md
    ↓
agent-skill-bridge
    ↓
任意已有 Agent
```

更准确的定位是：

> Universal Skill Runtime for Existing Agents

让任何已有 Agent 无需重写 Skill 框架，也能使用标准 `SKILL.md` 技能包。

## 现有项目的区别

| 类型 | 代表项目 | 主要能力 | 你的差异 |
| --- | --- | --- | --- |
| Skill Manager | `asm` | 安装、搜索、组织不同 agent 的 skill | 你做运行时，不只是安装 |
| Skill Collection | `awesome-agent-skills`、各种 skill repo | 提供技能内容 | 你做执行框架，不做内容集合 |
| MCP Adapter | AgentSkills MCP 类项目 | 通过 MCP 读取/暴露 skill | 你还要做 SDK、Proxy、Router、Context Builder、Trace |
| Skill Compiler 研究 | `SkillRT`、`SkillSmith` | 编译 skill、减少上下文浪费 | 你做工程化 runtime，可逐步引入编译能力 |
| Agent 内置 Skill | Claude/Copilot/OpenClaw 等 | 自家 agent 使用 skill | 你给没有 skill 能力的 agent 补 skill 能力 |

## 推荐技术栈

第一版建议使用 TypeScript monorepo：

- `pnpm` workspace
- TypeScript
- `zod`
- `gray-matter`
- `fast-glob`
- `commander`
- `express` 或 `fastify`
- `@modelcontextprotocol/sdk`
- `vitest`
- `tsx`
- `eslint`
- `prettier`

## 仓库结构

```text
agent-skill-bridge/
├── README.md
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .gitignore
├── .github/
│   └── workflows/
│       └── ci.yml
├── packages/
│   ├── core/
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── parser/
│   │   │   ├── scanner/
│   │   │   ├── indexer/
│   │   │   ├── router/
│   │   │   ├── context/
│   │   │   ├── resources/
│   │   │   ├── executor/
│   │   │   ├── state/
│   │   │   └── trace/
│   │   └── tests/
│   ├── cli/
│   │   ├── src/
│   │   │   └── index.ts
│   │   └── tests/
│   ├── mcp-server/
│   │   ├── src/
│   │   │   └── server.ts
│   │   └── tests/
│   ├── openai-proxy/
│   │   ├── src/
│   │   │   └── server.ts
│   │   └── tests/
│   ├── adapters/
│   │   ├── src/
│   │   │   ├── prompt-only.ts
│   │   │   ├── openai-tools.ts
│   │   │   ├── langgraph.ts
│   │   │   └── opencode.ts
│   │   └── tests/
│   └── sandbox/
│       ├── src/
│       │   └── local-executor.ts
│       └── tests/
├── examples/
│   ├── skills/
│   │   ├── code-review/
│   │   │   ├── SKILL.md
│   │   │   └── references/
│   │   ├── bid-writing/
│   │   │   ├── SKILL.md
│   │   │   ├── references/
│   │   │   └── scripts/
│   │   └── lens-drawing/
│   │       ├── SKILL.md
│   │       ├── references/
│   │       └── scripts/
│   ├── mcp-client-demo/
│   └── proxy-demo/
└── docs/
    ├── architecture.md
    ├── skill-format.md
    ├── mcp-integration.md
    ├── openai-proxy.md
    ├── sdk-integration.md
    └── security.md
```

## 第一版目标

- 标准 `SKILL.md` 解析与索引
- Skill 路由与上下文构建
- 资源读取与脚本执行
- SDK、MCP Server、OpenAI Proxy 三种接入方式
- 审计 trace 与最小可运行示例
