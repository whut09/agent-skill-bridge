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
  RuleRouter,
  routeSkills,
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

  it("parses extended frontmatter and searches real SKILL.md metadata keywords", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "skillbridge-core-keywords-"));
    const skillDir = path.join(tempRoot, "skill");

    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, "SKILL.md"),
      `---
name: Architecture Review
description: Review system architecture decisions
version: 1.2.3
license: MIT
author: Skill Team
compatibility:
  agents: Claude, Cursor
  runtimes:
    - node
  models:
    - gpt-4.1
allowed-tools:
  - readResource
  - runScript
denied-tools: shell, writeFile
permissions:
  read:
    - references/**
  write: outputs/**
  network: false
  execute: true
entrypoints:
  default: SKILL.md
  tools:
    checklist: references/checklist.md
metadata:
  keywords: architecture, design review, adr
  domains:
    - software architecture
    - platform engineering
  task-types: review, planning
---

# Architecture Review

Review tradeoffs and risks.`,
      "utf8",
    );

    const manifests = await scanSkillDirs([tempRoot]);
    const [manifest] = manifests;
    const results = searchSkills("adr", manifests);

    expect(manifest).toMatchObject({
      name: "Architecture Review",
      description: "Review system architecture decisions",
      version: "1.2.3",
      license: "MIT",
      author: "Skill Team",
      compatibility: {
        agents: ["Claude", "Cursor"],
        runtimes: ["node"],
        models: ["gpt-4.1"],
      },
      allowedTools: ["readResource", "runScript"],
      deniedTools: ["shell", "writeFile"],
      permissions: {
        read: ["references/**"],
        write: ["outputs/**"],
        network: false,
        execute: true,
      },
      entrypoints: {
        default: "SKILL.md",
        tools: { checklist: "references/checklist.md" },
      },
      metadata: {
        keywords: ["architecture", "design review", "adr"],
        domains: ["software architecture", "platform engineering"],
        taskTypes: ["review", "planning"],
      },
      rawFrontmatter: expect.objectContaining({
        name: "Architecture Review",
        metadata: expect.objectContaining({ keywords: "architecture, design review, adr" }),
      }),
    });
    expect(results[0]).toMatchObject({
      skill: expect.objectContaining({ name: "Architecture Review" }),
    });
    expect(results[0].reason.join(" ")).toContain("keywords matched");
  });

  it("searches skills by name description and keywords", async () => {
    const skills = [
      {
        name: "标书撰写",
        description: "生成投标文件、投标响应和标书内容",
        path: "/skills/bid-writing",
        frontmatter: {},
        metadata: { keywords: ["标书", "投标", "投标响应", "商务"] },
        references: [],
        scripts: [],
        assets: [],
      },
      {
        name: "代码评审",
        description: "对代码改动进行审查、指出问题、识别风险并给出建议",
        path: "/skills/code-review",
        frontmatter: {},
        metadata: { keywords: ["review", "代码评审", "PR", "风险检查"] },
        references: [],
        scripts: [],
        assets: [],
      },
      {
        name: "镜头出图",
        description: "用于镜头出图、Zemax CAD 图纸和画面构图参考",
        path: "/skills/lens-drawing",
        frontmatter: {},
        metadata: { keywords: ["镜头出图", "构图", "分镜", "Zemax", "CAD", "图纸"] },
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

    const bidRoutingResults = searchSkills("投标响应", skills);
    const lensRoutingResults = searchSkills("Zemax CAD 图纸", skills);
    const reviewRoutingResults = searchSkills("PR 风险检查", skills);
    const unrelatedResults = searchSkills("烘焙甜点菜单", skills);
    const topResult = searchSkills("review", skills, { topK: 1, minScore: 0 });

    expect(bidRoutingResults[0]).toMatchObject({
      skill: expect.objectContaining({ path: "/skills/bid-writing" }),
    });
    expect(lensRoutingResults[0]).toMatchObject({
      skill: expect.objectContaining({ path: "/skills/lens-drawing" }),
    });
    expect(reviewRoutingResults[0]).toMatchObject({
      skill: expect.objectContaining({ path: "/skills/code-review" }),
    });
    expect(unrelatedResults).toEqual([]);
    expect(topResult).toHaveLength(1);
    for (const result of [...bidRoutingResults, ...lensRoutingResults, ...reviewRoutingResults]) {
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
    }

    const decision = new RuleRouter().route({ query: "PR 风险检查", skills });
    const routedDecision = await routeSkills("PR 风险检查", skills);

    expect(decision).toMatchObject({
      selected: true,
      skill: expect.objectContaining({ path: "/skills/code-review" }),
      confidence: expect.any(Number),
      candidates: expect.any(Array),
      requiredResources: [],
      requiredTools: [],
    });
    expect(routedDecision).toMatchObject({
      selected: true,
      skill: expect.objectContaining({ path: "/skills/code-review" }),
    });
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

    expect(context.catalog).toContain("# Skill Catalog (Level 0)");
    expect(context.catalog).toContain("Description:");
    expect(context.catalog).toContain("Keywords:");
    expect(context.systemPatch).toBe(context.catalog);
    expect(context.progressiveLoading).toMatchObject({
      level0: { loaded: true, fields: ["name", "description", "metadata.keywords"] },
      level2: { loaded: false, references: [] },
      level3: { loaded: false, scripts: [], assets: [] },
    });
  });

  it("builds selected skill context while deferring resources and scripts", async () => {
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
        [selectedSkill.path]:
          "---\nname: 代码评审\ndescription: 对代码改动进行审查、指出问题并给出建议\n---\n\n# 核心指令\n\n- 审查代码\n- 关注风险",
      },
      budget: 180,
    });

    expect(context.selectedSkill?.body).toContain("# 核心指令");
    expect(context.systemPatch).toContain("# 核心指令");
    expect(context.systemPatch).toContain("- 审查代码");
    expect(context.systemPatch).toContain("# Selected Skill (Level 1):");
    expect(context.systemPatch).not.toContain("references/very-long-reference-a.md");
    expect(context.systemPatch).not.toContain("references/very-long-reference-b.md");
    expect(context.systemPatch).not.toContain("scripts/run.sh");
    expect(context.systemPatch).not.toContain("assets/icon.png");
    expect(context.selectedSkill).toMatchObject({
      references: ["references/very-long-reference-a.md", "references/very-long-reference-b.md"],
      scripts: ["scripts/run.sh"],
      assets: ["assets/icon.png"],
    });
    expect(context.progressiveLoading).toMatchObject({
      level1: { loaded: true, skillName: selectedSkill.name, source: "SKILL.md" },
      level2: {
        loaded: false,
        references: ["references/very-long-reference-a.md", "references/very-long-reference-b.md"],
      },
      level3: { loaded: false, scripts: ["scripts/run.sh"], assets: ["assets/icon.png"] },
    });
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
- 关注风险

## 核心工作流程

- 读取完整技能说明`,
      "utf8",
    );
    await writeFile(path.join(skillDir, "references", "guide.md"), "guide", "utf8");
    await writeFile(path.join(skillDir, "scripts", "echo.mjs"), `console.log("runtime ok");`, "utf8");

    const runtime = new SkillBridgeRuntime([skillRoot]);
    const initResult = await runtime.init();
    const selectedByName = runtime.getSkillByName("代码评审");
    const prepared = await runtime.prepare({
      messages: [{ role: "user", content: "代码评审" }],
      userMessage: "代码评审",
      budget: 600,
    });

    expect(initResult.skills).toHaveLength(1);
    expect(selectedByName?.path).toBe(skillDir);
    expect(prepared.activationDecision).toMatchObject({
      selected: true,
      skill: expect.objectContaining({ name: "代码评审" }),
      confidence: expect.any(Number),
      candidates: expect.any(Array),
    });
    expect(prepared.activeSkills[0].skill.name).toBe("代码评审");
    expect(prepared.toolInstructions).toContain("readResource");
    expect(prepared.toolInstructions).toContain("runScript");
    expect(prepared.systemPatch).toContain("# Selected Skill (Level 1): 代码评审");
    expect(prepared.systemPatch).toContain("核心工作流程");
    expect(runtime.getTrace().map((event) => event.type)).toEqual(
      expect.arrayContaining(["scan_start", "scan_complete", "search_start", "skill_selected", "context_built"]),
    );
    expect(runtime.getTraceRecord()).toMatchObject({
      runId: expect.stringMatching(/^run_/),
      userMessage: "代码评审",
      selectedSkill: "代码评审",
      candidates: [expect.objectContaining({ name: "代码评审", score: expect.any(Number) })],
      context: {
        catalogTokens: expect.any(Number),
        skillTokens: expect.any(Number),
        resourceTokens: 0,
      },
    });
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
    expect(runtime.getTraceRecord()).toMatchObject({
      tools: [expect.objectContaining({ name: "readResource", path: "references/guide.md", allowed: true })],
      scripts: [expect.objectContaining({ path: "scripts/echo.mjs", allowed: true })],
      context: expect.objectContaining({ resourceTokens: expect.any(Number) }),
    });
    expect(runtime.getTrace().map((event) => event.type)).toEqual(
      expect.arrayContaining(["resource_read", "script_run_start", "script_run_complete"]),
    );

    runtime.clearTrace();
    expect(runtime.getTrace()).toEqual([]);
  });

  it("enforces runtime read permissions", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "skillbridge-policy-read-"));
    const skillRoot = path.join(tempRoot, "skills");
    const skillDir = path.join(skillRoot, "review");

    await mkdir(path.join(skillDir, "references"), { recursive: true });
    await mkdir(path.join(skillDir, "assets"), { recursive: true });
    await writeFile(
      path.join(skillDir, "SKILL.md"),
      `---
name: Policy Review
description: Review with resource policy
permissions:
  read:
    - references/**
---

# Policy Review`,
      "utf8",
    );
    await writeFile(path.join(skillDir, "references", "guide.md"), "allowed", "utf8");
    await writeFile(path.join(skillDir, "assets", "secret.txt"), "denied", "utf8");

    const runtime = new SkillBridgeRuntime([skillRoot]);
    await runtime.init();

    await expect(
      runtime.readResource({
        skillPath: skillDir,
        resourcePath: "assets/secret.txt",
      }),
    ).rejects.toThrow("Policy denied read_resource");
    expect(runtime.getTrace().map((event) => event.type)).toContain("policy_audit");
  });

  it("enforces runtime execute permissions before scripts run", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "skillbridge-policy-execute-"));
    const skillDir = path.join(tempRoot, "skill");
    const scriptsDir = path.join(skillDir, "scripts");

    await mkdir(scriptsDir, { recursive: true });
    await writeFile(path.join(scriptsDir, "echo.mjs"), `console.log("should not run");`, "utf8");

    const runtime = new SkillBridgeRuntime([skillDir]);
    const skill = {
      name: "No Execute",
      description: "Execution denied",
      path: skillDir,
      frontmatter: {},
      permissions: { execute: false },
      references: [],
      scripts: ["scripts/echo.mjs"],
      assets: [],
    };

    await expect(
      runtime.runScript({
        skill,
        scriptPath: "scripts/echo.mjs",
        enableScripts: true,
      }),
    ).rejects.toThrow("Policy denied run_script");
    expect(runtime.getTrace().map((event) => event.type)).toEqual(
      expect.arrayContaining(["script_run_start", "policy_audit", "script_run_failed"]),
    );
  });

  it("rejects scripts when not explicitly enabled", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "skillbridge-runtime-disabled-"));
    const skillDir = path.join(tempRoot, "skill");
    const scriptsDir = path.join(skillDir, "scripts");

    await mkdir(scriptsDir, { recursive: true });
    await writeFile(path.join(scriptsDir, "echo.mjs"), `console.log("hello");`, "utf8");

    const runtime = new SkillBridgeRuntime([skillDir]);
    const skill = {
      name: "Disabled Script",
      description: "Disabled script test",
      path: skillDir,
      frontmatter: {},
      references: [],
      scripts: ["scripts/echo.mjs"],
      assets: [],
    };

    await expect(
      executeLocalScript({
        skillPath: skillDir,
        scriptPath: "scripts/echo.mjs",
      }),
    ).rejects.toThrow(/disabled/);
    await expect(
      runtime.runScript({
        skill,
        scriptPath: "scripts/echo.mjs",
      }),
    ).rejects.toThrow(/disabled/);
    expect(runtime.getTrace().map((event) => event.type)).toEqual(
      expect.arrayContaining(["script_run_start", "script_run_failed"]),
    );
  });
});
