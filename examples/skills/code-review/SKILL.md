---
id: code-review
name: Code Review
description: Review code changes for correctness, regressions, and test coverage gaps.
metadata:
  keywords: code review, PR, risk, tests, 代码评审, 风险检查, 回归风险
entrypoints:
  default: scripts/echo.mjs
---

# Code Review

Review code changes for correctness, regressions, and test coverage gaps.

## Core Workflow

1. Read the diff and identify changed behavior.
2. Check the review checklist in `references/checklist.md`.
3. Call `scripts/analyze-diff.mjs` when a local diff summary is available.
4. Report correctness risks, missing tests, and follow-up questions before style comments.
