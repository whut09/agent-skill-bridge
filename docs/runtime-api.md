# Runtime API

Use `@skillbridge/core` when embedding SkillBridge directly into an agent runtime.

```ts
import { SkillBridgeRuntime } from "@skillbridge/core";

const runtime = new SkillBridgeRuntime(["./examples/skills"]);
await runtime.init();

const prepared = await runtime.prepare({
  messages: [{ role: "user", content: "review this PR" }],
  userMessage: "review this PR",
});

console.log(prepared.activeSkills);
console.log(prepared.systemPatch);
```

## SkillBridgeRuntime

### `new SkillBridgeRuntime(skillDirs)`

Creates a runtime from one or more skill root directories.

### `init()`

Scans skill roots and returns:

```ts
{ skills: SkillManifest[] }
```

Trace events:

- `scan_start`
- `scan_complete`

### `prepare(input)`

Searches active skills and builds context.

```ts
await runtime.prepare({
  messages,
  userMessage,
  budget: 8000,
});
```

Returns:

- `catalog`
- `systemPatch`
- `selectedSkill`
- `activeSkills`
- `toolInstructions`

Trace events:

- `search_start`
- `skill_selected`
- `context_built`

### `getSkillByName(name)`

Returns a scanned skill by exact case-insensitive name.

### `readResource(input)`

```ts
await runtime.readResource({
  skillPath: skill.path,
  resourcePath: "references/checklist.md",
});
```

Reads only files inside the skill directory.

Trace event:

- `resource_read`

### `runScript(input)`

```ts
await runtime.runScript({
  skill,
  scriptPath: "scripts/check.mjs",
  enableScripts: true,
});
```

Scripts are disabled unless `enableScripts: true` is provided and must live under `scripts/`.

Trace events:

- `script_run_start`
- `script_run_complete`
- `script_run_failed`

### `getTrace()` and `clearTrace()`

```ts
const events = runtime.getTrace();
runtime.clearTrace();
```

Trace events include `type`, `message`, `timestamp`, and optional `metadata`.

## Standalone Functions

- `scanSkillDirs(skillDirs)`
- `parseSkillDir(skillPath)`
- `readSkillBody(skillPath)`
- `searchSkills(query, skills, options)`
- `routeSkills(query, skills, options)`
- `buildSkillContext(input)`
- `readSkillResource(input)`
- `executeLocalScript(input)`

## Routing API

`searchSkills()` remains the simple compatibility API. It returns ranked `SkillSearchResult[]`.

For SDK, MCP, and proxy integrations, prefer the router API:

```ts
import { RuleRouter, routeSkills } from "@skillbridge/core";

const decision = await routeSkills("review this PR", skills);
const ruleDecision = await new RuleRouter().route({
  query: "review this PR",
  skills,
});
```

`ActivationDecision` contains:

- `selected`: whether a skill should activate.
- `skill`: selected skill when available.
- `candidates`: ranked candidate skills.
- `confidence`: normalized confidence from `0` to `1`.
- `reason`: concise routing explanation.
- `requiredResources`: resources the router expects to load.
- `requiredTools`: tools the router expects to expose.

`RuleRouter` is the default zero-dependency router. `EmbeddingRouter` and `LlmRouter` are pluggable shells for external vector recall and model reranking integrations.
