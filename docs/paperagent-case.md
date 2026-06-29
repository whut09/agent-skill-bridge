# PaperAgent SkillBridge Case

This case shows how to use `agent-skill-bridge` with the PaperAgent project.

中文说明：这个案例说明 `agent-skill-bridge` 安装之后，如何加载 PaperAgent 自带的论文 skill，并通过 SkillBridge 执行论文总结或论文翻译。

## 1. 两个项目的关系

PaperAgent 负责真正的论文处理：

- 解析 PDF / Word。
- 抽取正文、图、表、公式。
- 调用模型生成论文精读总结。
- 调用 PaperAgent 翻译链路生成翻译 PDF。
- 生成 Word、trace、grounding map、verification 等产物。

SkillBridge 负责 skill runtime：

- 扫描 PaperAgent 暴露出来的 `SKILL.md`。
- 根据用户 query 路由到 PaperAgent skill。
- 按需读取 skill references。
- 执行 skill 的脚本入口。
- 记录路由、脚本执行和策略审计 trace。

也就是说，SkillBridge 不替代 PaperAgent 的论文处理逻辑。它只是把 PaperAgent 的论文总结/翻译能力包装成一个可路由、可执行、可审计的 Agent Skill。

## 2. 目录约定

假设两个项目都在同一个工作区：

```powershell
F:\codex\code\agent-skill-bridge
F:\codex\code\paper_agent
```

PaperAgent 的 skill 目录是：

```powershell
F:\codex\code\paper_agent\paper_agent\skills
```

其中实际 skill 包是：

```text
paper-agent-paper-reading/
  SKILL.md
  references/
    summary-system-prompt.md
    final-note-prompt.md
    translation-prompt.md
  scripts/
    paper-agent.mjs
```

`SKILL.md` 用来让 SkillBridge 发现和路由；`references/` 存放 PaperAgent 的总结和翻译 prompt；`scripts/paper-agent.mjs` 是 SkillBridge 执行 PaperAgent 的入口脚本。

## 3. 安装和构建 SkillBridge

进入 SkillBridge 项目：

```powershell
cd F:\codex\code\agent-skill-bridge
pnpm install
pnpm build
```

构建完成后，可以使用：

```powershell
pnpm skillbridge doctor
```

正常输出会包含可用命令，例如 `scan`、`search`、`activate`、`run`、`exec`。

## 4. 准备 PaperAgent

进入 PaperAgent 项目，安装依赖并准备配置：

```powershell
cd F:\codex\code\paper_agent
pip install -e .
copy config.json config.local.json
```

编辑 `config.local.json`，至少保证有：

```json
{
  "CODEX_BASE_URL": "https://your-endpoint/v1",
  "CODEX_API_KEY": "your-api-key",
  "CODEX_MODEL": "your-model",
  "CODEX_USE_PROXY": false
}
```

先确认 PaperAgent 自己可以运行：

```powershell
python -m paper_agent summarize F:\path\paper.pdf --output F:\path\out --config F:\codex\code\paper_agent\config.local.json
```

如果这条命令可以生成 `*-summary.docx`，再接入 SkillBridge。

## 5. 扫描 PaperAgent Skill

回到 SkillBridge 项目：

```powershell
cd F:\codex\code\agent-skill-bridge
```

扫描 PaperAgent skill 根目录：

```powershell
pnpm skillbridge scan F:\codex\code\paper_agent\paper_agent\skills
```

应该能看到：

```text
paper-agent-paper-reading
```

也可以用 JSON 输出确认 references 和 scripts：

```powershell
pnpm skillbridge scan F:\codex\code\paper_agent\paper_agent\skills --json
```

## 6. 路由测试

搜索“总结论文”：

```powershell
pnpm skillbridge search F:\codex\code\paper_agent\paper_agent\skills "总结这篇论文"
```

搜索“翻译论文”：

```powershell
pnpm skillbridge search F:\codex\code\paper_agent\paper_agent\skills "翻译这篇论文"
```

这两个 query 都应该命中 `paper-agent-paper-reading`。

如果只想看 SkillBridge 注入给 agent 的 skill 指令，可以运行：

```powershell
pnpm skillbridge activate F:\codex\code\paper_agent\paper_agent\skills "总结这篇论文" --budget 4000
```

`activate` 只做路由和上下文构建，不执行 PaperAgent。

## 7. 执行论文总结

SkillBridge 的推荐入口是 `exec`：

```powershell
pnpm skillbridge exec F:\codex\code\paper_agent\paper_agent\skills "总结这篇论文" `
  --enable-scripts `
  --timeout-ms 1200000 `
  --arg=--mode --arg=summarize `
  --arg=--input --arg=F:\path\paper.pdf `
  --arg=--output --arg=F:\path\out `
  --arg=--config --arg=F:\codex\code\paper_agent\config.local.json
```

执行链路是：

