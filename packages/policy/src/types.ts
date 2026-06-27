export type PermissionSet = {
  read?: string[];
  write?: string[];
  network?: boolean;
  execute?: boolean;
};

export type TrustLevel = "trusted" | "local" | "community" | "untrusted";

export type PolicyDecision = {
  allowed: boolean;
  reason: string;
  code: string;
};

export type AllowlistPolicy = {
  tools?: string[];
  scripts?: string[];
  commands?: string[];
};

export type SkillPolicySubject = {
  name: string;
  path: string;
  permissions?: PermissionSet;
  allowedTools?: string[];
  deniedTools?: string[];
  trustLevel?: TrustLevel;
};

export type AuditEvent = {
  type: string;
  action: string;
  allowed: boolean;
  reason: string;
  timestamp: string;
  skillName?: string;
  metadata?: Record<string, unknown>;
};

export type ScannerFinding = {
  severity: "low" | "medium" | "high";
  category: "prompt_injection" | "dangerous_command" | "external_download" | "metadata_risk";
  message: string;
  match: string;
};
