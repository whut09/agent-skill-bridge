import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { createHash } from "node:crypto";
import type { SkillManifest } from "../types.js";

export type ScanSkillDirsOptions = {
  ignoreDirs?: string[];
  maxDepth?: number;
  maxSkills?: number;
};

type RawSkillFrontmatter = {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  packageName?: unknown;
  "package-name"?: unknown;
  package?: unknown;
  version?: unknown;
  license?: unknown;
  author?: unknown;
  compatibility?: unknown;
  allowedTools?: unknown;
  "allowed-tools"?: unknown;
  deniedTools?: unknown;
  "denied-tools"?: unknown;
  permissions?: unknown;
  entrypoints?: unknown;
  metadata?: unknown;
};

const DEFAULT_IGNORE_DIRS = ["node_modules", ".git", "dist", "build", "coverage", ".next", ".turbo"];

async function pathExists(candidatePath: string): Promise<boolean> {
  try {
    await fs.access(candidatePath);
    return true;
  } catch {
    return false;
  }
}

function normalizePathPattern(value: string): string {
  return value
    .split("\\")
    .join("/")
    .replace(/^\/+|\/+$/g, "");
}

function createIgnoredDirectorySet(ignoreDirs: string[] | undefined): Set<string> {
  return new Set([...DEFAULT_IGNORE_DIRS, ...(ignoreDirs ?? [])].map((entry) => normalizePathPattern(entry)));
}

function shouldIgnoreDirectory(
  rootDirectory: string,
  directoryPath: string,
  directoryName: string,
  ignoredDirectories: Set<string>,
): boolean {
  const relativePath = normalizePathPattern(path.relative(rootDirectory, directoryPath));
  return ignoredDirectories.has(directoryName) || ignoredDirectories.has(relativePath);
}

async function walkSkillDirectories(
  rootDirectory: string,
  options: ScanSkillDirsOptions,
  ignoredDirectories: Set<string>,
  currentDirectory = rootDirectory,
  currentDepth = 0,
  skillFiles: string[] = [],
): Promise<string[]> {
  if (options.maxSkills !== undefined && skillFiles.length >= options.maxSkills) {
    return skillFiles;
  }

  const entries = await fs.readdir(currentDirectory, { withFileTypes: true });

  for (const entry of entries) {
    if (options.maxSkills !== undefined && skillFiles.length >= options.maxSkills) {
      break;
    }

    const entryPath = path.join(currentDirectory, entry.name);

    if (entry.isDirectory()) {
      const nextDepth = currentDepth + 1;
      if (
        (options.maxDepth !== undefined && nextDepth > options.maxDepth) ||
        shouldIgnoreDirectory(rootDirectory, entryPath, entry.name, ignoredDirectories)
      ) {
        continue;
      }

      await walkSkillDirectories(rootDirectory, options, ignoredDirectories, entryPath, nextDepth, skillFiles);
      continue;
    }

    if (entry.isFile() && entry.name === "SKILL.md") {
      skillFiles.push(entryPath);
    }
  }

  return skillFiles;
}

async function listFilesRecursively(rootDirectory: string): Promise<string[]> {
  const discoveredFiles: string[] = [];
  const entries = await fs.readdir(rootDirectory, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(rootDirectory, entry.name);

    if (entry.isDirectory()) {
      discoveredFiles.push(...(await listFilesRecursively(entryPath)));
      continue;
    }

    if (entry.isFile()) {
      discoveredFiles.push(entryPath);
    }
  }

  return discoveredFiles;
}

function toRelativeSkillPath(skillRoot: string, absolutePath: string): string {
  return path.relative(skillRoot, absolutePath).split(path.sep).join("/");
}

async function collectDirectoryFiles(skillDirectory: string, directoryName: string): Promise<string[]> {
  const directoryPath = path.join(skillDirectory, directoryName);

  if (!(await pathExists(directoryPath))) {
    return [];
  }

  const files = await listFilesRecursively(directoryPath);
  return files.map((filePath) => toRelativeSkillPath(skillDirectory, filePath));
}

export async function readSkillBody(skillPath: string): Promise<string> {
  const skillContent = await fs.readFile(path.join(skillPath, "SKILL.md"), "utf8");
  return matter(skillContent).content;
}

