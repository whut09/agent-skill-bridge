import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSkillContext,
  executeLocalScript,
  createRuntimeTraceEvent,
  createSkillPackage,
  SkillBridgeRuntime,
  readSkillResource,
  scanSkillDirs,
  searchSkills,
} from "../src/index.js";

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

  it("searches skills by name description and keywords", () => {
    const skills = [
      {
        name: "标书撰写",
        description: "生成投标文件和标书内容",
        path: "/skills/bid-writing",
        frontmatter: {},
        metadata: { keywords: ["标书", "投标", "商务"] },
        references: [],
        scripts: [],
        assets: [],
      },
      {
        name: "代码评审",
        description: "对代码改动进行审查、指出问题并给出建议",
        path: "/skills/code-review",
        frontmatter: {},
        metadata: { keywords: ["review", "代码评审", "PR"] },
        references: [],
        scripts: [],
        assets: [],
      },
      {
        name: "镜头出图",
        description: "用于镜头出图和画面构图参考",
        path: "/skills/lens-drawing",
        frontmatter: {},
        metadata: { keywords: ["镜头出图", "构图", "分镜"] },
        references: [],
        scripts: [],
        assets: [],
      },
    ];

    const bidResults = searchSkills("标书", skills);
    const reviewResults = searchSkills("代码评审", skills);
    const lensResults = searchSkills("镜头出图", skills);

    expect(bidResults[0]).toMatchObject({
      skill: expect.objectContaining({ name: "标书撰写" }),
    });
    expect(bidResults[0].reason.join(" ")).toContain("keywords matched");

    expect(reviewResults[0]).toMatchObject({
      skill: expect.objectContaining({ name: "代码评审" }),
    });
    expect(reviewResults[0].reason.join(" ")).toContain("name exact match");

    expect(lensResults[0]).toMatchObject({
      skill: expect.objectContaining({ name: "镜头出图" }),
    });
    expect(lensResults[0].reason.join(" ")).toContain("name exact match");
  });

  it("builds catalog-only context by default", async () => {
    const context = await buildSkillContext({
      skills: [
        {
          name: "标书撰写",
          description: "生成投标文件和标书内容",
          path: "/skills/bid-writing",
          frontmatter: {},
          metadata: { keywords: ["标书"] },
          references: [],
          scripts: [],
          assets: [],
        },
      ],
    });

    expect(context).toMatchInlineSnapshot(`
      {
        "catalog": "# Skill Catalog\n\n- 标书撰写: 生成投标文件和标书内容",
        "systemPatch": "# Skill Catalog\n\n- 标书撰写: 生成投标文件和标书内容",
      }
    `);
  });

  it("builds selected skill context and truncates references before core instructions", async () => {
    const selectedSkill = {
      name: "代码评审",
      description: "对代码改动进行审查、指出问题并给出建议",
      path: "/skills/code-review",
      frontmatter: {},
      metadata: { keywords: ["代码评审"] },
      references: ["references/very-long-reference-a.md", "references/very-long-reference-b.md"],
      scripts: ["scripts/run.sh"],
      assets: ["assets/icon.png"],
    };

    const context = await buildSkillContext({
      skills: [selectedSkill],
      selectedSkill,
      skillBodies: {
        [selectedSkill.path]: "---\nname: 代码评审\ndescription: 对代码改动进行审查、指出问题并给出建议\n---\n\n# 核心指令\n\n- 审查代码\n- 关注风险",
      },
      budget: 180,
    });

    expect(context.selectedSkill?.body).toContain("# 核心指令");
    expect(context.systemPatch).toContain("# 核心指令");
    expect(context.systemPatch).toContain("- 审查代码");
    expect(context.systemPatch).not.toContain("references/very-long-reference-b.md");
    expect(context.systemPatch).toMatchInlineSnapshot(`
      "# Selected Skill: 代码评审\n\n---\nname: 代码评审\ndescription: 对代码改动进行审查、指出问题并给出建议\n---\n\n# 核心指令\n\n- 审查代码\n- 关注风险\n## References\n\n- references/very-long-reference-a.md\n\n## Scripts\n- scripts/run.sh\n\n## Assets\n- assets/icon.png"
    `);
    expect(context.systemPatch.length).toBeLessThanOrEqual(260);
  });

  it("reads text and binary resources safely within skill directory", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "skillbridge-resource-"));
    const skillDir = path.join(tempRoot, "skill");
    const referencesDir = path.join(skillDir, "references");
    const assetsDir = path.join(skillDir, "assets");

    await mkdir(referencesDir, { recursive: true });
    await mkdir(assetsDir, { recursive: true });
    await writeFile(path.join(referencesDir, "guide.md"), "hello resource", "utf8");
    await writeFile(path.join(assetsDir, "image.bin"), Buffer.from([0xde, 0xad, 0xbe, 0xef]));

    const textResource = await readSkillResource({
      skillPath: skillDir,
      resourcePath: "references/guide.md",
    });
    const binaryResource = await readSkillResource({
      skillPath: skillDir,
      resourcePath: "assets/image.bin",
    });

    expect(textResource).toMatchObject({
      type: "text",
      content: "hello resource",
    });
    expect(textResource.metadata).toMatchObject({
      isText: true,
      mimeType: "text/markdown; charset=utf-8",
      extension: ".md",
    });

    expect(binaryResource.type).toBe("binary");
    expect(Buffer.isBuffer(binaryResource.content)).toBe(true);
    expect(binaryResource.metadata).toMatchObject({
      isText: false,
      mimeType: "application/octet-stream",
      extension: ".bin",
    });
  });

  it("blocks path traversal outside the skill directory", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "skillbridge-safety-"));
    const skillDir = path.join(tempRoot, "skill");

    await mkdir(skillDir, { recursive: true });

    await expect(
      readSkillResource({
        skillPath: skillDir,
        resourcePath: "../outside.md",
      }),
    ).rejects.toThrow(/outside skill directory/);
  });

  it("prepares a runtime with selected skills and tool instructions", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "skillbridge-runtime-"));
    const skillRoot = path.join(tempRoot, "skills");
    const skillDir = path.join(skillRoot, "review");

    await mkdir(path.join(skillDir, "references"), { recursive: true });
    await mkdir(path.join(skillDir, "scripts"), { recursive: true });
    await writeFile(
      path.join(skillDir, "SKILL.md"),
      `---
name: 代码评审
description: 对代码改动进行审查、指出问题并给出建议
---

# 核心指令

- 审查代码
- 关注风险`,
      "utf8",
    );
    await writeFile(path.join(skillDir, "references", "guide.md"), "guide", "utf8");
    await writeFile(path.join(skillDir, "scripts", "echo.mjs"), `console.log("runtime ok");`, "utf8");

    const runtime = new SkillBridgeRuntime([skillRoot]);
    const initResult = await runtime.init();
    const prepared = await runtime.prepare({
      messages: [{ role: "user", content: "代码评审" }],
      userMessage: "代码评审",
      budget: 600,
    });

    expect(initResult.skills).toHaveLength(1);
    expect(prepared.activeSkills[0].skill.name).toBe("代码评审");
    expect(prepared.toolInstructions).toContain("readResource");
    expect(prepared.toolInstructions).toContain("runScript");
    expect(prepared.systemPatch).toContain("# Selected Skill: 代码评审");
  });

  it("exposes readResource and runScript methods", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "skillbridge-runtime-actions-"));
    const skillDir = path.join(tempRoot, "skill");
    const scriptsDir = path.join(skillDir, "scripts");
    const referencesDir = path.join(skillDir, "references");

    await mkdir(scriptsDir, { recursive: true });
    await mkdir(referencesDir, { recursive: true });
    await writeFile(path.join(referencesDir, "guide.md"), "hello resource", "utf8");
    await writeFile(path.join(scriptsDir, "echo.mjs"), `console.log("hello from runtime");`, "utf8");

    const runtime = new SkillBridgeRuntime([skillDir]);

    const resource = await runtime.readResource({
      skillPath: skillDir,
      resourcePath: "references/guide.md",
    });
    const scriptResult = await runtime.runScript({
      skill: {
        name: "代码评审",
        description: "对代码改动进行审查、指出问题并给出建议",
        path: skillDir,
        frontmatter: {},
        metadata: { keywords: ["代码评审"] },
        references: [],
        scripts: ["scripts/echo.mjs"],
        assets: [],
      },
      scriptPath: "scripts/echo.mjs",
      enableScripts: true,
      timeoutMs: 5000,
    });

    expect(resource).toMatchObject({ type: "text", content: "hello resource" });
    expect(scriptResult.stdout).toContain("hello from runtime");
    expect(scriptResult.exitCode).toBe(0);
  });

  it("rejects scripts when not explicitly enabled", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "skillbridge-runtime-disabled-"));
    const skillDir = path.join(tempRoot, "skill");
    const scriptsDir = path.join(skillDir, "scripts");

    await mkdir(scriptsDir, { recursive: true });
    await writeFile(path.join(scriptsDir, "echo.mjs"), `console.log("hello");`, "utf8");

    await expect(
      executeLocalScript({
        skillPath: skillDir,
        scriptPath: "scripts/echo.mjs",
      }),
    ).rejects.toThrow(/disabled/);
  });
});
