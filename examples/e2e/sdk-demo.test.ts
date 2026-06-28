import { describe, expect, it } from "vitest";
import { SkillBridgeRuntime } from "../../packages/core/src/index.js";

describe("sdk e2e", () => {
  it("discovers, activates, reads, runs, and traces example skills", async () => {
    const runtime = new SkillBridgeRuntime(["examples/skills"]);
    await runtime.init();

    const skills = runtime.listSkills();
    const activation = await runtime.activateSkill("PR risk review", { budget: 4000 });
    const resources = runtime.listResources("code-review");
    const guide = await runtime.readResource("code-review", "references/guide.md");
    const script = await runtime.runScript("code-review", "scripts/echo.mjs", {
      enableScripts: true,
      timeoutMs: 5000,
    });

    expect(skills.map((skill) => skill.id)).toEqual(expect.arrayContaining(["code-review"]));
    expect(activation).toMatchObject({
      selected: true,
      selectedSkill: { id: "code-review", name: "Code Review" },
    });
    expect(resources.references).toContain("references/guide.md");
    expect(guide).toMatchObject({ type: "text", content: expect.stringContaining("Code Review Guide") });
    expect(script.stdout).toContain("SkillBridge code-review echo example ok");
    expect(runtime.getTraceRecord()).toMatchObject({
      selectedSkill: "Code Review",
      tools: [expect.objectContaining({ name: "readResource", path: "references/guide.md", allowed: true })],
      scripts: [expect.objectContaining({ path: "scripts/echo.mjs", allowed: true })],
    });
  });
});
