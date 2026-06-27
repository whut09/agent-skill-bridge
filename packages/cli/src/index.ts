#!/usr/bin/env node

import {
  SkillBridgeRuntime,
  parseSkillDir,
  readSkillResource,
  scanSkillDirs,
  searchSkills,
  type ResourceManagerResult,
  type RuntimeTraceRecord,
  type SkillManifest,
} from "@skillbridge/core";
import { Command } from "commander";

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function writeText(value: string): void {
  process.stdout.write(value.endsWith("\n") ? value : `${value}\n`);
}

function output(value: unknown, text: string, asJson: boolean): void {
  if (asJson) {
    writeJson(value);
    return;
  }

  writeText(text);
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

function formatSkillList(skillRoot: string, skills: SkillManifest[]): string {
  const lines = [`Skill root: ${skillRoot}`, `Skills: ${skills.length}`, ""];
  for (const skill of skills) {
    lines.push(`- ${skill.name}`);
    lines.push(`  ${skill.description}`);
    if (skill.metadata?.keywords?.length) {
      lines.push(`  keywords: ${skill.metadata.keywords.join(", ")}`);
    }
    lines.push(
      `  resources: ${skill.references.length} references, ${skill.scripts.length} scripts, ${skill.assets.length} assets`,
    );
  }

  return lines.join("\n");
}

function formatSearchResults(query: string, results: ReturnType<typeof searchSkills>): string {
  const lines = [`Query: ${query}`, `Matches: ${results.length}`, ""];
  for (const result of results) {
    lines.push(`- ${result.skill.name} (${result.score.toFixed(2)})`);
    lines.push(`  ${result.skill.description}`);
    lines.push(`  reason: ${result.reason.join("; ")}`);
  }

  return lines.join("\n");
}

function formatActivation(prepared: Awaited<ReturnType<SkillBridgeRuntime["prepare"]>>): string {
  const selectedSkill = prepared.activationDecision.skill?.name ?? "none";
  return [
    `Selected skill: ${selectedSkill}`,
    `Confidence: ${prepared.activationDecision.confidence.toFixed(2)}`,
    "",
    "System patch:",
    prepared.systemPatch,
    "",
    "Tool instructions:",
    prepared.toolInstructions,
  ].join("\n");
}

function formatResource(result: ResourceManagerResult): string {
  if (result.type === "binary") {
    return [
      `Resource: ${result.metadata.path}`,
      `Type: binary`,
      `MIME: ${result.metadata.mimeType}`,
      `Bytes: ${result.content.length}`,
    ].join("\n");
  }

  return [
    `Resource: ${result.metadata.path}`,
    `Type: text`,
    `MIME: ${result.metadata.mimeType}`,
    "",
    result.content,
  ].join("\n");
}

function explainTrace(record: RuntimeTraceRecord): string {
  const lines = [
    `Run: ${record.runId}`,
    `User message: ${record.userMessage || "(none)"}`,
    `Selected skill: ${record.selectedSkill ?? "(none)"}`,
    "",
    "Candidates:",
    ...(record.candidates.length > 0
      ? record.candidates.map(
          (candidate) => `- ${candidate.name} score=${candidate.score.toFixed(2)} reason=${candidate.reason}`,
        )
      : ["- none"]),
    "",
    "Context:",
    `- catalogTokens: ${record.context.catalogTokens}`,
    `- skillTokens: ${record.context.skillTokens}`,
    `- resourceTokens: ${record.context.resourceTokens}`,
    "",
    "Tools:",
    ...(record.tools.length > 0
      ? record.tools.map(
          (tool) =>
            `- ${tool.name}${tool.path ? ` ${tool.path}` : ""} allowed=${tool.allowed}${tool.reason ? ` reason=${tool.reason}` : ""}`,
        )
      : ["- none"]),
    "",
    "Scripts:",
    ...(record.scripts.length > 0
      ? record.scripts.map(
          (script) => `- ${script.path} allowed=${script.allowed}${script.reason ? ` reason=${script.reason}` : ""}`,
        )
      : ["- none"]),
  ];

  return `${lines.join("\n")}\n`;
}

export function createCliProgram(): Command {
  const program = new Command();
  let jsonOutput = false;

  program.name("skillbridge").description("agent-skill-bridge CLI").version("0.1.0");
  program.option("--json", "print machine-readable JSON output", false);
  program.hook("preAction", (thisCommand, actionCommand) => {
    jsonOutput = Boolean(thisCommand.opts<{ json: boolean }>().json || actionCommand.opts<{ json?: boolean }>().json);
  });

  const wantsJson = () => jsonOutput;

  program
    .command("doctor")
    .option("--json", "print machine-readable JSON output", false)
    .description("Inspect the local runtime setup")
    .action(() => {
      const result = {
        ok: true,
        package: "agent-skill-bridge",
        commands: ["doctor", "scan", "validate", "search", "activate", "read", "run", "trace"],
      };
      output(result, `agent-skill-bridge: ok\nCommands: ${result.commands.join(", ")}`, wantsJson());
    });

  program
    .command("scan")
    .argument("[path]", "path to a skill root directory", ".")
    .option("--json", "print machine-readable JSON output", false)
    .description("Scan a skill root and print discovered skill manifests")
    .action(async (skillRoot: string) => {
      const skills = await scanSkillDirs([skillRoot]);
      const result = {
        skillRoot,
        count: skills.length,
        skills: skills.map(summarizeSkill),
      };
      output(result, formatSkillList(skillRoot, skills), wantsJson());
    });

  program
    .command("validate")
    .argument("[path]", "path to a skill root directory", ".")
    .option("--json", "print machine-readable JSON output", false)
    .description("Validate that skills can be scanned and parsed")
    .action(async (skillRoot: string) => {
      try {
        const skills = await scanSkillDirs([skillRoot]);
        const result = {
          ok: true,
          skillRoot,
          count: skills.length,
          skills: skills.map((skill) => skill.name),
        };
        output(result, `Validation passed: ${skills.length} skill(s) under ${skillRoot}`, wantsJson());
      } catch (error) {
        const result = {
          ok: false,
          skillRoot,
          error: error instanceof Error ? error.message : String(error),
        };
        output(result, `Validation failed: ${result.error}`, wantsJson());
        process.exitCode = 1;
      }
    });

  program
    .command("search")
    .argument("<path>", "path to a skill root directory")
    .argument("<query>", "user task query")
    .description("Search skills for a user task")
    .option("--json", "print machine-readable JSON output", false)
    .option("--top-k <number>", "maximum number of results", (value) => Number(value), 5)
    .option("--min-score <number>", "minimum normalized score", (value) => Number(value), 0.15)
    .action(async (skillRoot: string, query: string, options: { topK: number; minScore: number }) => {
      const skills = await scanSkillDirs([skillRoot]);
      const results = searchSkills(query, skills, {
        topK: options.topK,
        minScore: options.minScore,
      });
      const result = {
        query,
        results: results.map((result) => ({
          skill: summarizeSkill(result.skill),
          score: result.score,
          reason: result.reason,
        })),
      };
      output(result, formatSearchResults(query, results), wantsJson());
    });

  program
    .command("activate")
    .argument("<path>", "path to a skill root directory")
    .argument("<query>", "user task query")
    .description("Select a skill and print the runtime context")
    .option("--json", "print machine-readable JSON output", false)
    .option("--budget <number>", "context budget", (value) => Number(value))
    .action(async (skillRoot: string, query: string, options: { budget?: number }) => {
      const runtime = new SkillBridgeRuntime([skillRoot]);
      await runtime.init();
      const prepared = await runtime.prepare({
        messages: [{ role: "user", content: query }],
        userMessage: query,
        budget: options.budget,
      });
      output(prepared, formatActivation(prepared), wantsJson());
    });

  program
    .command("read")
    .argument("<skillPath>", "path to a single skill directory")
    .argument("<resourcePath>", "resource path inside the skill directory")
    .description("Read a resource from a skill directory")
    .option("--json", "print machine-readable JSON output", false)
    .action(async (skillPath: string, resourcePath: string) => {
      const result = await readSkillResource({ skillPath, resourcePath });
      output(serializeResource(result), formatResource(result), wantsJson());
    });

  program
    .command("run")
    .argument("<skillPath>", "path to a single skill directory")
    .argument("<scriptPath>", "script path inside scripts/")
    .description("Run a skill script from scripts/")
    .option("--json", "print machine-readable JSON output", false)
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
        output(
          result,
          [
            `Script: ${scriptPath}`,
            `Exit code: ${result.exitCode}`,
            `Timed out: ${result.timedOut}`,
            "",
            "stdout:",
            result.stdout || "(empty)",
            "",
            "stderr:",
            result.stderr || "(empty)",
          ].join("\n"),
          wantsJson(),
        );
      },
    );

  program
    .command("trace")
    .argument("[path]", "path to a skill root directory", ".")
    .description("Print runtime trace events or an explainable trace record")
    .option("--query <query>", "user task query to activate before printing trace")
    .option("--last", "print the last standard trace record", false)
    .option("--json", "print the standard trace record as JSON", false)
    .option("--explain", "print a human-readable trace explanation", false)
    .action(async (skillRoot: string, options: { query?: string; last: boolean; json: boolean; explain: boolean }) => {
      const runtime = new SkillBridgeRuntime([skillRoot]);
      await runtime.init();
      if (options.query) {
        await runtime.prepare({
          messages: [{ role: "user", content: options.query }],
          userMessage: options.query,
        });
      }

      if (options.explain) {
        process.stdout.write(explainTrace(runtime.getTraceRecord()));
        return;
      }

      if (options.last || options.json || wantsJson()) {
        writeJson(runtime.getTraceRecord());
        return;
      }

      writeText(
        runtime
          .getTrace()
          .map((event) => `${event.timestamp} ${event.type}: ${event.message}`)
          .join("\n"),
      );
    });

  return program;
}

if (process.argv[1]?.endsWith("index.js") || process.argv[1]?.endsWith("index.ts")) {
  await createCliProgram().parseAsync(process.argv);
}
