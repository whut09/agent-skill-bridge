import { buildSkillContext } from "../context/index.js";
import { readSkillBody, scanSkillDirs } from "../parser/index.js";
import { readSkillResource } from "../resources/index.js";
import {
  routeSkillsWithTrace,
  type SkillCandidateFilter,
  type SkillReranker,
  type SkillRouter,
} from "../router/index.js";
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
import { randomUUID } from "node:crypto";
import path from "node:path";
import type {
  ActivationDecision,
  LocalScriptExecutorResult,
  ResourceManagerInput,
  ResourceManagerResult,
  SkillBridgeRuntimeRunScriptByNameOptions,
  SkillBridgePrepareInput,
  SkillBridgePrepareOutput,
  SkillBridgeRuntimeInitResult,
  SkillBridgeRuntimeRunScriptInput,
  SkillContext,
  SkillDiscoveryResult,
  SkillManifest,
  SkillResourceListing,
  RuntimeTraceEvent,
  RuntimeTraceRecord,
  RuntimeTraceCandidate,
  SkillSearchResult,
} from "../types.js";
import { executeLocalScript } from "./localScriptExecutor.js";
import { createRuntimeTraceEvent } from "./trace.js";

export type SkillBridgeRuntimePolicyOptions = {
  allowlist?: AllowlistPolicy;
  minimumTrustForScripts?: TrustLevel;
  resources?: {
    maxFileBytes?: number;
  };
  scripts?: {
    enabled?: boolean;
    timeoutMs?: number;
  };
  network?: {
    enabled?: boolean;
  };
};

export type SkillBridgeRuntimeRoutingOptions = {
  router?: SkillRouter;
  policyFilter?: SkillCandidateFilter;
  reranker?: SkillReranker;
  topK?: number;
  minScore?: number;
};

export type SkillBridgeRuntimeOptions = {
  policy?: SkillBridgeRuntimePolicyOptions;
  routing?: SkillBridgeRuntimeRoutingOptions;
};

function estimateTokens(value: string | undefined): number {
  if (!value) {
    return 0;
  }

  return Math.ceil(value.length / 4);
}

function buildToolInstructions(selectedSkill?: SkillManifest): string {
  const lines = [
    "Tool usage:",
    "- SkillBridge uses progressive loading: reference files, scripts, and assets are not loaded into the prompt by default.",
    "- readResource(skillId, resourcePath) reads only files inside an activated skill directory when the task needs them.",
    "- runScript(skillId, scriptPath, { enableScripts: true }) executes scripts inside scripts/ only.",
    "- Scripts are disabled by default and shell execution is never enabled.",
  ];

  if (selectedSkill) {
    lines.push(`- Active skill: ${selectedSkill.name}`);
  }

  return lines.join("\n");
}

function createSkillId(skill: SkillManifest): string {
  return skill.id;
}

function inferNextActions(selectedSkill?: SkillManifest): Array<"readResource" | "runScript" | "askUser" | "none"> {
  if (!selectedSkill) {
    return ["none"];
  }

  const actions: Array<"readResource" | "runScript" | "askUser" | "none"> = [];
  if (selectedSkill.references.length > 0 || selectedSkill.assets.length > 0) {
    actions.push("readResource");
  }
  if (selectedSkill.scripts.length > 0) {
    actions.push("runScript");
  }

  return actions.length > 0 ? actions : ["none"];
}

export class SkillBridgeRuntime {
  private readonly skillDirs: string[];

  private readonly policy: SkillBridgeRuntimePolicyOptions;

  private readonly routing: SkillBridgeRuntimeRoutingOptions;

  private skills: SkillManifest[] = [];

  private traceEvents: RuntimeTraceEvent[] = [];

  private traceRecord: RuntimeTraceRecord = this.createTraceRecord("");

  constructor(
    skillDirs: string[],
    policyOrOptions: SkillBridgeRuntimePolicyOptions | SkillBridgeRuntimeOptions = {},
    routing: SkillBridgeRuntimeRoutingOptions = {},
  ) {
    this.skillDirs = skillDirs;
    const options = policyOrOptions as SkillBridgeRuntimeOptions;
    if (options.policy !== undefined || options.routing !== undefined) {
      this.policy = options.policy ?? {};
      this.routing = options.routing ?? {};
    } else {
      this.policy = policyOrOptions as SkillBridgeRuntimePolicyOptions;
      this.routing = routing;
    }
  }

