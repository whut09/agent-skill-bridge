import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import { describe, expect, it } from "vitest";
import path from "node:path";
import { createMcpServer, createMcpServerWithLoadedPolicy, parseCliArgs } from "../src/server.js";

type RegisteredTool = {
  handler(input: Record<string, unknown>): Promise<{ content: Array<{ type: string; text: string }> }>;
};

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
        "skillbridge.refresh",
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

  it("caches runtime initialization until skillbridge.refresh is called", async () => {
    const { server, runtime } = createMcpServer({ skillDirs: [path.resolve("..", "..", "examples", "skills")] });
    const originalInit = runtime.init.bind(runtime);
    let initCount = 0;
    runtime.init = async () => {
      initCount += 1;
      return originalInit();
    };

    const internals = server as unknown as {
      _registeredTools: Record<string, RegisteredTool>;
      _registeredResourceTemplates: Record<
        string,
        { resourceTemplate: { listCallback?: (extra: unknown) => Promise<{ resources: Array<{ uri: string }> }> } }
      >;
    };

    await internals._registeredResourceTemplates["skillbridge-skill-md"].resourceTemplate.listCallback?.({});
    await internals._registeredResourceTemplates["skillbridge-reference"].resourceTemplate.listCallback?.({});
    await internals._registeredTools["skillbridge_list_skills"].handler({});

    expect(initCount).toBe(1);

    const refresh = await internals._registeredTools["skillbridge.refresh"].handler({});

    expect(initCount).toBe(2);
    expect(refresh.content[0].text).toContain("skillCount");
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

  it("loads .skillbridge policy.yaml for script execution", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "skillbridge-mcp-policy-"));
    const skillRoot = path.join(tempRoot, "skills");
    const skillDir = path.join(skillRoot, "review");

    await mkdir(path.join(tempRoot, ".skillbridge"), { recursive: true });
    await mkdir(path.join(skillDir, "scripts"), { recursive: true });
    await writeFile(
      path.join(tempRoot, ".skillbridge", "policy.yaml"),
      ["scripts:", "  enabled: true", "  timeoutMs: 5000", "trust:", "  minimumTrustForScripts: untrusted"].join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(skillDir, "SKILL.md"),
      `---
id: review
name: Review
description: Review code changes
trust: untrusted
---

# Review`,
      "utf8",
    );
    await writeFile(path.join(skillDir, "scripts", "echo.mjs"), `console.log("mcp policy script ok");`, "utf8");

    const { server, runtime } = await createMcpServerWithLoadedPolicy({ skillDirs: [skillRoot] });
    await runtime.init();
    const internals = server as unknown as {
      _registeredTools: Record<string, RegisteredTool>;
    };
    const script = await internals._registeredTools["skillbridge.run_script"].handler({
      skillId: "review",
      scriptPath: "scripts/echo.mjs",
    });

    expect(script.content[0].text).toContain("mcp policy script ok");
  });
});
