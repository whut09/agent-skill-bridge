import type { AllowlistPolicy, PolicyDecision, SkillPolicySubject } from "./types.js";

function includesValue(values: string[] | undefined, value: string): boolean {
  return values?.includes(value) ?? false;
}

export function checkToolAllowed(skill: SkillPolicySubject, toolName: string): PolicyDecision {
  if (includesValue(skill.deniedTools, toolName)) {
    return { allowed: false, code: "tool.denied", reason: `Tool is denied by skill metadata: ${toolName}` };
  }

  if (skill.allowedTools && skill.allowedTools.length > 0 && !includesValue(skill.allowedTools, toolName)) {
    return { allowed: false, code: "tool.not_allowed", reason: `Tool is not in allowedTools: ${toolName}` };
  }

  return { allowed: true, code: "tool.allowed", reason: "Tool is allowed by skill metadata." };
}

export function checkScriptAllowed(policy: AllowlistPolicy | undefined, scriptPath: string): PolicyDecision {
  if (!policy?.scripts || policy.scripts.length === 0) {
    return { allowed: true, code: "script.default_allow", reason: "No script allowlist configured." };
  }

  if (policy.scripts.includes(scriptPath)) {
    return { allowed: true, code: "script.allowlist_match", reason: "Script is allowed by policy." };
  }

  return { allowed: false, code: "script.not_allowed", reason: `Script is not in policy allowlist: ${scriptPath}` };
}
