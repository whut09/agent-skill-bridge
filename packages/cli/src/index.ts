#!/usr/bin/env node

import { Command } from "commander";

const program = new Command();

program.name("skillbridge").description("SkillBridge Runtime CLI").version("0.1.0");

program
  .command("doctor")
  .description("Inspect the local runtime setup")
  .action(() => {
    process.stdout.write("SkillBridge Runtime CLI is installed.\n");
  });

program
  .command("scan")
  .argument("[path]", "path to a skill directory", ".")
  .description("Scan a skill directory")
  .action((skillPath: string) => {
    process.stdout.write(`Scanning skills under ${skillPath}\n`);
  });

program.parse(process.argv);
