import { SkillBridgeRuntime } from "../../packages/core/src/index.js";

const query = "review this pull request for regression risk";

async function main(): Promise<void> {
  const runtime = new SkillBridgeRuntime(["./examples/skills"]);
  await runtime.init();

  const prepared = await runtime.prepare({
    messages: [{ role: "user", content: query }],
    userMessage: query,
  });
  const selectedSkill = prepared.activationDecision.selectedSkill?.id ?? "no-skill";
  const resource = await runtime.readResource(selectedSkill, "references/guide.md");
  const traceRecord = runtime.getTraceRecord();

  console.log(
    JSON.stringify(
      {
        mode: "skillbridge-runtime",
        query,
        promptSizeChars: prepared.systemPatch.length,
        selectedSkill,
        resourcesLoaded: resource.type === "text" ? 1 : 0,
        policyDecisions: traceRecord.tools.map((tool) => ({
          tool: tool.name,
          path: tool.path,
          allowed: tool.allowed,
          reason: tool.reason,
        })),
        traceRecord: {
          runId: traceRecord.runId,
          selectedSkill: traceRecord.selectedSkill,
          candidates: traceRecord.candidates.map((candidate) => ({
            skillId: candidate.skillId,
            score: Number(candidate.score.toFixed(2)),
          })),
          context: traceRecord.context,
          events: traceRecord.events.map((event) => event.type),
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
