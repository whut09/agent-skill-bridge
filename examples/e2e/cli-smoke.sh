#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
CLI="$ROOT_DIR/packages/cli/dist/index.js"
SKILLS="$ROOT_DIR/examples/skills"

node "$CLI" doctor --json | grep '"ok": true'
node "$CLI" scan "$SKILLS" --json | grep '"Code Review"'
node "$CLI" search "$SKILLS" "PR risk review" --json | grep '"Code Review"'
node "$CLI" activate "$SKILLS" "code review" --budget 4000 --json | grep '"selected": true'
node "$CLI" read "$SKILLS" "Code Review" references/guide.md --json | grep 'Code Review Guide'
node "$CLI" run "$SKILLS" "Code Review" scripts/echo.mjs --enable-scripts --json | grep 'SkillBridge code-review echo example ok'
node "$CLI" trace "$SKILLS" --query "PR risk review" --json | grep '"selectedSkill": "Code Review"'
