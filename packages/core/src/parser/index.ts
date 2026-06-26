import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import type { SkillManifest } from "../types.js";

type RawSkillFrontmatter = {
  name?: unknown;
  description?: unknown;
  version?: unknown;
  license?: unknown;
  compatibility?: unknown;
  "allowed-tools"?: unknown;
  metadata?: unknown;
};

async function pathExists(candidatePath: string): Promise<boolean> {
  try {
    await fs.access(candidatePath);
    return true;
  } catch {
    return false;
  }
}

async function walkSkillDirectories(rootDirectory: string): Promise<string[]> {
  const skillFiles: string[] = [];
  const entries = await fs.readdir(rootDirectory, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(rootDirectory, entry.name);

    if (entry.isDirectory()) {
      skillFiles.push(...(await walkSkillDirectories(entryPath)));
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

function readRequiredString(frontmatter: RawSkillFrontmatter, fieldName: "name" | "description", skillFilePath: string): string {
  const value = frontmatter[fieldName];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing required frontmatter field "${fieldName}" in ${skillFilePath}`);
  }

  return value;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
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

function readKeywords(frontmatter: RawSkillFrontmatter): string[] | undefined {
  if (!frontmatter.metadata || typeof frontmatter.metadata !== "object" || Array.isArray(frontmatter.metadata)) {
    return undefined;
  }

  return readStringList((frontmatter.metadata as Record<string, unknown>).keywords);
}

export async function parseSkillDir(skillDirectory: string): Promise<SkillManifest> {
  const skillFilePath = path.join(skillDirectory, "SKILL.md");
  const skillContent = await fs.readFile(skillFilePath, "utf8");
  const parsed = matter(skillContent);
  const frontmatter = parsed.data as RawSkillFrontmatter;
  const name = readRequiredString(frontmatter, "name", skillFilePath);
  const description = readRequiredString(frontmatter, "description", skillFilePath);
  const keywords = readKeywords(frontmatter);

  return {
    name,
    description,
    version: readOptionalString(frontmatter.version),
    license: readOptionalString(frontmatter.license),
    compatibility: frontmatter.compatibility,
    allowedTools: readStringList(frontmatter["allowed-tools"]),
    path: skillDirectory,
    frontmatter: parsed.data as Record<string, unknown>,
    rawFrontmatter: parsed.data as Record<string, unknown>,
    metadata: keywords ? { keywords } : undefined,
    references: await collectDirectoryFiles(skillDirectory, "references"),
    scripts: await collectDirectoryFiles(skillDirectory, "scripts"),
    assets: await collectDirectoryFiles(skillDirectory, "assets"),
  };
}

export async function scanSkillDirs(skillDirs: string[]): Promise<SkillManifest[]> {
  const manifests: SkillManifest[] = [];

  for (const skillDir of skillDirs) {
    const rootStat = await fs.stat(skillDir);
    if (!rootStat.isDirectory()) {
      continue;
    }

    const skillFiles = await walkSkillDirectories(skillDir);

    for (const skillFilePath of skillFiles) {
      manifests.push(await parseSkillDir(path.dirname(skillFilePath)));
    }
  }

  return manifests;
}
