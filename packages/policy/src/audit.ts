import type { AuditEvent, PolicyDecision } from "./types.js";

export function createAuditEvent(input: {
  action: string;
  decision: PolicyDecision;
  skillName?: string;
  metadata?: Record<string, unknown>;
}): AuditEvent {
  return {
    type: "policy_audit",
    action: input.action,
    allowed: input.decision.allowed,
    reason: input.decision.reason,
    timestamp: new Date().toISOString(),
    skillName: input.skillName,
    metadata: {
      code: input.decision.code,
      ...input.metadata,
    },
  };
}
