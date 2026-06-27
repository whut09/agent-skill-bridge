import { buildSkillContext } from "../context/index.js";
import { readSkillBody, scanSkillDirs } from "../parser/index.js";
import { readSkillResource } from "../resources/index.js";
import { routeSkills } from "../router/index.js";
import type {
  LocalScriptExecutorResult,
  ResourceManagerInput,
  ResourceManagerResult,
  SkillBridgePrepareInput,
  SkillBridgePrepareOutput,
  SkillBridgeRuntimeInitResult,
  SkillBridgeRuntimeRunScriptInput,
  SkillManifest,
  RuntimeTraceEvent,
} from "../types.js";
import { executeLocalScript } from "./localScriptExecutor.js";
import { createRuntimeTraceEvent } from "./trace.js";

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

  private traceEvents: RuntimeTraceEvent[] = [];

  constructor(skillDirs: string[]) {
    this.skillDirs = skillDirs;
  }

  private trace(type: string, message: string, metadata?: Record<string, unknown>): void {
    this.traceEvents.push(createRuntimeTraceEvent(type, message, metadata));
  }

  async init(): Promise<SkillBridgeRuntimeInitResult> {
    this.trace("scan_start", "Scanning skill directories.", { skillDirs: this.skillDirs });
    this.skills = await scanSkillDirs(this.skillDirs);
    this.trace("scan_complete", "Skill directory scan complete.", { skillCount: this.skills.length });
    return { skills: this.skills };
  }

  getSkillByName(name: string): SkillManifest | undefined {
    const normalizedName = name.trim().toLowerCase();
    return this.skills.find((skill) => skill.name.trim().toLowerCase() === normalizedName);
  }

  async prepare(input: SkillBridgePrepareInput): Promise<SkillBridgePrepareOutput> {
    this.trace("search_start", "Searching for active skills.", { userMessage: input.userMessage });
    const activationDecision = await routeSkills(input.userMessage, this.skills);
    const activeSkills = activationDecision.candidates;
    const selectedSkill = activationDecision.skill;
    this.trace("skill_selected", selectedSkill ? `Selected skill: ${selectedSkill.name}` : "No skill selected.", {
      skillName: selectedSkill?.name,
      confidence: activationDecision.confidence,
    });
    const selectedSkillBody = selectedSkill ? await readSkillBody(selectedSkill.path) : undefined;
    const context = await buildSkillContext({
      query: input.userMessage,
      skills: this.skills,
      selectedSkill,
      skillBodies: selectedSkill && selectedSkillBody ? { [selectedSkill.path]: selectedSkillBody } : undefined,
      budget: input.budget,
    });
    this.trace("context_built", "Skill context built.", {
      selectedSkillName: selectedSkill?.name,
      systemPatchLength: context.systemPatch.length,
    });

    return {
      ...context,
      activeSkills,
      activationDecision,
      toolInstructions: buildToolInstructions(selectedSkill),
    };
  }

  async readResource(input: ResourceManagerInput): Promise<ResourceManagerResult> {
    const result = await readSkillResource(input);
    this.trace("resource_read", "Skill resource read.", {
      skillPath: input.skillPath,
      resourcePath: input.resourcePath,
      type: result.type,
    });
    return result;
  }

  async runScript(input: SkillBridgeRuntimeRunScriptInput): Promise<LocalScriptExecutorResult> {
    this.trace("script_run_start", "Skill script execution started.", {
      skillName: input.skill.name,
      scriptPath: input.scriptPath,
    });

    try {
      const result = await executeLocalScript({
        skillPath: input.skill.path,
        scriptPath: input.scriptPath,
        enableScripts: input.enableScripts,
        timeoutMs: input.timeoutMs,
        args: input.args,
      });
      this.trace("script_run_complete", "Skill script execution complete.", {
        skillName: input.skill.name,
        scriptPath: input.scriptPath,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
      });
      return result;
    } catch (error) {
      this.trace("script_run_failed", "Skill script execution failed.", {
        skillName: input.skill.name,
        scriptPath: input.scriptPath,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  getTrace(): RuntimeTraceEvent[] {
    return [...this.traceEvents];
  }

  clearTrace(): void {
    this.traceEvents = [];
  }
}