```text
skillbridge exec
  -> scan PaperAgent skills
  -> route query "总结这篇论文"
  -> select paper-agent-paper-reading
  -> run scripts/paper-agent.mjs
  -> call python -m paper_agent summarize ...
  -> PaperAgent generates Word summary and sidecars
```

输出目录里会生成类似：

```text
paper-summary.docx
paper-trace.json
paper-grounding-map.json
paper-verification.json
paper-knowledge-graph.json
```

具体文件名前缀取决于论文文件名。

## 8. 执行论文翻译

翻译模式使用同一个 skill 脚本，只是 `--mode` 改成 `translate`：

```powershell
pnpm skillbridge exec F:\codex\code\paper_agent\paper_agent\skills "翻译这篇论文" `
  --enable-scripts `
  --timeout-ms 1200000 `
  --arg=--mode --arg=translate `
  --arg=--input --arg=F:\path\paper.pdf `
  --arg=--output --arg=F:\path\out `
  --arg=--config --arg=F:\codex\code\paper_agent\config.local.json `
  --arg=--service --arg=openai
```

执行链路是：

```text
skillbridge exec
  -> route query "翻译这篇论文"
  -> select paper-agent-paper-reading
  -> run scripts/paper-agent.mjs
  -> call python -m paper_agent <paper.pdf> --service openai ...
  -> PaperAgent generates translated PDF outputs
```

如果你使用的是其他翻译服务，把 `--arg=openai` 改成 PaperAgent 支持的 service 名称。

## 9. 在 PaperAgent 里面怎么用 Skill

PaperAgent 现在把 SkillBridge 当成通用 skill engine 来用：当它需要摘要或翻译 prompt 时，会优先通过 `skillbridge read` 读取 skill reference；当它需要路由信息时，可以通过 `skillbridge scan` 或 `skillbridge activate` 获取 skill 元数据。若 SkillBridge 不可用，才回退到仓库内置的本地 skill 文件。

这样就有两层使用方式：

### 方式 A：直接用 PaperAgent，但 prompt 仍走 SkillBridge

```powershell
cd F:\codex\code\paper_agent
python -m paper_agent summarize F:\path\paper.pdf --output F:\path\out --config config.local.json
python -m paper_agent F:\path\paper.pdf -s openai --config config.local.json
```

这种方式不需要你手工调用 SkillBridge CLI；但 PaperAgent 在内部取 prompt 时，仍然会优先通过 SkillBridge 解析 skill。

### 方式 B：直接通过 SkillBridge 调用 PaperAgent

```powershell
cd F:\codex\code\agent-skill-bridge
pnpm skillbridge exec F:\codex\code\paper_agent\paper_agent\skills "总结这篇论文" --enable-scripts --arg=--mode --arg=summarize --arg=--input --arg=F:\path\paper.pdf --arg=--output --arg=F:\path\out --arg=--config --arg=F:\codex\code\paper_agent\config.local.json
```

这种方式多了 SkillBridge 的路由、runtime trace、script policy 和统一 skill 执行入口，适合把 PaperAgent 接入其他 agent 或自动化系统。

## 10. 覆盖 Skill Prompt

如果你想让 PaperAgent 使用外部 skill，而不是仓库内置 skill，可以设置：

```powershell
$env:PAPER_AGENT_SKILL_DIR="D:\my-skills\paper-agent-paper-reading"
```

该目录需要包含：

```text
references/summary-system-prompt.md
references/final-note-prompt.md
references/translation-prompt.md
```

PaperAgent 会优先读取 `PAPER_AGENT_SKILL_DIR`，并通过 `PAPER_AGENT_SKILLBRIDGE_ROOT` 指向的 SkillBridge 解析这些 skill；读取不到时才使用内置 skill。

## 11. 常见问题

### 为什么必须加 `--enable-scripts`？

SkillBridge 默认不执行任何脚本。`exec` 最终会运行 PaperAgent skill 里的 `scripts/paper-agent.mjs`，所以必须显式加 `--enable-scripts`。

### 为什么要设置很长的 `--timeout-ms`？

论文总结和翻译通常需要几分钟，默认脚本超时较短。建议使用 `--timeout-ms 1200000`，也就是 20 分钟。

### `exec` 和 `run` 有什么区别？

`run` 需要你手动指定 skill 和脚本：

```powershell
pnpm skillbridge run F:\codex\code\paper_agent\paper_agent\skills paper-agent-paper-reading scripts/paper-agent.mjs --enable-scripts
```

`exec` 会先根据 query 自动选择 skill，然后执行默认入口：

```powershell
pnpm skillbridge exec F:\codex\code\paper_agent\paper_agent\skills "总结这篇论文" --enable-scripts
```

### 可以在 GUI 里用吗？

可以继续用 PaperAgent GUI：

```powershell
python -m paper_agent -i --config config.local.json
```

GUI 不需要 SkillBridge 才能工作。SkillBridge 主要用于把 PaperAgent 能力作为 skill 接入其他 agent runtime。
