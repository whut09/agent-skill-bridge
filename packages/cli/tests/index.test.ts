import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCliProgram } from "../src/index.js";

let outputChunks: string[];
let originalWrite: typeof process.stdout.write;

async function runCli(args: string[]): Promise<string> {
  outputChunks = [];
  await createCliProgram().parseAsync(["node", "skillbridge", ...args]);
  return outputChunks.join("");
}

function parseJsonOutput(output: string): unknown {
  return JSON.parse(output);
}

async function createFixtureSkillRoot(): Promise<{ skillRoot: string; skillDir: string }> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "skillbridge-cli-"));
  const skillRoot = path.join(tempRoot, "skills");
  const skillDir = path.join(skillRoot, "code-review");

  await mkdir(path.join(skillDir, "references"), { recursive: true });
  await mkdir(path.join(skillDir, "scripts"), { recursive: true });
  await writeFile(
    path.join(skillDir, "SKILL.md"),
    `---
name: Code Review
description: Review code changes and PR risk
metadata:
  keywords: review, PR, risk
---

# Code Review

## Core Workflow

- Inspect changes
- Check risks`,
    "utf8",
  );
  await writeFile(path.join(skillDir, "references", "checklist.md"), "review checklist", "utf8");
  await writeFile(path.join(skillDir, "scripts", "check.mjs"), `console.log("script ok");`, "utf8");

  return { skillRoot, skillDir };
}

describe("cli package", () => {
  beforeEach(() => {
    outputChunks = [];
    originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      outputChunks.push(chunk.toString());
      return true;
    }) as typeof process.stdout.write;
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.stdout.write = originalWrite;
    process.exitCode = undefined;
  });

  it("prints doctor information", async () => {
    const output = await runCli(["doctor"]);
    const body = parseJsonOutput(output) as { ok: boolean; commands: string[] };

    expect(body.ok).toBe(true);
    expect(body.commands).toEqual(expect.arrayContaining(["scan", "validate", "search", "activate", "read", "run"]));
  });

  it("scans and validates real skills", async () => {
    const { skillRoot } = await createFixtureSkillRoot();
    const scanOutput = parseJsonOutput(await runCli(["scan", skillRoot])) as {
      count: number;
      skills: Array<{ name: string; references: string[]; scripts: string[] }>;
    };
    const validateOutput = parseJsonOutput(await runCli(["validate", skillRoot])) as { ok: boolean; count: number };

    expect(scanOutput.count).toBe(1);
    expect(scanOutput.skills[0]).toMatchObject({
      name: "Code Review",
      references: ["references/checklist.md"],
      scripts: ["scripts/check.mjs"],
    });
    expect(validateOutput).toMatchObject({ ok: true, count: 1 });
  });

  it("searches and activates skills", async () => {
    const { skillRoot } = await createFixtureSkillRoot();
    const searchOutput = parseJsonOutput(await runCli(["search", skillRoot, "PR risk"])) as {
      results: Array<{ skill: { name: string }; score: number }>;
    };
    const activateOutput = parseJsonOutput(await runCli(["activate", skillRoot, "PR risk"])) as {
      activeSkills: Array<{ skill: { name: string } }>;
      systemPatch: string;
    };

    expect(searchOutput.results[0].skill.name).toBe("Code Review");
    expect(searchOutput.results[0].score).toBeGreaterThan(0);
    expect(activateOutput.activeSkills[0].skill.name).toBe("Code Review");
    expect(activateOutput.systemPatch).toContain("Core Workflow");
  });

  it("reads resources and runs scripts when enabled", async () => {
    const { skillDir } = await createFixtureSkillRoot();
    const readOutput = parseJsonOutput(await runCli(["read", skillDir, "references/checklist.md"])) as {
      type: string;
      content: string;
    };
    const runOutput = parseJsonOutput(
      await runCli(["run", skillDir, "scripts/check.mjs", "--enable-scripts"]),
    ) as {
      stdout: string;
      exitCode: number;
    };

    expect(readOutput).toMatchObject({ type: "text", content: "review checklist" });
    expect(runOutput.stdout).toContain("script ok");
    expect(runOutput.exitCode).toBe(0);
  });

  it("prints runtime trace events", async () => {
    const { skillRoot } = await createFixtureSkillRoot();
    const output = await runCli(["trace", skillRoot]);

    expect(output).toContain("scan_start");
    expect(output).toContain("scan_complete");
  });

  it("prints explainable trace records", async () => {
    const { skillRoot } = await createFixtureSkillRoot();
    const jsonOutput = parseJsonOutput(await runCli(["trace", skillRoot, "--query", "PR risk", "--json"])) as {
      runId: string;
      selectedSkill: string;
      candidates: Array<{ name: string; score: number }>;
      context: { catalogTokens: number; skillTokens: number; resourceTokens: number };
    };
    const explainOutput = await runCli(["trace", skillRoot, "--query", "PR risk", "--explain"]);

    expect(jsonOutput.runId).toMatch(/^run_/);
    expect(jsonOutput.selectedSkill).toBe("Code Review");
    expect(jsonOutput.candidates[0]).toMatchObject({ name: "Code Review", score: expect.any(Number) });
    expect(jsonOutput.context.skillTokens).toBeGreaterThan(0);
    expect(explainOutput).toContain("Selected skill: Code Review");
    expect(explainOutput).toContain("Context:");
  });
});
