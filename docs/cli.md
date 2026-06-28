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
pnpm skillbridge eval examples/routing-eval.jsonl --skill-dir examples/skills
pnpm skillbridge eval examples/routing-eval.jsonl --skill-dir examples/skills --json
```

Runs a routing evaluation JSONL file and prints `accuracy`, `false_positive`, `false_negative`, a confusion matrix, and per-case predictions. The command exits with a non-zero code when any case fails.

Each JSONL line uses this shape:

```json
{ "id": "code-review-pr-risk", "query": "PR 风险检查", "expectedSkill": "code-review" }
```

Use `expectedSkill: "no-skill"` for queries that should not activate a skill.
