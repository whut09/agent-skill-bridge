import { describe, expect, it } from "vitest";
import { createMcpServer } from "../src/server.js";

describe("mcp server", () => {
  it("creates an http server", () => {
    expect(createMcpServer().listening).toBe(false);
  });
});
