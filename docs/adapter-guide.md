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

```ts
import { EmbeddingRouter, LlmRerankRouter, PolicyFilter, routeSkillsWithTrace } from "@skillbridge/core";

const traced = await routeSkillsWithTrace(
  userMessage,
  skills,
  { topK: 10 },
  {
    router: new EmbeddingRouter({
      search: async ({ query, skills }) => vectorSearch(query, skills),
    }),
    policyFilter: new PolicyFilter(),
    reranker: new LlmRerankRouter({
      rerank: async ({ query, candidates }) => llmRerank(query, candidates),
    }),
  },
);
```

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

## Python Host Example: PaperAgent

PaperAgent is a concrete host that treats SkillBridge as its skill engine.

Recommended integration flow:

1. Install and build SkillBridge.
2. Point PaperAgent at a skill root, such as `paper_agent/skills/paper-agent-paper-reading`.
3. Let PaperAgent call `skillbridge read <skillRoot> references/<name>.md --json` when it needs prompt text.
4. Let PaperAgent call `skillbridge scan <skillRoot>` or `skillbridge activate <skillRoot> <query>` when it needs routing metadata.
5. Keep PaperAgent's own translation/summarization pipeline unchanged; only the prompt and skill loading layer moves behind SkillBridge.

This makes SkillBridge the reusable engine and PaperAgent the real-world example that consumes it.
