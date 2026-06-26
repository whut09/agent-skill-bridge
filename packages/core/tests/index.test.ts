import { describe, expect, it } from "vitest";
import { createRuntimeTraceEvent, createSkillPackage } from "../src/index.js";

describe("core", () => {
  it("creates a skill package", () => {
    const skill = createSkillPackage({
      name: "example",
      description: "Example skill",
      path: "/skills/example",
    });

    expect(skill.resources).toEqual([]);
  });

  it("creates trace events", () => {
    const event = createRuntimeTraceEvent("load", "Loaded skill");

    expect(event.type).toBe("load");
    expect(event.message).toBe("Loaded skill");
  });
});
