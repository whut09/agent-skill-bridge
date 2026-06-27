import { buildSkillContext } from "../context/index.js";
import { readSkillBody, scanSkillDirs } from "../parser/index.js";
import { readSkillResource } from "../resources/index.js";
import { routeSkills } from "../router/index.js";
import {
  checkExecutePermission,
  checkReadPermission,
  checkScriptAllowed,
  checkToolAllowed,
  checkTrustLevel,
  createAuditEvent,
  normalizeTrustLevel,
  scanSkillText,
  type AllowlistPolicy,
  type PolicyDecision,
  type TrustLevel,
} from "@skillbridge/policy";
import path from "node:path";
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

export type SkillBridgeRuntimePolicyOptions = {
  allowlist?: AllowlistPolicy;
  minimumTrustForScripts?: TrustLevel;
};

function buildToolInstructions(selectedSkill?: SkillManifest): string {
  const lines = [
    "Tool usage:",
    "- SkillBridge uses progressive loading: reference files, scripts, and assets are not loaded into the prompt by default.",
    "- readResource({ skillName, resourcePath }) reads only files inside an activated skill directory when the task needs them.",
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

  private readonly policy: SkillBridgeRuntimePolicyOptions;

  private skills: SkillManifest[] = [];

  private traceEvents: RuntimeTraceEvent[] = [];

  constructor(skillDirs: string[], policy: SkillBridgeRuntimePolicyOptions = {}) {
    this.skillDirs = skillDirs;
    this.policy = policy;
  }

  private trace(type: string, message: string, metadata?: Record<string, unknown>): void {
    this.traceEvents.push(createRuntimeTraceEvent(type, message, metadata));
  }

  async init(): Promise<SkillBridgeRuntimeInitResult> {
    this.trace("scan_start", "Scanning skill directories.", { skillDirs: this.skillDirs });
    this.skills = await scanSkillDirs(this.skillDirs);
    await this.scanSkillPolicyRisks();
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
    const skill = this.findSkillByPath(input.skillPath);
    if (skill) {
      this.enforcePolicy("read_resource", skill, [
        checkToolAllowed(skill, "readResource"),
        checkReadPermission(skill.permissions, input.resourcePath),
      ], {
        resourcePath: input.resourcePath,
      });
    }

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
      this.enforcePolicy("run_script", input.skill, [
        checkToolAllowed(input.skill, "runScript"),
        checkExecutePermission(input.skill.permissions),
        checkTrustLevel(
          normalizeTrustLevel(input.skill.rawFrontmatter?.trust ?? input.skill.frontmatter.trust),
          this.policy.minimumTrustForScripts ?? "local",
        ),
        checkScriptAllowed(this.policy.allowlist, input.scriptPath),
      ], {
        scriptPath: input.scriptPath,
      });

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

  private findSkillByPath(skillPath: string): SkillManifest | undefined {
    const normalizedSkillPath = path.resolve(skillPath);
    return this.skills.find((skill) => path.resolve(skill.path) === normalizedSkillPath);
  }

  private enforcePolicy(
    action: string,
    skill: SkillManifest,
    decisions: PolicyDecision[],
    metadata?: Record<string, unknown>,
  ): void {
    for (const decision of decisions) {
      const auditEvent = createAuditEvent({
        action,
        skillName: skill.name,
        decision,
        metadata,
      });
      this.trace("policy_audit", auditEvent.reason, {
        action: auditEvent.action,
        allowed: auditEvent.allowed,
        skillName: auditEvent.skillName,
        ...auditEvent.metadata,
      });

      if (!decision.allowed) {
        throw new Error(`Policy denied ${action}: ${decision.reason}`);
      }
    }
  }

  private async scanSkillPolicyRisks(): Promise<void> {
    await Promise.all(
      this.skills.map(async (skill) => {
        const body = await readSkillBody(skill.path);
        const frontmatterText = JSON.stringify(skill.rawFrontmatter ?? skill.frontmatter);
        const findings = scanSkillText(`${frontmatterText}\n${body}`);
        for (const finding of findings) {
          this.trace("policy_scan_finding", finding.message, {
            skillName: skill.name,
            severity: finding.severity,
            category: finding.category,
            match: finding.match,
          });
        }
      }),
    );
  }
}
