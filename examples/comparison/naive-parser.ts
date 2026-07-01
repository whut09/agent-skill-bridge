import { promises as fs } from "node:fs";
import path from "node:path";

type NaiveSkill = {
  id: string;
  name: string;
  description: string;
  keywords: string[];
  promptBlock: string;
  resourceCount: number;
};

type ParsedSkillMarkdown = {
  data: Record<string, unknown>;
  content: string;
};

const skillRoot = path.resolve("examples/skills");
const query = "review this pull request for regression risk";

async function pathExists(candidatePath: string): Promise<boolean> {
  try {
    await fs.access(candidatePath);
    return true;
  } catch {
    return false;
  }
}

async function listFilesRecursively(rootDirectory: string): Promise<string[]> {
  if (!(await pathExists(rootDirectory))) {
    return [];
  }

  const entries = await fs.readdir(rootDirectory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(rootDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursively(entryPath)));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

async function findSkillDirs(rootDirectory: string): Promise<string[]> {
  const entries = await fs.readdir(rootDirectory, { withFileTypes: true });
  const skillDirs: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(rootDirectory, entry.name);
    if (entry.isDirectory()) {
      if (await pathExists(path.join(entryPath, "SKILL.md"))) {
        skillDirs.push(entryPath);
      }
      skillDirs.push(...(await findSkillDirs(entryPath)));
    }
  }

  return skillDirs;
}

function normalizeList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return [];
}

function parseScalar(value: string): string {
  return value.replace(/^["']|["']$/gu, "").trim();
}

function parseNaiveFrontmatter(markdown: string): ParsedSkillMarkdown {
  if (!markdown.startsWith("---\n")) {
    return { data: {}, content: markdown };
  }

  const endIndex = markdown.indexOf("\n---", 4);
  if (endIndex === -1) {
    return { data: {}, content: markdown };
  }

  const frontmatter = markdown.slice(4, endIndex);
  const content = markdown.slice(endIndex + "\n---".length).trimStart();
  const data: Record<string, unknown> = {};
  let currentObjectKey: string | undefined;

  for (const line of frontmatter.split(/\r?\n/u)) {
    const nestedMatch = line.match(/^\s+([A-Za-z0-9_-]+):\s*(.*)$/u);
    if (nestedMatch && currentObjectKey) {
      const nested = (data[currentObjectKey] ?? {}) as Record<string, unknown>;
      nested[nestedMatch[1]] = parseScalar(nestedMatch[2]);
      data[currentObjectKey] = nested;
      continue;
    }

    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/u);
    if (!match) {
      continue;
    }

    currentObjectKey = undefined;
    if (match[2] === "") {
      currentObjectKey = match[1];
      data[currentObjectKey] = {};
    } else {
      data[match[1]] = parseScalar(match[2]);
    }
  }

  return { data, content };
}

async function readNaiveSkill(skillDir: string): Promise<NaiveSkill> {
  const skillMarkdown = await fs.readFile(path.join(skillDir, "SKILL.md"), "utf8");
  const parsed = parseNaiveFrontmatter(skillMarkdown);
  const metadata = parsed.data.metadata && typeof parsed.data.metadata === "object" ? parsed.data.metadata : {};
  const files = [
    ...(await listFilesRecursively(path.join(skillDir, "references"))),
    ...(await listFilesRecursively(path.join(skillDir, "scripts"))),
    ...(await listFilesRecursively(path.join(skillDir, "assets"))),
  ];
  const resourceBlocks = await Promise.all(
    files.map(async (filePath) => {
      const relativePath = path.relative(skillDir, filePath).split(path.sep).join("/");
      const content = await fs.readFile(filePath, "utf8");
      return [`## ${relativePath}`, "", content].join("\n");
    }),
  );

  return {
    id: typeof parsed.data.id === "string" ? parsed.data.id : path.basename(skillDir),
    name: typeof parsed.data.name === "string" ? parsed.data.name : path.basename(skillDir),
    description: typeof parsed.data.description === "string" ? parsed.data.description : "",
    keywords: normalizeList((metadata as Record<string, unknown>).keywords),
    promptBlock: [`# ${parsed.data.name ?? path.basename(skillDir)}`, "", parsed.content, ...resourceBlocks].join("\n"),
    resourceCount: files.length,
  };
}

function selectSkill(skills: NaiveSkill[]): NaiveSkill | undefined {
  const normalizedQuery = query.toLowerCase();
  return skills
    .map((skill) => {
      const haystack = [skill.name, skill.description, ...skill.keywords].join(" ").toLowerCase();
      const score = normalizedQuery
        .split(/\s+/u)
        .filter(Boolean)
        .filter((token) => haystack.includes(token)).length;
      return { skill, score };
    })
    .sort((left, right) => right.score - left.score)[0]?.skill;
}

async function main(): Promise<void> {
  const skills = await Promise.all((await findSkillDirs(skillRoot)).map(readNaiveSkill));
  const prompt = [
    "# Naive Agent Skill Prompt",
    "",
    "All discovered skills, references, scripts, and assets are inlined before routing.",
    "",
    ...skills.map((skill) => skill.promptBlock),
  ].join("\n");
  const selectedSkill = selectSkill(skills);

  console.log(
    JSON.stringify(
      {
        mode: "naive-parser",
        query,
        promptSizeChars: prompt.length,
        selectedSkill: selectedSkill?.id ?? "no-skill",
        resourcesLoaded: skills.reduce((total, skill) => total + skill.resourceCount, 0),
        policyDecisions: "none",
        traceRecord: "none",
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
