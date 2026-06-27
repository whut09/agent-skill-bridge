import { describe, expect, it } from "vitest";
import path from "node:path";
import { createMcpServer, parseCliArgs } from "../src/server.js";

describe("mcp server", () => {
  it("creates a stdio MCP server wrapper", () => {
    const { server, runtime } = createMcpServer({ skillDirs: ["examples/skills"] });

    expect(server).toBeDefined();
    expect(runtime).toBeDefined();
  });

  it("registers native MCP tools, resources, and prompts", () => {
    const { server } = createMcpServer({ skillDirs: ["examples/skills"] });
    const internals = server as unknown as {
      _registeredTools: Record<string, unknown>;
      _registeredResourceTemplates: Record<string, { resourceTemplate: { uriTemplate: { toString(): string } } }>;
      _registeredPrompts: Record<string, unknown>;
    };

    expect(Object.keys(internals._registeredTools)).toEqual(
      expect.arrayContaining([
        "skillbridge.search",
        "skillbridge.activate",
        "skillbridge.run_script",
        "skillbridge_search_skills",
        "skillbridge_activate_skill",
        "skillbridge_run_script",
      ]),
    );
    expect(
      Object.values(internals._registeredResourceTemplates).map((template) =>
        template.resourceTemplate.uriTemplate.toString(),
      ),
    ).toEqual(
      expect.arrayContaining([
        "skill://{skillId}/SKILL.md",
        "skill://{skillId}/references/{file}",
        "skill://{skillId}/assets/{file}",
      ]),
    );
    expect(Object.keys(internals._registeredPrompts)).toEqual(
      expect.arrayContaining(["skillbridge-use-skill", "skillbridge-debug-skill", "skillbridge-create-skill"]),
    );
  });

  it("lists native skill resources with skill URIs", async () => {
    const { server } = createMcpServer({ skillDirs: [path.resolve("..", "..", "examples", "skills")] });
    const internals = server as unknown as {
      _registeredResourceTemplates: Record<
        string,
        { resourceTemplate: { listCallback?: (extra: unknown) => Promise<{ resources: Array<{ uri: string }> }> } }
      >;
    };

    const result = await internals._registeredResourceTemplates["skillbridge-skill-md"].resourceTemplate.listCallback?.(
      {},
    );

    expect(result?.resources.map((resource) => resource.uri)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^skill:\/\/.+\/SKILL\.md$/)]),
    );
  });

  it("parses --skill-dir arguments", () => {
    expect(parseCliArgs(["node", "server.js", "--skill-dir", "./examples/skills", "--skill-dir", "./more"])).toEqual({
      skillDirs: ["./examples/skills", "./more"],
      enableScripts: false,
      debug: false,
    });
  });

  it("keeps script execution disabled unless explicitly enabled", () => {
    expect(parseCliArgs(["node", "server.js", "--skill-dir", "./examples/skills", "--enable-scripts"])).toEqual({
      skillDirs: ["./examples/skills"],
      enableScripts: true,
      debug: false,
    });
  });

  it("parses --debug arguments", () => {
    expect(parseCliArgs(["node", "server.js", "--skill-dir", "./examples/skills", "--debug"])).toEqual({
      skillDirs: ["./examples/skills"],
      enableScripts: false,
      debug: true,
    });
  });
});
