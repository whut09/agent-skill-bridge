#!/usr/bin/env node

import {
  SkillBridgeRuntime,
  createRuntimePolicyFromConfig,
  loadSkillBridgePolicy,
  lintSkillConformance,
  parseSkillDir,
  readSkillResource,
  scanSkillDirs,
  searchSkills,
  type ResourceManagerResult,
  type LocalScriptExecutorResult,
  type RuntimeTraceRecord,
  type SkillConformanceSummary,
  type SkillManifest,
} from "@skillbridge/core";
import { Command } from "commander";
import { readFile } from "node:fs/promises";
import path from "node:path";

type CliCommonOptions = {
  json?: boolean;
  debug?: boolean;
  budget?: number;
};

type RoutingEvalCase = {
  id?: string;
  query: string;
  expectedSkill: string | null;
};

type RoutingEvalResult = {
  id?: string;
  query: string;
  expectedSkill: string;
  predictedSkill: string;
  score: number;
  correct: boolean;
  reason: string[];
};

type RoutingEvalSummary = {
  evalFile: string;
  skillDir: string;
  thresholds?: {
    failUnder?: number;
    maxFalsePositive?: number;
  };
  passed: boolean;
  failures: string[];
  total: number;
  correct: number;
  accuracy: number;
  false_positive: {
    count: number;
    rate: number;
  };
  false_negative: {
    count: number;
    rate: number;
  };
  confusionMatrix: Record<string, Record<string, number>>;
  results: RoutingEvalResult[];
};

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

function toSafeDisplayPath(candidatePath: string, debug: boolean): string {
  if (debug || !path.isAbsolute(candidatePath)) {
    return candidatePath;
  }

  const relativePath = path.relative(process.cwd(), candidatePath);
  if (!relativePath.startsWith("..") && !path.isAbsolute(relativePath)) {
    return relativePath.split(path.sep).join("/");
  }

  return path.basename(candidatePath);
}

function summarizeSkill(skill: SkillManifest, debug: boolean) {
  return {
    name: skill.name,
    description: skill.description,
    path: toSafeDisplayPath(skill.path, debug),
    version: skill.version,
    license: skill.license,
    metadata: skill.metadata,
    references: skill.references,
    scripts: skill.scripts,
    assets: skill.assets,
  };
}

