import { buildSkillContext } from "../context/index.js";
import { readSkillBody, scanSkillDirs } from "../parser/index.js";
import { readSkillResource } from "../resources/index.js";
import { searchSkills } from "../router/index.js";
import type {
  LocalScriptExecutorResult,
  ResourceManagerInput,
  ResourceManagerResult,
  SkillBridgePrepareInput,
  SkillBridgePrepareOutput,
  SkillBridgeRuntimeInitResult,
  SkillBridgeRuntimeRunScriptInput,
  SkillManifest,
} from "../types.js";
import { executeLocalScript } from "./localScriptExecutor.js";

function buildToolInstructions(selectedSkill?: SkillManifest): string {
  const lines = [
    "Tool usage:",
    "- readResource({ skillPath, resourcePath }) reads only files inside a skill directory.",
    "- runScript({ skill, scriptPath, enableScripts: true }) executes scripts inside scripts/ only.",
    "- Scripts are disabled by default and shell execution is never enabled.",
  ];

  if (selectedSkill) {
    lines.push(`- Active skill: ${selectedSkill.name}`);
  }

  return lines.join("\n");
}

export class SkillBridgeRuntime {
  private readonly skillDirs: string[];

  private skills: SkillManifest[] = [];

  constructor(skillDirs: string[]) {
    this.skillDirs = skillDirs;
  }

  async init(): Promise<SkillBridgeRuntimeInitResult> {
    this.skills = await scanSkillDirs(this.skillDirs);
    return { skills: this.skills };
  }

  getSkillByName(name: string): SkillManifest | undefined {
    const normalizedName = name.trim().toLowerCase();
    return this.skills.find((skill) => skill.name.trim().toLowerCase() === normalizedName);
  }

  async prepare(input: SkillBridgePrepareInput): Promise<SkillBridgePrepareOutput> {
    const activeSkills = searchSkills(input.userMessage, this.skills);
    const selectedSkill = activeSkills[0]?.skill;
    const selectedSkillBody = selectedSkill ? await readSkillBody(selectedSkill.path) : undefined;
    const context = await buildSkillContext({
      query: input.userMessage,
      skills: this.skills,
      selectedSkill,
      skillBodies: selectedSkill && selectedSkillBody ? { [selectedSkill.path]: selectedSkillBody } : undefined,
      budget: input.budget,
    });

    return {
      ...context,
      activeSkills,
      toolInstructions: buildToolInstructions(selectedSkill),
    };
  }

  async readResource(input: ResourceManagerInput): Promise<ResourceManagerResult> {
    return readSkillResource(input);
  }

  async runScript(input: SkillBridgeRuntimeRunScriptInput): Promise<LocalScriptExecutorResult> {
    return executeLocalScript({
      skillPath: input.skill.path,
      scriptPath: input.scriptPath,
      enableScripts: input.enableScripts,
      timeoutMs: input.timeoutMs,
      args: input.args,
    });
  }
}
