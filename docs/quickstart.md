# Quickstart

Run Agent Skills in any existing agent without rewriting a skill runtime.

This guide gets you from a fresh checkout to a real skill scan in about five minutes.

## 1. Install

```bash
pnpm install
```

## 2. Build

```bash
pnpm build
```

## 3. Scan Example Skills

```bash
pnpm skillbridge scan examples/skills
```

Expected result: JSON with `count: 3` and the example skills `Bid Writing`, `Code Review`, and `Lens Drawing`, including metadata, references, scripts, and assets.

## Try Routing

```bash
pnpm skillbridge search examples/skills "PR risk review"
pnpm skillbridge search examples/skills "Zemax CAD drawing"
pnpm skillbridge activate examples/skills "write a bid response"
```

`search` returns scored skill matches. `activate` returns the selected skill, generated `systemPatch`, tool instructions, and routing reasons.

## Read A Resource

```bash
pnpm skillbridge read examples/skills/code-review references/.gitkeep
```

The read command is restricted to files inside the skill directory.

## Trace Runtime Decisions

```bash
pnpm skillbridge trace examples/skills
```

Trace output includes events such as `scan_start` and `scan_complete`.

## Run Tests

```bash
pnpm test
pnpm check
```
