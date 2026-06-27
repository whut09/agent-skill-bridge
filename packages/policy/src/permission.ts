import path from "node:path";
import type { PermissionSet, PolicyDecision } from "./types.js";

function normalizePath(value: string): string {
  return value.split("\\").join("/").replace(/^\.\/+/, "");
}

function globToRegExp(pattern: string): RegExp {
  const normalizedPattern = normalizePath(pattern);
  const escaped = normalizedPattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, ".*");

  return new RegExp(`^${escaped}$`);
}

function matchesAnyPattern(candidatePath: string, patterns: string[]): boolean {
  const normalizedCandidate = normalizePath(candidatePath);
  return patterns.some((pattern) => {
    const normalizedPattern = normalizePath(pattern);
    return normalizedPattern === normalizedCandidate || globToRegExp(normalizedPattern).test(normalizedCandidate);
  });
}

export function isPathWithin(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function checkReadPermission(
  permissions: PermissionSet | undefined,
  resourcePath: string,
): PolicyDecision {
  if (!permissions?.read || permissions.read.length === 0) {
    return { allowed: true, code: "read.default_allow", reason: "No read permission allowlist declared." };
  }

  if (matchesAnyPattern(resourcePath, permissions.read)) {
    return { allowed: true, code: "read.allowlist_match", reason: "Resource matches permissions.read." };
  }

  return {
    allowed: false,
    code: "read.denied_by_permissions",
    reason: `Resource is not allowed by permissions.read: ${resourcePath}`,
  };
}

export function checkWritePermission(
  permissions: PermissionSet | undefined,
  resourcePath: string,
): PolicyDecision {
  if (!permissions?.write || permissions.write.length === 0) {
    return { allowed: false, code: "write.default_deny", reason: "Write permission is denied unless declared." };
  }

  if (matchesAnyPattern(resourcePath, permissions.write)) {
    return { allowed: true, code: "write.allowlist_match", reason: "Resource matches permissions.write." };
  }

  return {
    allowed: false,
    code: "write.denied_by_permissions",
    reason: `Resource is not allowed by permissions.write: ${resourcePath}`,
  };
}

export function checkNetworkPermission(permissions: PermissionSet | undefined): PolicyDecision {
  if (permissions?.network === true) {
    return { allowed: true, code: "network.allowed", reason: "Network permission is explicitly allowed." };
  }

  return { allowed: false, code: "network.default_deny", reason: "Network permission is denied by default." };
}

export function checkExecutePermission(permissions: PermissionSet | undefined): PolicyDecision {
  if (permissions?.execute === false) {
    return { allowed: false, code: "execute.denied_by_permissions", reason: "Skill explicitly denies execution." };
  }

  return { allowed: true, code: "execute.runtime_gate", reason: "Execution may proceed to runtime enablement checks." };
}
