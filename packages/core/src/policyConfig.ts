import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import type { TrustLevel } from "@skillbridge/policy";
import type { SkillBridgeRuntimePolicyOptions } from "./runtime/SkillBridgeRuntime.js";

export type SkillBridgePolicyConfig = {
  scripts?: {
    enabled?: boolean;
    timeoutMs?: number;
    allow?: string[];
  };
  trust?: {
    minimumTrustForScripts?: TrustLevel;
    default?: TrustLevel;
  };
  resources?: {
    maxFileBytes?: number;
    allow?: string[];
    allowedExtensions?: string[];
    deniedExtensions?: string[];
  };
  network?: {
    enabled?: boolean;
  };
};

export type LoadedSkillBridgePolicyConfig = {
  path?: string;
  config: SkillBridgePolicyConfig;
};

const trustLevelSchema = z.enum(["trusted", "local", "community", "untrusted"]);
const stringListSchema = z.preprocess(
  (value) => {
    if (typeof value === "string") {
      return value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
    }

    return value;
  },
  z.array(z.string().trim().min(1)),
);

const policyConfigSchema = z
  .object({
    scripts: z
      .object({
        enabled: z.boolean().optional(),
        timeoutMs: z.number().finite().positive().optional(),
        allow: stringListSchema.optional(),
      })
      .passthrough()
      .optional(),
    trust: z
      .object({
        minimumTrustForScripts: trustLevelSchema.optional(),
        default: trustLevelSchema.optional(),
      })
      .passthrough()
      .optional(),
    resources: z
      .object({
        maxFileBytes: z.number().finite().positive().optional(),
        allow: stringListSchema.optional(),
        allowedExtensions: stringListSchema.optional(),
        deniedExtensions: stringListSchema.optional(),
      })
      .passthrough()
      .optional(),
    network: z
      .object({
        enabled: z.boolean().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

function parsePolicyYaml(content: string): Record<string, unknown> {
  const parsed = YAML.parse(content);
  if (parsed === null || parsed === undefined) {
    return {};
  }
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("policy.yaml must contain a YAML mapping at the top level.");
  }

  return parsed as Record<string, unknown>;
}

function cleanUndefined<T extends Record<string, unknown>>(record: T): T {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as T;
}

function parsePolicyConfig(rawConfig: Record<string, unknown>): SkillBridgePolicyConfig {
  const parsed = policyConfigSchema.safeParse(rawConfig);
  if (!parsed.success) {
    throw new Error(`Invalid policy.yaml: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
  }

  return {
    scripts: parsed.data.scripts
      ? cleanUndefined({
          enabled: parsed.data.scripts.enabled,
          timeoutMs: parsed.data.scripts.timeoutMs,
          allow: parsed.data.scripts.allow,
        })
      : undefined,
    trust: parsed.data.trust
      ? cleanUndefined({
          minimumTrustForScripts: parsed.data.trust.minimumTrustForScripts,
          default: parsed.data.trust.default,
        })
      : undefined,
    resources: parsed.data.resources
      ? cleanUndefined({
          maxFileBytes: parsed.data.resources.maxFileBytes,
          allow: parsed.data.resources.allow,
          allowedExtensions: parsed.data.resources.allowedExtensions,
          deniedExtensions: parsed.data.resources.deniedExtensions,
        })
      : undefined,
    network: parsed.data.network
      ? cleanUndefined({
          enabled: parsed.data.network.enabled,
        })
      : undefined,
  };
}

export function normalizeSkillBridgePolicyConfig(rawConfig: Record<string, unknown>): SkillBridgePolicyConfig {
  return parsePolicyConfig(rawConfig);
}

export function createRuntimePolicyFromConfig(config: SkillBridgePolicyConfig): SkillBridgeRuntimePolicyOptions {
  return {
    allowlist: {
      scripts: config.scripts?.allow,
    },
    minimumTrustForScripts: config.trust?.minimumTrustForScripts,
    defaultTrustLevel: config.trust?.default,
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

  const rawConfig = parsePolicyYaml(await readFile(policyPath, "utf8"));
  return {
    path: policyPath,
    config: normalizeSkillBridgePolicyConfig(rawConfig),
  };
}
