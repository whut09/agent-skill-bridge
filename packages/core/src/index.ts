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
  metadata?: {
    keywords?: string[];
  };
  references: string[];
  scripts: string[];
  assets: string[];
};

export type SkillSearchResult = {
  skill: SkillManifest;
  score: number;
  reason: string[];
};

export type ResourceFileMetadata = {
  path: string;
  size: number;
  mimeType: string;
  extension: string;
  isText: boolean;
  modifiedAt: string;
};

export type ResourceManagerTextResult = {
  type: "text";
  path: string;
  content: string;
  metadata: ResourceFileMetadata;
};

export type ResourceManagerBinaryResult = {
  type: "binary";
  path: string;
  content: Buffer;
  metadata: ResourceFileMetadata;
};

export type ResourceManagerResult = ResourceManagerTextResult | ResourceManagerBinaryResult;

export type ResourceManagerInput = {
  skillPath: string;
  resourcePath: string;
};

export type SkillContextInput = {
  query?: string;
  skills: SkillManifest[];
  selectedSkill?: SkillManifest;
  skillBodies?: Record<string, string>;
  budget?: number;
};

export type SkillContext = {
  catalog: string;
  systemPatch: string;
  selectedSkill?: {
    name: string;
    description: string;
    body?: string;
    references: string[];
    scripts: string[];
    assets: string[];
  };
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
    metadata: { keywords: [] },
    references: (input.resources ?? []).map((resource) => resource.path),
    scripts: [],
    assets: [],
  };
}

const textExtensions = new Set([
  ".md",
  ".markdown",
  ".txt",
  ".json",
  ".yml",
  ".yaml",
  ".js",
  ".cjs",
  ".mjs",
  ".ts",
  ".tsx",
  ".css",
  ".html",
  ".jsonl",
]);

const mimeTypesByExtension: Record<string, string> = {
  ".md": "text/markdown; charset=utf-8",
  ".markdown": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".yml": "text/yaml; charset=utf-8",
  ".yaml": "text/yaml; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".cjs": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".ts": "text/typescript; charset=utf-8",
  ".tsx": "text/typescript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jsonl": "application/x-ndjson; charset=utf-8",
};

