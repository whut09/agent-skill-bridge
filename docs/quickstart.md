# Quickstart

Run Agent Skills in any existing agent without rewriting a skill runtime.

## Copy-Paste Demo

From a fresh checkout:

```bash
pnpm install
pnpm build
pnpm skillbridge scan examples/skills
```

You should see the example skills, including `Bid Writing`, `Code Review`, `Lens Drawing`, and `DOCX Report`.

## Machine-Readable Output

Every CLI command supports `--json`:

```bash
pnpm skillbridge scan examples/skills --json
```

Expected JSON includes:

```json
{
  "count": 4,
  "skills": []
}
```

## Route And Activate

```bash
pnpm skillbridge search examples/skills "PR risk review"
pnpm skillbridge activate examples/skills "code review" --budget 4000
```

`search` prints scored matches. `activate` prints the selected skill and generated `systemPatch`.

## Read A Resource

```bash
pnpm skillbridge read examples/skills "Code Review" references/guide.md
```

Resource reads are restricted to files inside the skill directory.

## Run A Script

Scripts are disabled unless explicitly enabled:

```bash
pnpm skillbridge run examples/skills "Code Review" scripts/echo.mjs --enable-scripts
```

## Trace Runtime Decisions

```bash
pnpm skillbridge trace examples/skills --query "PR risk review" --explain
pnpm skillbridge trace examples/skills --query "PR risk review" --json
```

Trace output includes the selected skill, candidates, context token estimates, tool decisions, script decisions, and raw runtime events.

## Evaluate Routing

```bash
pnpm skillbridge eval examples/evals/basic.jsonl --skill-dir examples/skills --fail-under 1
pnpm skillbridge eval examples/evals/negative.jsonl --skill-dir examples/skills --max-false-positive 0
```

The eval prints accuracy, false positives, false negatives, a confusion matrix, and per-case routing predictions. Threshold flags make the command fail when routing quality falls below the configured gate.

## CI

```bash
pnpm run ci
```
