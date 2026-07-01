# CLI

The CLI is the fastest way to inspect and exercise a skill package.

Build first:

```bash
pnpm install
pnpm build
```

Run through the root package script:

```bash
pnpm skillbridge <command>
```

Common options accepted by every command:

- `--json`
- `--debug`
- `--budget <number>`

The CLI also reads `.skillbridge/policy.yaml` from the skill directory or current working tree. Policy can set script defaults, resource size limits, minimum script trust, and network posture.

## Commands

### doctor

```bash
pnpm skillbridge doctor
```

Prints CLI status and available commands.

### scan

```bash
pnpm skillbridge scan examples/skills
```

Scans skill roots and prints discovered skills with:

- name
- description
- path
- metadata
- references
- scripts
- assets

### validate

```bash
pnpm skillbridge validate examples/skills
```

Checks that all skills can be scanned and parsed. On failure it prints an error and exits with a non-zero code.

### search

```bash
pnpm skillbridge search examples/skills "PR risk review"
pnpm skillbridge search examples/skills "PR risk check" --top-k 3 --min-score 0.1
```

Runs the router and prints normalized scores plus match reasons.

### activate

```bash
pnpm skillbridge activate examples/skills "code review" --budget 4000
```

Selects a skill and prints the runtime context that would be injected into an agent.

### read

```bash
pnpm skillbridge read examples/skills "Code Review" references/guide.md
```

Reads a resource from a named skill. The legacy form `read <skillPath> <resourcePath>` is still supported. Path traversal outside the skill root is blocked by the core resource reader.

### run

```bash
pnpm skillbridge run examples/skills "Code Review" scripts/echo.mjs --enable-scripts
```

Runs a script under a named skill's `scripts/` directory. The legacy form `run <skillPath> <scriptPath>` is still supported. Script execution is disabled unless `--enable-scripts` is present.

Options:

- `--enable-scripts`
- `--timeout-ms <number>`
- `--arg <value>` repeatable

### exec

```bash
pnpm skillbridge exec examples/skills "PR risk review" --enable-scripts
```

Routes the query to the best skill, then runs the selected skill's `entrypoints.default` script. If the skill has no default entrypoint and exactly one script, `exec` uses that script. Use `--script <path>` to override the default entrypoint.

Options:

- `--enable-scripts`
- `--timeout-ms <number>`
- `--script <path>`
- `--arg <value>` repeatable

PaperAgent example:

```powershell
pnpm skillbridge exec F:\codex\code\paper_agent\paper_agent\skills "总结这篇论文" --enable-scripts --timeout-ms 1200000 --arg=--mode --arg=summarize --arg=--input --arg=F:\path\paper.pdf --arg=--output --arg=F:\path\out --arg=--config --arg=F:\codex\code\paper_agent\config.local.json
```

See [PaperAgent SkillBridge Case](paperagent-case.md) for the full install and execution workflow.

### trace

```bash
pnpm skillbridge trace examples/skills
pnpm skillbridge trace examples/skills --query "PR risk" --json
pnpm skillbridge trace examples/skills --query "PR risk" --explain
```

Scans skills and prints runtime trace events by default.

Options:

- `--query <query>` activates the best skill before printing trace output.
- `--last` prints the last standard trace record for this command.
- `--json` prints the standard trace record as JSON.
- `--explain` prints a human-readable trace explanation.

The standard trace record includes `runId`, `userMessage`, `selectedSkill`, scored candidates, context token estimates, tool decisions, script decisions, and raw events.

### eval

```bash
pnpm skillbridge eval examples/evals/basic.jsonl --skill-dir examples/skills
pnpm skillbridge eval examples/evals/negative.jsonl --skill-dir examples/skills --max-false-positive 0
pnpm skillbridge eval examples/evals/zh-en.jsonl --skill-dir examples/skills --fail-under 1 --json
```

Runs a routing evaluation JSONL file and prints `accuracy`, `false_positive`, `false_negative`, a confusion matrix, and per-case predictions. By default the command reports metrics without enforcing a perfect score. Use `--fail-under <number>` to fail when accuracy is too low and `--max-false-positive <number>` to fail when false positive rate is too high.

Each JSONL line uses this shape:

```json
{ "id": "code-review-pr-risk", "query": "PR 风险检查", "expectedSkill": "code-review" }
```

Use `expectedSkill: "no-skill"` for queries that should not activate a skill.

The repository includes:

- `examples/evals/basic.jsonl`
- `examples/evals/zh-en.jsonl`
- `examples/evals/negative.jsonl`
