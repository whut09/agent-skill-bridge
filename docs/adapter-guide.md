# Adapter Guide

An adapter connects SkillBridge to an agent runtime that does not speak MCP or OpenAI tools directly.

The typical adapter flow is:

1. Create a `SkillBridgeRuntime`.
2. Call `init()` at agent startup.
3. For each user task, call `prepare()` or `routeSkills()`.
4. Inject `systemPatch` into the agent context.
5. Expose resource/script operations as native agent tools.
6. Feed tool results back into the agent.
7. Capture `getTrace()` for logs or debugging.

## Minimal Adapter

```ts
import { SkillBridgeRuntime } from "@skillbridge/core";

const runtime = new SkillBridgeRuntime(["./examples/skills"]);
await runtime.init();

export async function prepareAgentInput(messages: Array<{ role: string; content: string }>) {
  const userMessage = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
  const prepared = await runtime.prepare({ messages, userMessage });

  return {
    messages: [{ role: "system", content: prepared.systemPatch }, ...messages],
    activeSkills: prepared.activeSkills,
    trace: runtime.getTrace(),
  };
}
```

## Routing Decisions

Adapters that need routing without context construction can call the router directly:

```ts
import { routeSkills } from "@skillbridge/core";

const decision = await routeSkills(userMessage, skills);

if (decision.selected && decision.skill) {
  // Attach the skill or expose its tools in your host agent.
}
```

Use `decision.candidates` for UI/debugging and `decision.confidence` for host-specific thresholds. More advanced adapters can replace the default `RuleRouter` with embedding or LLM rerank logic while preserving the same `ActivationDecision` shape.

## Tool Mapping

Map native agent tools to runtime calls:

```ts
async function readResource(skillId: string, resourcePath: string) {
  return runtime.readResource(skillId, resourcePath);
}

async function runScript(skillId: string, scriptPath: string, args: string[]) {
  return runtime.runScript(skillId, scriptPath, { args, enableScripts: true });
}
```

## Adapter Checklist

- Keep script execution off unless the host explicitly enables it.
- Prefer stable `skillId` in public tool APIs. Keep `skillName` only as a deprecated compatibility field.
- Hide absolute paths from model-visible outputs.
- Preserve trace events for debugging.
- Keep model-facing resource outputs small and relevant.
