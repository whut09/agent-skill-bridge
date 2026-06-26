import { describe, expect, it } from "vitest";
import { createOpenAIProxyServer } from "../src/server.js";

describe("openai proxy", () => {
  it("creates an http server", () => {
    expect(createOpenAIProxyServer().listening).toBe(false);
  });
});
