# Quickstart

Run Agent Skills in any existing agent without rewriting a skill runtime.

## Copy-Paste Demo

From a fresh checkout:

```bash
pnpm install
pnpm build
pnpm skillbridge scan examples/skills
```

You should see the example skills, including `Bid Writing`, `Code Review`, and `Lens Drawing`.

## Machine-Readable Output

Every CLI command supports `--json`:

```bash
pnpm skillbridge scan examples/skills --json
```

Expected JSON includes:

```json
{
  "count": 3,
  "skills": []
}
```

## Route And Activate

```bash
pnpm skillbridge search examples/skills "PR risk review"
pnpm skillbridge activate examples/skills "write a bid response"
```

`search` prints scored matches. `activate` prints the selected skill and generated `systemPatch`.

## Read A Resource

```bash
pnpm skillbridge read examples/skills/code-review references/.gitkeep
```

Resource reads are restricted to files inside the skill directory.

## Run A Script

Scripts are disabled unless explicitly enabled:

```bash
pnpm skillbridge run examples/skills/code-review scripts/check.mjs --enable-scripts
```

## Trace Runtime Decisions

```bash
pnpm skillbridge trace examples/skills --query "PR risk review" --explain
pnpm skillbridge trace examples/skills --query "PR risk review" --json
```

Trace output includes the selected skill, candidates, context token estimates, tool decisions, script decisions, and raw runtime events.

## CI

```bash
pnpm run ci
```
