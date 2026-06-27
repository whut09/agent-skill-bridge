import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { executeLocalScript } from "../src/local-executor.js";

describe("local executor", () => {
  it("runs a normal script and captures output", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "skillbridge-executor-"));
    const skillDir = path.join(tempRoot, "skill");
    const scriptsDir = path.join(skillDir, "scripts");

    await mkdir(scriptsDir, { recursive: true });
    await writeFile(
      path.join(scriptsDir, "hello.mjs"),
      `console.log("hello stdout"); console.error("hello stderr");`,
      "utf8",
    );

    const result = await executeLocalScript({
      skillPath: skillDir,
      scriptPath: "scripts/hello.mjs",
      enableScripts: true,
      timeoutMs: 5000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello stdout");
    expect(result.stderr).toContain("hello stderr");
    expect(result.timedOut).toBe(false);
  });

  it("times out long running scripts", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "skillbridge-timeout-"));
    const skillDir = path.join(tempRoot, "skill");
    const scriptsDir = path.join(skillDir, "scripts");

    await mkdir(scriptsDir, { recursive: true });
    await writeFile(path.join(scriptsDir, "sleep.mjs"), `setTimeout(() => console.log("done"), 1000);`, "utf8");

    const result = await executeLocalScript({
      skillPath: skillDir,
      scriptPath: "scripts/sleep.mjs",
      enableScripts: true,
      timeoutMs: 100,
    });

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
  });

  it("rejects illegal paths outside scripts directory", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "skillbridge-path-"));
    const skillDir = path.join(tempRoot, "skill");

    await mkdir(skillDir, { recursive: true });

    await expect(
      executeLocalScript({
        skillPath: skillDir,
        scriptPath: "../evil.mjs",
        enableScripts: true,
      }),
    ).rejects.toThrow(/outside scripts directory|non-scripts path/);
  });

  it("rejects execution when scripts are not enabled", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "skillbridge-disabled-"));
    const skillDir = path.join(tempRoot, "skill");
    const scriptsDir = path.join(skillDir, "scripts");

    await mkdir(scriptsDir, { recursive: true });
    await writeFile(path.join(scriptsDir, "hello.mjs"), `console.log("hello");`, "utf8");

    await expect(
      executeLocalScript({
        skillPath: skillDir,
        scriptPath: "scripts/hello.mjs",
      }),
    ).rejects.toThrow(/disabled/);
  });
});
