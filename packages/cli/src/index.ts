#!/usr/bin/env node

import { SkillBridgeRuntime } from "@skillbridge/core";
import { Command } from "commander";

export function createCliProgram(): Command {
  const program = new Command();

  program.name("skillbridge").description("agent-skill-bridge CLI").version("0.1.0");

  program
    .command("doctor")
    .description("Inspect the local runtime setup")
    .action(() => {
      process.stdout.write("agent-skill-bridge CLI is installed.\n");
    });

  program
    .command("scan")
    .argument("[path]", "path to a skill directory", ".")
    .description("Scan a skill directory")
    .action((skillPath: string) => {
      process.stdout.write(`Scanning skills under ${skillPath}\n`);
    });

  program
    .command("trace")
    .argument("[path]", "path to a skill directory", ".")
    .description("Print runtime trace events for a skill directory scan")
    .action(async (skillPath: string) => {
      const runtime = new SkillBridgeRuntime([skillPath]);
      await runtime.init();
      process.stdout.write(`${JSON.stringify(runtime.getTrace(), null, 2)}\n`);
    });

  return program;
}

if (process.argv[1]?.endsWith("index.js") || process.argv[1]?.endsWith("index.ts")) {
  await createCliProgram().parseAsync(process.argv);
}
