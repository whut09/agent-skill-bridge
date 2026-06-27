# Compatibility

SkillBridge aims to run common `SKILL.md` style skill packages with minimal assumptions.

## Matrix

| Skill source | Compatibility | Notes |
| --- | --- | --- |
| Anthropic Agent Skills style directories | High | SkillBridge supports `SKILL.md`, frontmatter metadata, progressive disclosure, references, scripts, and assets. |
| OpenClaw style skills | Partial | Compatible when the skill is represented as a directory with `SKILL.md` metadata and local resources. Runtime-specific conventions may need an adapter. |
| Custom internal skills | High | Use the documented `SKILL.md` frontmatter and folders. |
| Prompt-only skill collections | Partial | Convert each prompt into a `SKILL.md` with `name`, `description`, and optional keywords. |
| Binary-heavy tool packs | Partial | Assets can be discovered and binary resources can be read, but model-facing outputs should stay small. |

## Required Shape

```text
skill-name/
  SKILL.md
```

Required frontmatter:

```yaml
name: Skill Name
description: When and why to use this skill
```

Optional but recommended:

```yaml
metadata:
  keywords: keyword one, keyword two
```

## Progressive Disclosure Compatibility

SkillBridge uses:

- `name` and `description` for lightweight routing.
- `metadata.keywords` for high-signal matching.
- Full `SKILL.md` body only after selection.
- `references/`, `scripts/`, and `assets/` only on demand.

## Known Gaps

- No marketplace/install protocol.
- No package signing.
- No remote sandbox orchestration.
- No automatic conversion from non-`SKILL.md` formats.

These are adapter or distribution concerns, not core runtime requirements.