function isWithinDirectory(directory: string, candidate: string): boolean {
  const relative = path.relative(directory, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function toAbsoluteSkillPath(skillPath: string, resourcePath: string): string {
  if (path.isAbsolute(resourcePath)) {
    return path.normalize(resourcePath);
  }

  const normalizedSkillPath = path.normalize(skillPath);
  return path.normalize(path.resolve(normalizedSkillPath, resourcePath));
}

function createResourceMetadata(absolutePath: string, stat: Awaited<ReturnType<typeof fs.stat>>): ResourceFileMetadata {
  const extension = path.extname(absolutePath).toLowerCase();
  const isText = textExtensions.has(extension);

  return {
    path: absolutePath,
    size: stat.size,
    mimeType: mimeTypesByExtension[extension] ?? (isText ? "text/plain; charset=utf-8" : "application/octet-stream"),
    extension,
    isText,
    modifiedAt: stat.mtime.toISOString(),
  };
}

export async function readSkillResource(input: ResourceManagerInput): Promise<ResourceManagerResult> {
  const skillRoot = path.resolve(input.skillPath);
  const resourceAbsolutePath = toAbsoluteSkillPath(skillRoot, input.resourcePath);

  if (!isWithinDirectory(skillRoot, resourceAbsolutePath)) {
    throw new Error(`Refusing to read outside skill directory: ${input.resourcePath}`);
  }

  const stat = await fs.stat(resourceAbsolutePath);
  if (!stat.isFile()) {
    throw new Error(`Resource is not a file: ${input.resourcePath}`);
  }

  const metadata = createResourceMetadata(resourceAbsolutePath, stat);
  if (metadata.isText) {
    return {
      type: "text",
      path: resourceAbsolutePath,
      content: await fs.readFile(resourceAbsolutePath, "utf8"),
      metadata,
    };
  }

  return {
    type: "binary",
    path: resourceAbsolutePath,
    content: await fs.readFile(resourceAbsolutePath),
    metadata,
  };
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function tokenizeQuery(query: string): string[] {
  return normalizeText(query)
    .split(/[\s,.;:，。；：/\\-]+/u)
    .map((token) => token.trim())
    .filter(Boolean);
}

function scoreSkill(query: string, skill: SkillManifest): SkillSearchResult | null {
  const normalizedQuery = normalizeText(query);
  const queryTokens = tokenizeQuery(query);
  const reasons: string[] = [];
  let score = 0;

  if (normalizedQuery === normalizeText(skill.name)) {
    score += 100;
    reasons.push("name exact match");
  } else if (normalizedQuery.length > 0 && normalizeText(skill.name).includes(normalizedQuery)) {
    score += 80;
    reasons.push("name contains query");
  }

  const description = normalizeText(skill.description);
  const matchedDescriptionTokens = queryTokens.filter((token) => token && description.includes(token));
  if (matchedDescriptionTokens.length > 0) {
    score += matchedDescriptionTokens.length * 20;
    reasons.push(`description matched: ${matchedDescriptionTokens.join(", ")}`);
  }

  const keywords = skill.metadata?.keywords ?? [];
  const matchedKeywords = queryTokens.filter((token) =>
    keywords.some((keyword) => normalizeText(keyword).includes(token) || token.includes(normalizeText(keyword))),
  );
  if (matchedKeywords.length > 0) {
    score += matchedKeywords.length * 30;
    reasons.push(`keywords matched: ${matchedKeywords.join(", ")}`);
  }

  if (score === 0) {
    return null;
  }

  return {
    skill,
    score,
    reason: reasons,
  };
}

export function searchSkills(query: string, skills: SkillManifest[]): SkillSearchResult[] {
  return skills
    .map((skill) => scoreSkill(query, skill))
    .filter((result): result is SkillSearchResult => result !== null)
    .sort((left, right) => right.score - left.score || left.skill.name.localeCompare(right.skill.name));
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

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  if (maxLength <= 3) {
    return value.slice(0, maxLength);
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

function estimateSkillBody(skill: SkillManifest, body: string | undefined): string {
  return body ?? `# ${skill.name}\n\n${skill.description}`;
}

function buildCatalog(skills: SkillManifest[]): string {
  if (skills.length === 0) {
    return "# Skill Catalog\n\nNo skills available.";
  }

  const lines = ["# Skill Catalog", ""];
  for (const skill of skills) {
    lines.push(`- ${skill.name}: ${skill.description}`);
  }

  return lines.join("\n");
}

function buildSelectedSkillBlock(skill: SkillManifest, body: string | undefined, budget: number): string {
  const coreBody = estimateSkillBody(skill, body).trim();
  const coreSection = [
    `# Selected Skill: ${skill.name}`,
    "",
    coreBody,
    "",
  ].join("\n");

  const referenceSectionHeader = "## References";
  const references = skill.references.map((reference) => `- ${reference}`);
  const scripts = skill.scripts.map((script) => `- ${script}`);
  const assets = skill.assets.map((asset) => `- ${asset}`);
  const resourceBlock = [
    referenceSectionHeader,
    ...references.length > 0 ? ["", ...references] : ["", "- None"],
    "",
    "## Scripts",
    ...(scripts.length > 0 ? scripts : ["- None"]),
    "",
    "## Assets",
    ...(assets.length > 0 ? assets : ["- None"]),
  ].join("\n");

  const availableForResources = Math.max(0, budget - coreSection.length);
  if (availableForResources <= 0) {
    return coreSection;
  }

  return `${coreSection}${truncateText(resourceBlock, availableForResources)}`;
}

export async function buildSkillContext(input: SkillContextInput): Promise<SkillContext> {
  const budget = input.budget ?? 8000;
  const catalog = buildCatalog(input.skills);
  const selectedSkill = input.selectedSkill;
  const selectedBody = selectedSkill ? input.skillBodies?.[selectedSkill.path] : undefined;

  if (!selectedSkill) {
    const systemPatch = truncateText(catalog, budget);
    return { catalog, systemPatch };
  }

  const selectedSkillBlock = buildSelectedSkillBlock(selectedSkill, selectedBody, budget);
  const availableForCatalog = Math.max(0, budget - selectedSkillBlock.length - 1);
  const catalogSection = truncateText(catalog, availableForCatalog);
  const systemPatch = [catalogSection, "", selectedSkillBlock].join("\n").trim();

  return {
    catalog,
    systemPatch,
    selectedSkill: {
      name: selectedSkill.name,
      description: selectedSkill.description,
      body: selectedBody,
      references: selectedSkill.references,
      scripts: selectedSkill.scripts,
      assets: selectedSkill.assets,
    },
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
