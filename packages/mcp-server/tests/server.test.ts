import { describe, expect, it } from "vitest";
import { createMcpServer, parseCliArgs } from "../src/server.js";

describe("mcp server", () => {
  it("creates a stdio MCP server wrapper", () => {
    const { server, runtime } = createMcpServer({ skillDirs: ["examples/skills"] });

    expect(server).toBeDefined();
    expect(runtime).toBeDefined();
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
