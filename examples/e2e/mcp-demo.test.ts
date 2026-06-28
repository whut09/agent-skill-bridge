import { describe, expect, it } from "vitest";
import { createMcpServer } from "../../packages/mcp-server/src/server.js";

type RegisteredTool = {
  handler(input: Record<string, unknown>): Promise<{ content: Array<{ type: string; text: string }> }>;
};

describe("mcp e2e", () => {
  it("activates and runs example skills through registered MCP handlers", async () => {
    const { server, runtime } = createMcpServer({
      skillDirs: ["examples/skills"],
      enableScripts: true,
      debug: false,
    });
    await runtime.init();
    const internals = server as unknown as {
      _registeredTools: Record<string, RegisteredTool>;
      _registeredResourceTemplates: Record<
        string,
        { resourceTemplate: { listCallback?: (extra: unknown) => Promise<{ resources: Array<{ uri: string }> }> } }
      >;
    };

    const activation = await internals._registeredTools["skillbridge.activate"].handler({
      query: "review this PR",
    });
    const script = await internals._registeredTools["skillbridge.run_script"].handler({
      skillId: "code-review",
      scriptPath: "scripts/echo.mjs",
      enableScripts: true,
    });
    const resources = await internals._registeredResourceTemplates[
      "skillbridge-skill-md"
    ].resourceTemplate.listCallback?.({});

    expect(activation.content[0].text).toContain("Code Review");
    expect(script.content[0].text).toContain("SkillBridge code-review echo example ok");
    expect(resources?.resources.map((resource) => resource.uri)).toEqual(
      expect.arrayContaining(["skill://code-review/SKILL.md"]),
    );
  });
});
