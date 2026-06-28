import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { TrustLevel } from "@skillbridge/policy";
import type { SkillBridgeRuntimePolicyOptions } from "./runtime/SkillBridgeRuntime.js";

export type SkillBridgePolicyConfig = {
  scripts?: {
    enabled?: boolean;
    timeoutMs?: number;
  };
  trust?: {
    minimumTrustForScripts?: TrustLevel;
  };
  resources?: {
    maxFileBytes?: number;
  };
  network?: {
    enabled?: boolean;
  };
};

export type LoadedSkillBridgePolicyConfig = {
  path?: string;
  config: SkillBridgePolicyConfig;
};

function parseScalar(value: string): string | number | boolean {
  const normalizedValue = value.trim();
  if (normalizedValue === "true") {
    return true;
  }
  if (normalizedValue === "false") {
    return false;
  }
  if (/^-?\d+(?:\.\d+)?$/u.test(normalizedValue)) {
    return Number(normalizedValue);
  }

  return normalizedValue.replace(/^["']|["']$/gu, "");
}

function assignNestedValue(target: Record<string, unknown>, pathSegments: string[], value: unknown): void {
  let current = target;
  for (const segment of pathSegments.slice(0, -1)) {
    const existingValue = current[segment];
    if (!existingValue || typeof existingValue !== "object" || Array.isArray(existingValue)) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }

  current[pathSegments[pathSegments.length - 1]] = value;
}

function parseSimpleYaml(content: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  const stack: Array<{ indent: number; segments: string[] }> = [{ indent: -1, segments: [] }];

  for (const rawLine of content.split(/\r?\n/u)) {
    const commentIndex = rawLine.indexOf("#");
    const line = (commentIndex === -1 ? rawLine : rawLine.slice(0, commentIndex)).replace(/\s+$/u, "");
    if (!line.trim()) {
      continue;
    }

    const indent = line.length - line.trimStart().length;
    const trimmedLine = line.trim();
    const match = /^(?<key>[A-Za-z0-9_.-]+):(?:\s*(?<value>.*))?$/u.exec(trimmedLine);
    if (!match?.groups) {
      throw new Error(`Unsupported policy.yaml syntax: ${trimmedLine}`);
    }

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const key = match.groups.key;
    const rawValue = match.groups.value ?? "";
    const segments = [...stack[stack.length - 1].segments, key];
    if (rawValue === "") {
      assignNestedValue(root, segments, {});
      stack.push({ indent, segments });
    } else {
      assignNestedValue(root, segments, parseScalar(rawValue));
    }
  }

  return root;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readRecord(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readTrustLevel(record: Record<string, unknown>, key: string): TrustLevel | undefined {
  const value = record[key];
  if (value === "trusted" || value === "local" || value === "community" || value === "untrusted") {
    return value;
  }

  return undefined;
}

export function normalizeSkillBridgePolicyConfig(rawConfig: Record<string, unknown>): SkillBridgePolicyConfig {
  const scripts = readRecord(rawConfig, "scripts");
  const trust = readRecord(rawConfig, "trust");
  const resources = readRecord(rawConfig, "resources");
  const network = readRecord(rawConfig, "network");

  return {
    scripts: {
      enabled: readBoolean(scripts, "enabled"),
      timeoutMs: readNumber(scripts, "timeoutMs"),
    },
    trust: {
      minimumTrustForScripts: readTrustLevel(trust, "minimumTrustForScripts"),
    },
    resources: {
      maxFileBytes: readNumber(resources, "maxFileBytes"),
    },
    network: {
      enabled: readBoolean(network, "enabled"),
    },
  };
}

export function createRuntimePolicyFromConfig(config: SkillBridgePolicyConfig): SkillBridgeRuntimePolicyOptions {
  return {
    minimumTrustForScripts: config.trust?.minimumTrustForScripts,
    scripts: config.scripts,
    resources: config.resources,
    network: config.network,
  };
}

function findPolicyFile(startDirectory: string): string | undefined {
  let currentDirectory = path.resolve(startDirectory);
  while (true) {
    const candidate = path.join(currentDirectory, ".skillbridge", "policy.yaml");
    if (existsSync(candidate)) {
      return candidate;
    }

    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      return undefined;
    }
    currentDirectory = parentDirectory;
  }
}

export async function loadSkillBridgePolicy(
  startDirectories: string[] = [process.cwd()],
): Promise<LoadedSkillBridgePolicyConfig> {
  const policyPath = startDirectories.map(findPolicyFile).find((candidate): candidate is string => Boolean(candidate));
  if (!policyPath) {
    return { config: {} };
  }

  const rawConfig = parseSimpleYaml(await readFile(policyPath, "utf8"));
  return {
    path: policyPath,
    config: normalizeSkillBridgePolicyConfig(rawConfig),
  };
}
