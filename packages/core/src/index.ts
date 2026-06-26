import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";

export type SkillResource = {
  path: string;
  content: string;
};

export type SkillManifest = {
  name: string;
  description: string;
  path: string;
  frontmatter: Record<string, unknown>;
  references: string[];
  scripts: string[];
  assets: string[];
};

export type RuntimeTraceEvent = {
  type: string;
  message: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
};

export function createRuntimeTraceEvent(
  type: string,
  message: string,
  metadata?: Record<string, unknown>,
): RuntimeTraceEvent {
  return {
    type,
    message,
    timestamp: new Date().toISOString(),
    metadata,
  };
}

export function createSkillPackage(input: {
  name: string;
  description: string;
  path: string;
  resources?: SkillResource[];
}): SkillManifest {
  return {
    name: input.name,
    description: input.description,
    path: input.path,
    frontmatter: {},
    references: (input.resources ?? []).map((resource) => resource.path),
    scripts: [],
    assets: [],
  };
}

type RawSkillFrontmatter = {
  name?: unknown;
  description?: unknown;
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

export async function scanSkillDirs(skillDirs: string[]): Promise<SkillManifest[]> {
  const manifests: SkillManifest[] = [];

  for (const skillDir of skillDirs) {
    const rootStat = await fs.stat(skillDir);
    if (!rootStat.isDirectory()) {
      continue;
    }

    const skillFiles = await walkSkillDirectories(skillDir);

    for (const skillFilePath of skillFiles) {
      const skillDirectory = path.dirname(skillFilePath);
      const skillContent = await fs.readFile(skillFilePath, "utf8");
      const parsed = matter(skillContent);
      const frontmatter = parsed.data as RawSkillFrontmatter;

      if (typeof frontmatter.name !== "string" || frontmatter.name.trim() === "") {
        throw new Error(`Missing required frontmatter field "name" in ${skillFilePath}`);
      }

      if (typeof frontmatter.description !== "string" || frontmatter.description.trim() === "") {
        throw new Error(`Missing required frontmatter field "description" in ${skillFilePath}`);
      }

      manifests.push({
        name: frontmatter.name,
        description: frontmatter.description,
        path: skillDirectory,
        frontmatter: parsed.data as Record<string, unknown>,
        references: await collectDirectoryFiles(skillDirectory, "references"),
        scripts: await collectDirectoryFiles(skillDirectory, "scripts"),
        assets: await collectDirectoryFiles(skillDirectory, "assets"),
      });
    }
  }

  return manifests;
}
