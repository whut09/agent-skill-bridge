#!/usr/bin/env node

import {
  SkillBridgeRuntime,
  parseSkillDir,
  readSkillResource,
  scanSkillDirs,
  searchSkills,
  type ResourceManagerResult,
  type SkillManifest,
} from "@skillbridge/core";
import { Command } from "commander";

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function summarizeSkill(skill: SkillManifest) {
  return {
    name: skill.name,
    description: skill.description,
    path: skill.path,
    version: skill.version,
    license: skill.license,
    metadata: skill.metadata,
    references: skill.references,
    scripts: skill.scripts,
    assets: skill.assets,
  };
}

function serializeResource(result: ResourceManagerResult) {
  if (result.type === "binary") {
    return {
      ...result,
      content: result.content.toString("base64"),
      encoding: "base64",
    };
  }

  return result;
}

export function createCliProgram(): Command {
  const program = new Command();

  program.name("skillbridge").description("agent-skill-bridge CLI").version("0.1.0");

  program
    .command("doctor")
    .description("Inspect the local runtime setup")
    .action(() => {
      writeJson({
        ok: true,
        package: "agent-skill-bridge",
        commands: ["doctor", "scan", "validate", "search", "activate", "read", "run", "trace"],
      });
    });

  program
    .command("scan")
    .argument("[path]", "path to a skill root directory", ".")
    .description("Scan a skill root and print discovered skill manifests")
    .action(async (skillRoot: string) => {
      const skills = await scanSkillDirs([skillRoot]);
      writeJson({
        skillRoot,
        count: skills.length,
        skills: skills.map(summarizeSkill),
      });
    });

  program
    .command("validate")
    .argument("[path]", "path to a skill root directory", ".")
    .description("Validate that skills can be scanned and parsed")
    .action(async (skillRoot: string) => {
      try {
        const skills = await scanSkillDirs([skillRoot]);
        writeJson({
          ok: true,
          skillRoot,
          count: skills.length,
          skills: skills.map((skill) => skill.name),
        });
      } catch (error) {
        writeJson({
          ok: false,
          skillRoot,
          error: error instanceof Error ? error.message : String(error),
        });
        process.exitCode = 1;
      }
    });

  program
    .command("search")
    .argument("<path>", "path to a skill root directory")
    .argument("<query>", "user task query")
    .description("Search skills for a user task")
    .option("--top-k <number>", "maximum number of results", (value) => Number(value), 5)
    .option("--min-score <number>", "minimum normalized score", (value) => Number(value), 0.15)
    .action(async (skillRoot: string, query: string, options: { topK: number; minScore: number }) => {
      const skills = await scanSkillDirs([skillRoot]);
      const results = searchSkills(query, skills, {
        topK: options.topK,
        minScore: options.minScore,
      });
      writeJson({
        query,
        results: results.map((result) => ({
          skill: summarizeSkill(result.skill),
          score: result.score,
          reason: result.reason,
        })),
      });
    });

  program
    .command("activate")
    .argument("<path>", "path to a skill root directory")
    .argument("<query>", "user task query")
    .description("Select a skill and print the runtime context")
    .option("--budget <number>", "context budget", (value) => Number(value))
    .action(async (skillRoot: string, query: string, options: { budget?: number }) => {
      const runtime = new SkillBridgeRuntime([skillRoot]);
      await runtime.init();
      const prepared = await runtime.prepare({
        messages: [{ role: "user", content: query }],
        userMessage: query,
        budget: options.budget,
      });
      writeJson(prepared);
    });

  program
    .command("read")
    .argument("<skillPath>", "path to a single skill directory")
    .argument("<resourcePath>", "resource path inside the skill directory")
    .description("Read a resource from a skill directory")
    .action(async (skillPath: string, resourcePath: string) => {
      const result = await readSkillResource({ skillPath, resourcePath });
      writeJson(serializeResource(result));
    });

  program
    .command("run")
    .argument("<skillPath>", "path to a single skill directory")
    .argument("<scriptPath>", "script path inside scripts/")
    .description("Run a skill script from scripts/")
    .option("--enable-scripts", "allow local script execution", false)
    .option("--timeout-ms <number>", "script timeout in milliseconds", (value) => Number(value))
    .option("--arg <value>", "script argument", (value, previous: string[]) => [...previous, value], [])
    .action(
      async (
        skillPath: string,
        scriptPath: string,
        options: { enableScripts: boolean; timeoutMs?: number; arg: string[] },
      ) => {
        const skill = await parseSkillDir(skillPath);
        const runtime = new SkillBridgeRuntime([skillPath]);
        const result = await runtime.runScript({
          skill,
          scriptPath,
          enableScripts: options.enableScripts,
          timeoutMs: options.timeoutMs,
          args: options.arg,
        });
        writeJson(result);
      },
    );

  program
    .command("trace")
    .argument("[path]", "path to a skill root directory", ".")
    .description("Print runtime trace events for a skill directory scan")
    .action(async (skillRoot: string) => {
      const runtime = new SkillBridgeRuntime([skillRoot]);
      await runtime.init();
      writeJson(runtime.getTrace());
    });

  return program;
}

if (process.argv[1]?.endsWith("index.js") || process.argv[1]?.endsWith("index.ts")) {
  await createCliProgram().parseAsync(process.argv);
}
