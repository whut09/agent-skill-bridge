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
pnpm skillbridge search examples/skills "Zemax CAD drawing" --top-k 3 --min-score 0.1
```

Runs the router and prints normalized scores plus match reasons.

### activate

```bash
pnpm skillbridge activate examples/skills "help me write a bid response"
```

Selects a skill and prints the runtime context that would be injected into an agent.

### read

```bash
pnpm skillbridge read examples/skills/code-review references/.gitkeep
```

Reads a resource from inside a skill directory. Path traversal outside the skill root is blocked by the core resource reader.

### run

```bash
pnpm skillbridge run examples/skills/bid-writing scripts/check.mjs --enable-scripts
```

Runs a script under `scripts/`. Script execution is disabled unless `--enable-scripts` is present.

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