  private trace(type: string, message: string, metadata?: Record<string, unknown>): void {
    const event = createRuntimeTraceEvent(type, message, metadata);
    this.traceEvents.push(event);
    this.traceRecord.events.push(event);
  }

  private createTraceRecord(userMessage: string): RuntimeTraceRecord {
    return {
      runId: `run_${randomUUID()}`,
      userMessage,
      candidates: [],
      retrieved: [],
      policyFiltered: [],
      reranked: [],
      context: {
        catalogTokens: 0,
        skillTokens: 0,
        resourceTokens: 0,
      },
      tools: [],
      scripts: [],
      events: [],
    };
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

  getSkillById(id: string): SkillManifest | undefined {
    const normalizedId = id.trim().toLowerCase();
    return this.skills.find((skill) => skill.id.trim().toLowerCase() === normalizedId);
  }

  listSkills(): SkillDiscoveryResult[] {
    return this.skills.map((skill) => ({
      id: createSkillId(skill),
      name: skill.name,
      description: skill.description,
      keywords: skill.metadata?.keywords ?? [],
      capabilities: {
        resources: skill.references.length > 0 || skill.assets.length > 0,
        scripts: skill.scripts.length > 0,
        assets: skill.assets.length > 0,
        allowedTools: skill.allowedTools ?? [],
      },
    }));
  }

  async activateSkill(query: string, options: { budget?: number } = {}): Promise<ActivationDecision> {
    const { activationDecision } = await this.activateWithContext(query, options.budget);
    return activationDecision;
  }

  listResources(skillId: string): SkillResourceListing {
    const skill = this.requireSkillByIdOrName(skillId);
    return {
      skillId: skill.id,
      skillName: skill.name,
      references: [...skill.references],
      scripts: [...skill.scripts],
      assets: [...skill.assets],
    };
  }

  async prepare(input: SkillBridgePrepareInput): Promise<SkillBridgePrepareOutput> {
    const { activationDecision, context, activeSkills, selectedSkill } = await this.activateWithContext(
      input.userMessage,
      input.budget,
    );

    return {
      ...context,
      activeSkills,
      activationDecision,
      toolInstructions: buildToolInstructions(selectedSkill),
    };
  }

  private async activateWithContext(
    query: string,
    budget?: number,
  ): Promise<{
    activationDecision: ActivationDecision;
    context: SkillContext;
    activeSkills: ActivationDecision["candidates"];
    selectedSkill?: SkillManifest;
  }> {
    this.traceRecord = this.createTraceRecord(query);
    this.traceRecord.events = [...this.traceEvents];
    this.trace("search_start", "Searching for active skills.", { userMessage: query });
    const routeResult = await routeSkillsWithTrace(
      query,
      this.skills,
      {
        topK: this.routing.topK,
        minScore: this.routing.minScore,
      },
      {
        router: this.routing.router,
        policyFilter: this.routing.policyFilter,
        reranker: this.routing.reranker,
      },
    );
    const routedDecision = routeResult.decision;
    const activeSkills = routedDecision.candidates;
    const selectedSkill = routedDecision.skill;
    this.traceRecord.selectedSkill = selectedSkill?.name;
    this.traceRecord.candidates = activeSkills.map((result) => this.toTraceCandidate(result));
    this.traceRecord.retrieved = routeResult.trace.retrieved.map((result) => this.toTraceCandidate(result));
    this.traceRecord.policyFiltered = routeResult.trace.policyFiltered.map((result) => this.toTraceCandidate(result));
    this.traceRecord.reranked = routeResult.trace.reranked.map((result) => this.toTraceCandidate(result));
    this.trace("skill_selected", selectedSkill ? `Selected skill: ${selectedSkill.name}` : "No skill selected.", {
      skillName: selectedSkill?.name,
      confidence: routedDecision.confidence,
    });
    const selectedSkillBody = selectedSkill ? await readSkillBody(selectedSkill.path) : undefined;
    const context = await buildSkillContext({
      query,
      skills: this.skills,
      selectedSkill,
      skillBodies: selectedSkill && selectedSkillBody ? { [selectedSkill.path]: selectedSkillBody } : undefined,
      budget,
    });
    this.trace("context_built", "Skill context built.", {
      selectedSkillName: selectedSkill?.name,
      systemPatchLength: context.systemPatch.length,
    });
    this.traceRecord.context = {
      catalogTokens: estimateTokens(context.catalog),
      skillTokens: estimateTokens(context.selectedSkill?.body),
      resourceTokens: 0,
    };

    const activationDecision: ActivationDecision = {
      ...routedDecision,
      runId: this.traceRecord.runId,
      query,
      selectedSkill: selectedSkill
        ? {
            id: selectedSkill.id,
            name: selectedSkill.name,
          }
        : undefined,
      systemPatch: context.systemPatch,
      allowedTools: selectedSkill?.allowedTools ?? routedDecision.allowedTools,
      nextActions: inferNextActions(selectedSkill),
    };

    return {
      activationDecision,
      context,
      activeSkills,
      selectedSkill,
    };
  }

  async readResource(input: ResourceManagerInput): Promise<ResourceManagerResult>;
  async readResource(skillName: string, resourcePath: string): Promise<ResourceManagerResult>;
  async readResource(
    inputOrSkillName: ResourceManagerInput | string,
    resourcePath?: string,
  ): Promise<ResourceManagerResult> {
    let input: ResourceManagerInput;
    if (typeof inputOrSkillName === "string") {
      if (!resourcePath) {
        throw new Error("resourcePath is required when reading by skill name.");
      }
      input = {
        skillPath: this.requireSkillByIdOrName(inputOrSkillName).path,
        resourcePath,
      };
    } else {
      input = inputOrSkillName;
    }

    const skill = this.findSkillByPath(input.skillPath);
    if (skill) {
      const decisions = [
        checkToolAllowed(skill, "readResource"),
        checkReadPermission(skill.permissions, input.resourcePath),
      ];
      this.recordToolDecision("readResource", input.resourcePath, decisions);
      this.enforcePolicy("read_resource", skill, decisions, {
        resourcePath: input.resourcePath,
      });
    } else {
      this.traceRecord.tools.push({
        name: "readResource",
        path: input.resourcePath,
        allowed: true,
        reason: "Allowed by resource path boundary.",
      });
    }

    const result = await readSkillResource({
      ...input,
      maxFileBytes: input.maxFileBytes ?? this.policy.resources?.maxFileBytes,
    });
    this.trace("resource_read", "Skill resource read.", {
      skillPath: input.skillPath,
      resourcePath: input.resourcePath,
      type: result.type,
    });
    this.traceRecord.context.resourceTokens += result.type === "text" ? estimateTokens(result.content) : 0;
    return result;
  }

  async runScript(input: SkillBridgeRuntimeRunScriptInput): Promise<LocalScriptExecutorResult>;
  async runScript(
    skillName: string,
    scriptPath: string,
    options?: SkillBridgeRuntimeRunScriptByNameOptions,
  ): Promise<LocalScriptExecutorResult>;
  async runScript(
    inputOrSkillName: SkillBridgeRuntimeRunScriptInput | string,
    scriptPath?: string,
    options: SkillBridgeRuntimeRunScriptByNameOptions = {},
  ): Promise<LocalScriptExecutorResult> {
    let input: SkillBridgeRuntimeRunScriptInput;
    if (typeof inputOrSkillName === "string") {
      if (!scriptPath) {
        throw new Error("scriptPath is required when running by skill name.");
      }
      input = {
        ...options,
        skill: this.requireSkillByIdOrName(inputOrSkillName),
        scriptPath,
      };
    } else {
      input = inputOrSkillName;
    }

    this.trace("script_run_start", "Skill script execution started.", {
      skillName: input.skill.name,
      scriptPath: input.scriptPath,
    });

    try {
      const decisions = [
        checkToolAllowed(input.skill, "runScript"),
        checkExecutePermission(input.skill.permissions),
        checkTrustLevel(
          normalizeTrustLevel(input.skill.rawFrontmatter?.trust ?? input.skill.frontmatter.trust),
          this.policy.minimumTrustForScripts ?? "local",
        ),
        checkScriptAllowed(this.policy.allowlist, input.scriptPath),
      ];
      this.recordScriptDecision(input.scriptPath, decisions);
      this.enforcePolicy("run_script", input.skill, decisions, {
        scriptPath: input.scriptPath,
      });

      const result = await executeLocalScript({
        skillPath: input.skill.path,
        scriptPath: input.scriptPath,
        enableScripts: input.enableScripts ?? this.policy.scripts?.enabled,
        timeoutMs: input.timeoutMs ?? this.policy.scripts?.timeoutMs,
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
      this.recordScriptFailure(input.scriptPath, error instanceof Error ? error.message : String(error));
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

  getTraceRecord(): RuntimeTraceRecord {
    return {
      ...this.traceRecord,
      candidates: [...this.traceRecord.candidates],
      retrieved: [...this.traceRecord.retrieved],
      policyFiltered: [...this.traceRecord.policyFiltered],
      reranked: [...this.traceRecord.reranked],
      context: { ...this.traceRecord.context },
      tools: [...this.traceRecord.tools],
      scripts: [...this.traceRecord.scripts],
      events: [...this.traceRecord.events],
    };
  }

  clearTrace(): void {
    this.traceEvents = [];
    this.traceRecord = this.createTraceRecord("");
  }

  private recordToolDecision(name: string, resourcePath: string, decisions: PolicyDecision[]): void {
    const deniedDecision = decisions.find((decision) => !decision.allowed);
    this.traceRecord.tools.push({
      name,
      path: resourcePath,
      allowed: !deniedDecision,
      reason: deniedDecision?.reason ?? "Allowed by runtime policy.",
    });
  }

  private toTraceCandidate(result: SkillSearchResult): RuntimeTraceCandidate {
    return {
      skillId: result.skill.id,
      name: result.skill.name,
      score: result.score,
      reason: result.reason.join("; "),
    };
  }

  private recordScriptDecision(scriptPath: string, decisions: PolicyDecision[]): void {
    const deniedDecision = decisions.find((decision) => !decision.allowed);
    this.traceRecord.scripts.push({
      path: scriptPath,
      allowed: !deniedDecision,
      reason: deniedDecision?.reason ?? "Allowed by runtime policy.",
    });
  }

  private recordScriptFailure(scriptPath: string, reason: string): void {
    const existing = this.traceRecord.scripts.find((entry) => entry.path === scriptPath);
    if (existing) {
      existing.allowed = false;
      existing.reason = reason;
      return;
    }

    this.traceRecord.scripts.push({
      path: scriptPath,
      allowed: false,
      reason,
    });
  }

  private findSkillByPath(skillPath: string): SkillManifest | undefined {
    const normalizedSkillPath = path.resolve(skillPath);
    return this.skills.find((skill) => path.resolve(skill.path) === normalizedSkillPath);
  }

  private requireSkillByIdOrName(idOrName: string): SkillManifest {
    const skill = this.getSkillById(idOrName) ?? this.getSkillByName(idOrName);
    if (!skill) {
      throw new Error(`Skill not found by id or name: ${idOrName}`);
    }

    return skill;
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
        this.recordPolicyScanFindings(skill, scanSkillText(`${frontmatterText}\n${body}`));

        await Promise.all(
          skill.scripts.map(async (scriptPath) => {
            const resource = await readSkillResource({ skillPath: skill.path, resourcePath: scriptPath });
            if (resource.type === "text") {
              this.recordPolicyScanFindings(skill, scanSkillText(resource.content), scriptPath);
            }
          }),
        );
      }),
    );
  }

  private recordPolicyScanFindings(
    skill: SkillManifest,
    findings: ReturnType<typeof scanSkillText>,
    resourcePath?: string,
  ): void {
    for (const finding of findings) {
      this.trace("policy_scan_finding", finding.message, {
        skillName: skill.name,
        resourcePath,
        severity: finding.severity,
        category: finding.category,
        match: finding.match,
      });
    }
  }
}
