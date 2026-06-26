import { describe, expect, it } from "vitest";
import { promptOnlyAdapter } from "../src/prompt-only.js";

describe("adapters", () => {
  it("passes through prompt text", () => {
    expect(promptOnlyAdapter("hello")).toBe("hello");
  });
});
