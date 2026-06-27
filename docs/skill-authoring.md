# Skill Authoring

An Agent Skill is a directory with one `SKILL.md` file and optional supporting folders.

```text
my-skill/
  SKILL.md
  references/
  scripts/
  assets/
```

## Minimal Skill

```markdown
---
name: Code Review
description: Review code changes for correctness, regressions, and test coverage gaps.
metadata:
  keywords: code review, PR, risk, tests
  domains: software engineering
  taskTypes: review, debugging
compatibility:
  agents: Claude, Cursor
  runtimes: node
permissions:
  read: references/**
  network: false
  execute: false
---

# Code Review

Use this skill when the user asks for review, regression risk, test coverage, or PR feedback.
```

`name` and `description` are required. They are the lightweight metadata used during scan and routing.

## Progressive Disclosure

Agent Skill Bridge follows the progressive disclosure pattern:

1. Level 0 loads only `name`, `description`, and `metadata.keywords` into the catalog.
2. Routing uses that lightweight catalog.
3. Level 1 loads only the selected `SKILL.md` body during activation.
4. Level 2 keeps references deferred until `readResource` is called.
5. Level 3 keeps scripts and assets deferred until a tool explicitly requests them.

Write `SKILL.md` as the concise operating guide. Put long source material, policies, forms, generated examples, and binary assets in separate files so agents can request them only when needed.

## Frontmatter

Supported fields:

- `name`: required string.
- `description`: required string.
- `version`: optional string.
- `license`: optional string.
- `author`: optional string.
- `compatibility`: optional object with `agents`, `runtimes`, and `models`.
- `allowed-tools` / `allowedTools`: optional string array or comma-separated string.
- `denied-tools` / `deniedTools`: optional string array or comma-separated string.
- `permissions`: optional object with `read`, `write`, `network`, and `execute`.
- `entrypoints`: optional object with `default` and `tools`.
- `metadata.keywords`: optional string array or comma-separated string.
- `metadata.domains`: optional string array or comma-separated string.
- `metadata.taskTypes` / `metadata.task-types`: optional string array or comma-separated string.

The parsed manifest keeps the original frontmatter in `rawFrontmatter`.

SkillBridge is intentionally lenient while reading metadata and strict while running. Parser compatibility fields describe intent, but runtime execution still enforces SkillBridge's own resource and script boundaries.

## References

Put long examples, checklists, policies, schemas, and source material under `references/`.

```text
references/checklist.md
references/policy.md
```

References are discovered during scan and can be read later with:

```bash
pnpm skillbridge read ./my-skill references/checklist.md
```

## Scripts

Put executable helpers under `scripts/`.

```text
scripts/check.mjs
scripts/export.mjs
```

Scripts are disabled by default and can only run from inside `scripts/`.

```bash
pnpm skillbridge run ./my-skill scripts/check.mjs --enable-scripts
```

## Assets

Put images, templates, binaries, and other supporting files under `assets/`.

Binary resources are returned as base64 by CLI and proxy tool execution.
