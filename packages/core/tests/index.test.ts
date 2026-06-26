import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createRuntimeTraceEvent, createSkillPackage, scanSkillDirs } from "../src/index.js";

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

  it("scans nested skill directories and discovers resources", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "skillbridge-core-"));
    const skillRoot = path.join(tempRoot, "skills");
    const nestedSkillDir = path.join(skillRoot, "nested", "sample");

    await mkdir(path.join(nestedSkillDir, "references"), { recursive: true });
    await mkdir(path.join(nestedSkillDir, "scripts"), { recursive: true });
    await mkdir(path.join(nestedSkillDir, "assets", "images"), { recursive: true });

    await writeFile(
      path.join(nestedSkillDir, "SKILL.md"),
      `---\nname: Sample Skill\ndescription: Sample description\n---\n# Skill`,
      "utf8",
    );
    await writeFile(path.join(nestedSkillDir, "references", "guide.md"), "guide", "utf8");
    await writeFile(path.join(nestedSkillDir, "scripts", "run.sh"), "#!/usr/bin/env bash", "utf8");
    await writeFile(path.join(nestedSkillDir, "assets", "images", "icon.png"), "png", "utf8");

    const manifests = await scanSkillDirs([skillRoot]);

    expect(manifests).toHaveLength(1);
    expect(manifests[0]).toMatchObject({
      name: "Sample Skill",
      description: "Sample description",
      path: nestedSkillDir,
      references: ["references/guide.md"],
      scripts: ["scripts/run.sh"],
      assets: ["assets/images/icon.png"],
    });
  });

  it("rejects skills missing required frontmatter", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "skillbridge-core-missing-"));
    const skillDir = path.join(tempRoot, "skill");

    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), `---\ndescription: Missing name\n---\n`, "utf8");

    await expect(scanSkillDirs([tempRoot])).rejects.toThrow(/name/);
  });
});
