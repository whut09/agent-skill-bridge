# Runtime API

Use `@skillbridge/core` when embedding SkillBridge directly into an agent runtime.

```ts
import { SkillBridgeRuntime } from "@skillbridge/core";

const runtime = new SkillBridgeRuntime(["./examples/skills"]);
await runtime.init();

const skills = runtime.listSkills();
const activation = await runtime.activateSkill("review this PR");
const resource = await runtime.readResource("Code Review", "references/guide.md");

console.log(skills);
console.log(activation.systemPatch);
console.log(resource.content);
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
- `policy_scan_finding`
- `scan_complete`

### L0 Discovery: `listSkills()`

Returns a lightweight catalog for routing and UI:

```ts
const skills = runtime.listSkills();
```

Each item includes:

- `id`
- `name`
- `description`
- `keywords`
- `capabilities`

This layer does not load full `SKILL.md` bodies or resource contents.

### L1 Activation: `activateSkill(query, options)`

Routes a user task, loads only the selected `SKILL.md` body, and returns a reusable activation decision:

```ts
const decision = await runtime.activateSkill("review this PR", {
  budget: 8000,
});
```

`ActivationDecision` includes:

- `runId`
- `query`
- `selected`
- `selectedSkill`
- `candidates`
- `confidence`
- `systemPatch`
- `allowedTools`
- `nextActions`

`systemPatch` contains Level 0 catalog plus Level 1 selected skill instructions. It does not inline references, scripts, or assets.

Trace events:

- `search_start`
- `skill_selected`
- `context_built`

### Compatibility: `prepare(input)`

Searches active skills and builds progressive runtime context.

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
- `progressiveLoading`
- `selectedSkill`
- `activeSkills`
- `toolInstructions`
- `activationDecision`

The context follows four loading levels:

- Level 0 catalog: only `name`, `description`, and `metadata.keywords`.
- Level 1 selected skill: only the activated `SKILL.md` body.
- Level 2 references: deferred until `readResource()` is called.
- Level 3 scripts/assets: deferred until a tool explicitly reads or runs them.

`systemPatch` contains Levels 0 and 1 only. References, scripts, and assets remain available on `selectedSkill` and `progressiveLoading`, but their contents are not inlined into the prompt.

### `getSkillByName(name)`

Returns a scanned skill by exact case-insensitive name.

### L2 Resource Loading: `listResources(skillName)` and `readResource(...)`

```ts
const listing = runtime.listResources("Code Review");
```

Returns deferred files for the skill:

- `references`
- `scripts`
- `assets`

Read a resource by skill name:

```ts
await runtime.readResource("Code Review", "references/checklist.md");
```

The legacy object form remains supported:

```ts
await runtime.readResource({
  skillPath: skill.path,
  resourcePath: "references/checklist.md",
});
```

Reads only files inside the skill directory.

Trace event:

- `policy_audit`
- `resource_read`

### L3 Execution: `runScript(...)`

Run a script by skill name:

```ts
await runtime.runScript("Code Review", "scripts/check.mjs", {
  enableScripts: true,
});
```

The legacy object form remains supported:

```ts
await runtime.runScript({
  skill,
  scriptPath: "scripts/check.mjs",
  enableScripts: true,
});
```

Scripts are disabled unless `enableScripts: true` is provided and must live under `scripts/`.

Trace events:

- `policy_audit`
- `script_run_start`
- `script_run_complete`
- `script_run_failed`

### `getTraceRecord()`, `getTrace()`, and `clearTrace()`

```ts
const record = runtime.getTraceRecord();
const events = runtime.getTrace();
runtime.clearTrace();
```

`getTraceRecord()` returns the explainable audit shape:

```ts
{
  runId: "run_xxx",
  userMessage: "review this PR",
  selectedSkill: "Code Review",
  candidates: [{ name: "Code Review", score: 0.91, reason: "keywords matched" }],
  context: { catalogTokens: 120, skillTokens: 900, resourceTokens: 0 },
  tools: [{ name: "readResource", path: "references/checklist.md", allowed: true }],
  scripts: [{ path: "scripts/check.mjs", allowed: false, reason: "scripts disabled" }],
  events
}
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

- `runId`: traceable runtime run id.
- `query`: original user query.
- `selected`: whether a skill should activate.
- `selectedSkill`: lightweight selected skill identity.
- `skill`: selected skill when available.
- `candidates`: ranked candidate skills.
- `confidence`: normalized confidence from `0` to `1`.
- `reason`: concise routing explanation.
- `systemPatch`: Level 0 + Level 1 runtime context.
- `allowedTools`: tools allowed by the selected skill.
- `nextActions`: suggested follow-up runtime operations.
- `requiredResources`: resources the router expects to load.
- `requiredTools`: tools the router expects to expose.

`RuleRouter` is the default zero-dependency router. `EmbeddingRouter` and `LlmRouter` are pluggable shells for external vector recall and model reranking integrations.