function readRequiredString(
  frontmatter: RawSkillFrontmatter,
  fieldName: "name" | "description",
  skillFilePath: string,
): string {
  const value = frontmatter[fieldName];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing required frontmatter field "${fieldName}" in ${skillFilePath}`);
  }

  return value;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function readOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readStringList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const values = value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "");
    return values.length > 0 ? values : undefined;
  }

  if (typeof value === "string") {
    const values = value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    return values.length > 0 ? values : undefined;
  }

  return undefined;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function readRecordValue(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      return record[key];
    }
  }

  return undefined;
}

function readFrontmatterValue(frontmatter: RawSkillFrontmatter, keys: string[]): unknown {
  return readRecordValue(frontmatter as Record<string, unknown>, keys);
}

function readCompatibility(value: unknown): SkillManifest["compatibility"] {
  const record = readRecord(value);
  if (!record) {
    return undefined;
  }

  const compatibility = {
    agents: readStringList(readRecordValue(record, ["agents", "agent"])),
    runtimes: readStringList(readRecordValue(record, ["runtimes", "runtime"])),
    models: readStringList(readRecordValue(record, ["models", "model"])),
  };

  return Object.values(compatibility).some((entry) => entry !== undefined) ? compatibility : undefined;
}

function readPermissions(value: unknown): SkillManifest["permissions"] {
  const record = readRecord(value);
  if (!record) {
    return undefined;
  }

  const permissions = {
    read: readStringList(record.read),
    write: readStringList(record.write),
    network: readOptionalBoolean(record.network),
    execute: readOptionalBoolean(record.execute),
  };

  return Object.values(permissions).some((entry) => entry !== undefined) ? permissions : undefined;
}

function readStringRecord(value: unknown): Record<string, string> | undefined {
  const record = readRecord(value);
  if (!record) {
    return undefined;
  }

  const entries = Object.entries(record).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function readEntrypoints(value: unknown): SkillManifest["entrypoints"] {
  const record = readRecord(value);
  if (!record) {
    return undefined;
  }

  const entrypoints = {
    default: readOptionalString(record.default),
    tools: readStringRecord(record.tools),
  };

  return Object.values(entrypoints).some((entry) => entry !== undefined) ? entrypoints : undefined;
}

function readMetadata(frontmatter: RawSkillFrontmatter): SkillManifest["metadata"] {
  const metadata = readRecord(frontmatter.metadata);
  if (!metadata) {
    return undefined;
  }

  const parsedMetadata = {
    keywords: readStringList(metadata.keywords),
    domains: readStringList(metadata.domains),
    taskTypes: readStringList(readRecordValue(metadata, ["taskTypes", "task-types", "tasks"])),
  };

  return Object.values(parsedMetadata).some((entry) => entry !== undefined) ? parsedMetadata : undefined;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

function createPathHashId(skillDirectory: string): string {
  const normalizedPath = path.resolve(skillDirectory).split(path.sep).join("/");
  return `skill-${createHash("sha256").update(normalizedPath).digest("hex").slice(0, 12)}`;
}

function createSkillId(frontmatter: RawSkillFrontmatter, name: string, skillDirectory: string): string {
  const explicitId = readOptionalString(frontmatter.id);
  if (explicitId) {
    return explicitId;
  }

  const packageName = readOptionalString(readFrontmatterValue(frontmatter, ["packageName", "package-name", "package"]));
  if (packageName) {
    return `${slugify(packageName)}/${slugify(name)}`;
  }

  return createPathHashId(skillDirectory);
}

export async function parseSkillDir(skillDirectory: string): Promise<SkillManifest> {
  const skillFilePath = path.join(skillDirectory, "SKILL.md");
  const skillContent = await fs.readFile(skillFilePath, "utf8");
  const parsed = matter(skillContent);
  const frontmatter = parsed.data as RawSkillFrontmatter;
  const name = readRequiredString(frontmatter, "name", skillFilePath);
  const description = readRequiredString(frontmatter, "description", skillFilePath);
  const metadata = readMetadata(frontmatter);
  const packageName = readOptionalString(readFrontmatterValue(frontmatter, ["packageName", "package-name", "package"]));

  return {
    id: createSkillId(frontmatter, name, skillDirectory),
    name,
    description,
    packageName,
    version: readOptionalString(frontmatter.version),
    license: readOptionalString(frontmatter.license),
    author: readOptionalString(frontmatter.author),
    compatibility: readCompatibility(frontmatter.compatibility),
    allowedTools: readStringList(readFrontmatterValue(frontmatter, ["allowedTools", "allowed-tools"])),
    deniedTools: readStringList(readFrontmatterValue(frontmatter, ["deniedTools", "denied-tools"])),
    permissions: readPermissions(frontmatter.permissions),
    entrypoints: readEntrypoints(frontmatter.entrypoints),
    path: skillDirectory,
    frontmatter: parsed.data as Record<string, unknown>,
    rawFrontmatter: parsed.data as Record<string, unknown>,
    metadata,
    references: await collectDirectoryFiles(skillDirectory, "references"),
    scripts: await collectDirectoryFiles(skillDirectory, "scripts"),
    assets: await collectDirectoryFiles(skillDirectory, "assets"),
  };
}

export async function scanSkillDirs(skillDirs: string[], options: ScanSkillDirsOptions = {}): Promise<SkillManifest[]> {
  const manifests: SkillManifest[] = [];
  const ignoredDirectories = createIgnoredDirectorySet(options.ignoreDirs);

  for (const skillDir of skillDirs) {
    if (options.maxSkills !== undefined && manifests.length >= options.maxSkills) {
      break;
    }

    const rootStat = await fs.stat(skillDir);
    if (!rootStat.isDirectory()) {
      continue;
    }

    const skillFiles = await walkSkillDirectories(
      skillDir,
      {
        ...options,
        maxSkills: options.maxSkills === undefined ? undefined : options.maxSkills - manifests.length,
      },
      ignoredDirectories,
    );

    for (const skillFilePath of skillFiles) {
      if (options.maxSkills !== undefined && manifests.length >= options.maxSkills) {
        break;
      }

      manifests.push(await parseSkillDir(path.dirname(skillFilePath)));
    }
  }

  return manifests;
}
