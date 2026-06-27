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
---

# Code Review

Use this skill when the user asks for review, regression risk, test coverage, or PR feedback.
```

`name` and `description` are required. They are the lightweight metadata used during scan and routing.

## Progressive Disclosure

Agent Skill Bridge follows the progressive disclosure pattern:

1. Scan loads frontmatter metadata from `SKILL.md`.
2. Routing uses `name`, `description`, and `metadata.keywords`.
3. Activation loads the full markdown body only for the selected skill.
4. References, scripts, and assets are listed but read or executed only when requested.

## Frontmatter

Supported fields:

- `name`: required string.
- `description`: required string.
- `version`: optional string.
- `license`: optional string.
- `compatibility`: optional object or scalar.
- `allowed-tools`: optional string array.
- `metadata.keywords`: optional string array or comma-separated string.

The parsed manifest keeps the original frontmatter in `rawFrontmatter`.

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