function serializeResource(result: ResourceManagerResult, debug: boolean) {
  if (result.type === "binary") {
    return {
      ...result,
      path: toSafeDisplayPath(result.path, debug),
      content: result.content.toString("base64"),
      encoding: "base64",
    };
  }

  return {
    ...result,
    path: toSafeDisplayPath(result.path, debug),
    metadata: {
      ...result.metadata,
      path: toSafeDisplayPath(result.metadata.path, debug),
    },
  };
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

function formatConformanceReport(summary: SkillConformanceSummary, title: string): string {
  const lines = [
    `${title}: ${summary.ok ? "PASS" : "FAIL"}`,
    `Skill root: ${summary.skillRoot}`,
    `Skills: ${summary.total}`,
    `Errors: ${summary.errors}`,
    `Warnings: ${summary.warnings}`,
  ];

  for (const skill of summary.skills) {
    lines.push("");
    lines.push(`- ${skill.ok ? "PASS" : "FAIL"} ${skill.name}`);
    lines.push(`  id: ${skill.id}`);
    lines.push(`  references: ${skill.references.length}`);
    lines.push(`  scripts: ${skill.scripts.length}`);
    for (const issue of skill.issues) {
      lines.push(`  ${issue.severity.toUpperCase()} ${issue.category}/${issue.code}: ${issue.message}`);
    }
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

function incrementConfusionMatrix(
  matrix: Record<string, Record<string, number>>,
  expectedSkill: string,
  predictedSkill: string,
): void {
  matrix[expectedSkill] ??= {};
  matrix[expectedSkill][predictedSkill] = (matrix[expectedSkill][predictedSkill] ?? 0) + 1;
}

function normalizeExpectedSkill(value: string | null | undefined): string {
  if (!value || value === "none" || value === "null") {
    return "no-skill";
  }

  return value;
}

function resolveExpectedSkillId(skills: SkillManifest[], expectedSkill: string): string {
  const normalizedExpectedSkill = normalizeExpectedSkill(expectedSkill);
  if (normalizedExpectedSkill === "no-skill") {
    return normalizedExpectedSkill;
  }

  const matchingSkill = skills.find(
    (skill) =>
      skill.id === normalizedExpectedSkill ||
      skill.name === normalizedExpectedSkill ||
      skill.name.toLowerCase() === normalizedExpectedSkill.toLowerCase(),
  );

  return matchingSkill?.id ?? normalizedExpectedSkill;
}

async function readRoutingEvalFile(evalFile: string): Promise<RoutingEvalCase[]> {
  const content = await readFile(evalFile, "utf8");
  const cases: RoutingEvalCase[] = [];

  for (const [index, line] of content.split(/\r?\n/u).entries()) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith("#")) {
      continue;
    }

    const parsed = JSON.parse(trimmedLine) as Partial<RoutingEvalCase>;
    if (!parsed.query || !("expectedSkill" in parsed)) {
      throw new Error(`Invalid routing eval case on line ${index + 1}: query and expectedSkill are required.`);
    }

    cases.push({
      id: parsed.id,
      query: parsed.query,
      expectedSkill: parsed.expectedSkill ?? "no-skill",
    });
  }

  return cases;
}

function evaluateRouting(
  evalFile: string,
  skillDir: string,
  skills: SkillManifest[],
  cases: RoutingEvalCase[],
  options: { topK: number; minScore: number; failUnder?: number; maxFalsePositive?: number },
): RoutingEvalSummary {
  const confusionMatrix: Record<string, Record<string, number>> = {};
  const results = cases.map((testCase) => {
    const expectedSkill = resolveExpectedSkillId(skills, normalizeExpectedSkill(testCase.expectedSkill));
    const matches = searchSkills(testCase.query, skills, {
      topK: options.topK,
      minScore: options.minScore,
    });
    const predicted = matches[0];
    const predictedSkill = predicted?.skill.id ?? "no-skill";
    const correct = predictedSkill === expectedSkill;

    incrementConfusionMatrix(confusionMatrix, expectedSkill, predictedSkill);

    return {
      id: testCase.id,
      query: testCase.query,
      expectedSkill,
      predictedSkill,
      score: predicted?.score ?? 0,
      correct,
      reason: predicted?.reason ?? [],
    };
  });

  const total = results.length;
  const correct = results.filter((result) => result.correct).length;
  const falsePositiveCount = results.filter(
    (result) => result.expectedSkill === "no-skill" && result.predictedSkill !== "no-skill",
  ).length;
  const falseNegativeCount = results.filter(
    (result) => result.expectedSkill !== "no-skill" && result.predictedSkill === "no-skill",
  ).length;
  const accuracy = total === 0 ? 0 : correct / total;
  const falsePositiveRate = total === 0 ? 0 : falsePositiveCount / total;
  const failures: string[] = [];

  if (options.failUnder !== undefined && accuracy < options.failUnder) {
    failures.push(`Accuracy ${accuracy.toFixed(2)} is below fail-under ${options.failUnder.toFixed(2)}.`);
  }
  if (options.maxFalsePositive !== undefined && falsePositiveRate > options.maxFalsePositive) {
    failures.push(
      `False positive rate ${falsePositiveRate.toFixed(2)} exceeds max-false-positive ${options.maxFalsePositive.toFixed(2)}.`,
    );
  }

  return {
    evalFile,
    skillDir,
    thresholds:
      options.failUnder !== undefined || options.maxFalsePositive !== undefined
        ? {
            failUnder: options.failUnder,
            maxFalsePositive: options.maxFalsePositive,
          }
        : undefined,
    passed: failures.length === 0,
    failures,
    total,
    correct,
    accuracy,
    false_positive: {
      count: falsePositiveCount,
      rate: falsePositiveRate,
    },
    false_negative: {
      count: falseNegativeCount,
      rate: total === 0 ? 0 : falseNegativeCount / total,
    },
    confusionMatrix,
    results,
  };
}

function formatConfusionMatrix(matrix: Record<string, Record<string, number>>): string {
  const lines: string[] = [];
  for (const [expectedSkill, predictions] of Object.entries(matrix)) {
    const predictionText = Object.entries(predictions)
      .map(([predictedSkill, count]) => `${predictedSkill}=${count}`)
      .join(", ");
    lines.push(`- ${expectedSkill}: ${predictionText}`);
  }

  return lines.length > 0 ? lines.join("\n") : "- empty";
}

function formatRoutingEval(summary: RoutingEvalSummary): string {
  return [
    `Routing eval: ${summary.evalFile}`,
    `Skill dir: ${summary.skillDir}`,
    `Gate: ${summary.passed ? "PASS" : "FAIL"}`,
    `Accuracy: ${summary.accuracy.toFixed(2)} (${summary.correct}/${summary.total})`,
    `False positive: ${summary.false_positive.count} (${summary.false_positive.rate.toFixed(2)})`,
    `False negative: ${summary.false_negative.count} (${summary.false_negative.rate.toFixed(2)})`,
    ...(summary.failures.length > 0 ? ["", "Failures:", ...summary.failures.map((failure) => `- ${failure}`)] : []),
    "",
    "Confusion matrix:",
    formatConfusionMatrix(summary.confusionMatrix),
    "",
    "Cases:",
    ...summary.results.map(
      (result) =>
        `- ${result.correct ? "PASS" : "FAIL"} ${result.id ?? result.query}: expected=${result.expectedSkill} predicted=${result.predictedSkill} score=${result.score.toFixed(2)}`,
    ),
  ].join("\n");
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

function formatResource(result: ResourceManagerResult, debug: boolean): string {
  const resourcePath = toSafeDisplayPath(result.metadata.path, debug);
  if (result.type === "binary") {
    return [
      `Resource: ${resourcePath}`,
      `Type: binary`,
      `MIME: ${result.metadata.mimeType}`,
      `Bytes: ${result.content.length}`,
    ].join("\n");
  }

  return [`Resource: ${resourcePath}`, `Type: text`, `MIME: ${result.metadata.mimeType}`, "", result.content].join(
    "\n",
  );
}

function formatScriptResult(scriptPath: string, result: LocalScriptExecutorResult): string {
  return [
    `Script: ${scriptPath}`,
    `Exit code: ${result.exitCode}`,
    `Timed out: ${result.timedOut}`,
    "",
    "stdout:",
    result.stdout || "(empty)",
    "",
    "stderr:",
    result.stderr || "(empty)",
  ].join("\n");
}

function addCommonOptions(command: Command, includeBudget = false): Command {
  command.option("--json", "print machine-readable JSON output", false);
  command.option("--debug", "include debug details such as absolute paths", false);
  if (includeBudget) {
    command.option("--budget <number>", "context budget", (value) => Number(value));
  } else {
    command.option("--budget <number>", "accepted for command consistency", (value) => Number(value));
  }

  return command;
}

async function resolveSkillByName(skillRoot: string, skillName: string): Promise<SkillManifest> {
  const { config } = await loadSkillBridgePolicy([skillRoot, process.cwd()]);
  const runtime = new SkillBridgeRuntime([skillRoot], createRuntimePolicyFromConfig(config));
  await runtime.init();
  const skill = runtime.getSkillByName(skillName);
  if (!skill) {
    throw new Error(`Skill not found by name: ${skillName}`);
  }

  return skill;
}

async function createRuntime(skillDirs: string[]): Promise<SkillBridgeRuntime> {
  const { config } = await loadSkillBridgePolicy([...skillDirs, process.cwd()]);
  return new SkillBridgeRuntime(skillDirs, createRuntimePolicyFromConfig(config));
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
  let debugOutput = false;

  program.name("skillbridge").description("agent-skill-bridge CLI").version("0.1.0");
  program.option("--json", "print machine-readable JSON output", false);
  program.option("--debug", "include debug details such as absolute paths", false);
  program.option("--budget <number>", "default context budget", (value) => Number(value));
  program.hook("preAction", (thisCommand, actionCommand) => {
    const rootOptions = thisCommand.opts<CliCommonOptions>();
    const actionOptions = actionCommand.opts<CliCommonOptions>();
    jsonOutput = Boolean(rootOptions.json || actionOptions.json);
    debugOutput = Boolean(rootOptions.debug || actionOptions.debug);
  });

  const wantsJson = () => jsonOutput;
  const wantsDebug = () => debugOutput;
  const rootBudget = () => program.opts<CliCommonOptions>().budget;

  addCommonOptions(program.command("doctor"))
    .description("Inspect the local runtime setup")
    .action(() => {
      const result = {
        ok: true,
        package: "agent-skill-bridge",
        commands: ["doctor", "scan", "validate", "lint", "search", "activate", "read", "run", "exec", "trace", "eval"],
      };
      output(result, `agent-skill-bridge: ok\nCommands: ${result.commands.join(", ")}`, wantsJson());
    });

  addCommonOptions(program.command("scan"))
    .argument("[path]", "path to a skill root directory", ".")
    .description("Scan a skill root and print discovered skill manifests")
    .action(async (skillRoot: string) => {
      const skills = await scanSkillDirs([skillRoot]);
      const result = {
        skillRoot,
        count: skills.length,
        skills: skills.map((skill) => summarizeSkill(skill, wantsDebug())),
      };
      output(result, formatSkillList(skillRoot, skills), wantsJson());
    });

  addCommonOptions(program.command("validate"))
    .argument("[path]", "path to a skill root directory", ".")
    .description("Validate that skills can be scanned, parsed, and pass conformance checks")
    .action(async (skillRoot: string) => {
      try {
        const result = await lintSkillConformance([skillRoot]);
        output(result, formatConformanceReport(result, "Validation"), wantsJson());
        if (!result.ok) {
          process.exitCode = 1;
        }
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

  addCommonOptions(program.command("lint"))
    .argument("[path]", "path to a skill root directory", ".")
    .description("Run the Skill conformance suite and print a JSON-ready report")
    .action(async (skillRoot: string) => {
      try {
        const result = await lintSkillConformance([skillRoot]);
        output(result, formatConformanceReport(result, "Lint"), wantsJson());
        if (!result.ok) {
          process.exitCode = 1;
        }
      } catch (error) {
        const result = {
          ok: false,
          skillRoot,
          error: error instanceof Error ? error.message : String(error),
        };
        output(result, `Lint failed: ${result.error}`, wantsJson());
        process.exitCode = 1;
      }
    });

  addCommonOptions(program.command("search"))
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
      const result = {
        query,
        results: results.map((result) => ({
          skill: summarizeSkill(result.skill, wantsDebug()),
          score: result.score,
          reason: result.reason,
        })),
      };
      output(result, formatSearchResults(query, results), wantsJson());
    });

  addCommonOptions(program.command("activate"), true)
    .argument("<path>", "path to a skill root directory")
    .argument("<query>", "user task query")
    .description("Select a skill and print the runtime context")
    .action(async (skillRoot: string, query: string, options: { budget?: number }) => {
      const runtime = await createRuntime([skillRoot]);
      await runtime.init();
      const prepared = await runtime.prepare({
        messages: [{ role: "user", content: query }],
        userMessage: query,
        budget: options.budget ?? rootBudget(),
      });
      output(prepared, formatActivation(prepared), wantsJson());
    });

  addCommonOptions(program.command("read"))
    .argument("<skillRootOrPath>", "skill root directory, or a single skill directory for legacy usage")
    .argument("<skillNameOrResourcePath>", "skill name, or resource path for legacy usage")
    .argument("[resourcePath]", "resource path inside the skill directory")
    .description("Read a resource from a named skill or skill directory")
    .action(async (skillRootOrPath: string, skillNameOrResourcePath: string, resourcePath?: string) => {
      const { config } = await loadSkillBridgePolicy([skillRootOrPath, process.cwd()]);
      const skillPath = resourcePath
        ? (await resolveSkillByName(skillRootOrPath, skillNameOrResourcePath)).path
        : skillRootOrPath;
      const resolvedResourcePath = resourcePath ?? skillNameOrResourcePath;
      const result = await readSkillResource({
        skillPath,
        resourcePath: resolvedResourcePath,
        maxFileBytes: config.resources?.maxFileBytes,
        allowBinary: config.resources?.allowBinary,
        allowedExtensions: config.resources?.allowedExtensions,
        deniedExtensions: config.resources?.deniedExtensions,
      });
      output(serializeResource(result, wantsDebug()), formatResource(result, wantsDebug()), wantsJson());
    });

  addCommonOptions(program.command("run"))
    .argument("<skillRootOrPath>", "skill root directory, or a single skill directory for legacy usage")
    .argument("<skillNameOrScriptPath>", "skill name, or script path for legacy usage")
    .argument("[scriptPath]", "script path inside scripts/")
    .description("Run a skill script from a named skill or skill directory")
    .option("--enable-scripts", "allow local script execution", false)
    .option("--timeout-ms <number>", "script timeout in milliseconds", (value) => Number(value))
    .option("--arg <value>", "script argument", (value, previous: string[]) => [...previous, value], [])
    .action(
      async (
        skillRootOrPath: string,
        skillNameOrScriptPath: string,
        scriptPath: string | undefined,
        options: { enableScripts: boolean; timeoutMs?: number; arg: string[] },
      ) => {
        const skill = scriptPath
          ? await resolveSkillByName(skillRootOrPath, skillNameOrScriptPath)
          : await parseSkillDir(skillRootOrPath);
        const resolvedScriptPath = scriptPath ?? skillNameOrScriptPath;
        const runtime = await createRuntime([skill.path]);
        const result = await runtime.runScript({
          skill,
          scriptPath: resolvedScriptPath,
          enableScripts: options.enableScripts || undefined,
          timeoutMs: options.timeoutMs,
          args: options.arg,
        });
        output(result, formatScriptResult(resolvedScriptPath, result), wantsJson());
      },
    );

  addCommonOptions(program.command("exec"), true)
    .argument("<path>", "path to a skill root directory")
    .argument("<query>", "user task query used to route the skill")
    .description("Route a query to a skill and run its default entrypoint script")
    .option("--enable-scripts", "allow local script execution", false)
    .option("--timeout-ms <number>", "script timeout in milliseconds", (value) => Number(value))
    .option("--script <path>", "override the selected skill default entrypoint")
    .option("--arg <value>", "script argument", (value, previous: string[]) => [...previous, value], [])
    .action(
      async (
        skillRoot: string,
        query: string,
        options: { enableScripts: boolean; timeoutMs?: number; script?: string; arg: string[]; budget?: number },
      ) => {
        const runtime = await createRuntime([skillRoot]);
        await runtime.init();
        const prepared = await runtime.prepare({
          messages: [{ role: "user", content: query }],
          userMessage: query,
          budget: options.budget ?? rootBudget(),
        });
        const skill = prepared.activationDecision.skill;
        if (!skill) {
          throw new Error(`No skill selected for query: ${query}`);
        }
        const scriptPath =
          options.script ?? skill.entrypoints?.default ?? (skill.scripts.length === 1 ? skill.scripts[0] : undefined);
        if (!scriptPath) {
          throw new Error(
            `Selected skill has no default entrypoint and does not contain exactly one script: ${skill.name}`,
          );
        }
        const scriptResult = await runtime.runScript({
          skill,
          scriptPath,
          enableScripts: options.enableScripts || undefined,
          timeoutMs: options.timeoutMs,
          args: options.arg,
        });
        const result = {
          query,
          selectedSkill: {
            id: skill.id,
            name: skill.name,
          },
          scriptPath,
          activationDecision: prepared.activationDecision,
          result: scriptResult,
        };
        output(
          result,
          [
            `Selected skill: ${skill.name}`,
            `Confidence: ${prepared.activationDecision.confidence.toFixed(2)}`,
            "",
            formatScriptResult(scriptPath, scriptResult),
          ].join("\n"),
          wantsJson(),
        );
      },
    );

  addCommonOptions(program.command("trace"))
    .argument("[path]", "path to a skill root directory", ".")
    .description("Print runtime trace events or an explainable trace record")
    .option("--query <query>", "user task query to activate before printing trace")
    .option("--last", "print the last standard trace record", false)
    .option("--explain", "print a human-readable trace explanation", false)
    .action(async (skillRoot: string, options: { query?: string; last: boolean; explain: boolean }) => {
      const runtime = await createRuntime([skillRoot]);
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

      if (options.last || wantsJson()) {
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

  addCommonOptions(program.command("eval"))
    .argument("<evalFile>", "JSONL routing eval file")
    .description("Evaluate skill routing against labeled JSONL cases")
    .requiredOption("--skill-dir <dir>", "path to a skill root directory")
    .option("--top-k <number>", "maximum number of candidates per query", (value) => Number(value), 5)
    .option("--min-score <number>", "minimum normalized score", (value) => Number(value), 0.15)
    .option("--fail-under <number>", "fail when accuracy is below this value", (value) => Number(value))
    .option("--max-false-positive <number>", "fail when false positive rate is above this value", (value) =>
      Number(value),
    )
    .action(
      async (
        evalFile: string,
        options: { skillDir: string; topK: number; minScore: number; failUnder?: number; maxFalsePositive?: number },
      ) => {
        const skills = await scanSkillDirs([options.skillDir]);
        const cases = await readRoutingEvalFile(evalFile);
        const summary = evaluateRouting(evalFile, options.skillDir, skills, cases, {
          topK: options.topK,
          minScore: options.minScore,
          failUnder: options.failUnder,
          maxFalsePositive: options.maxFalsePositive,
        });

        output(summary, formatRoutingEval(summary), wantsJson());
        if (!summary.passed) {
          process.exitCode = 1;
        }
      },
    );

  return program;
}

if (process.argv[1]?.endsWith("index.js") || process.argv[1]?.endsWith("index.ts")) {
  await createCliProgram().parseAsync(process.argv);
}
