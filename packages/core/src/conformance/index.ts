import { readFile } from "node:fs/promises";
import path from "node:path";
import { scanSkillText } from "@skillbridge/policy";
import type { ScannerFinding } from "@skillbridge/policy";
import type { SkillManifest } from "../types.js";
import { readSkillBody, scanSkillDirs } from "../parser/index.js";

export type SkillConformanceSeverity = "error" | "warning";

export type SkillConformanceIssue = {
  category: "frontmatter" | "metadata" | "entrypoints" | "permissions" | "references" | "scripts" | "security";
  severity: SkillConformanceSeverity;
  code: string;
  message: string;
  path?: string;
  finding?: ScannerFinding;
};

export type SkillConformanceReport = {
  id: string;
  name: string;
  path: string;
  ok: boolean;
  errors: number;
  warnings: number;
  frontmatter: {
    hasName: boolean;
    hasDescription: boolean;
    fields: string[];
  };
  metadata: {
    keywords: string[];
    domains: string[];
    taskTypes: string[];
  };
  entrypoints: {
    default?: string;
    tools: string[];
  };
  permissions: {
    read: string[];
    write: string[];
    network?: boolean;
    execute?: boolean;
  };
  references: string[];
  scripts: string[];
  issues: SkillConformanceIssue[];
};

export type SkillConformanceSummary = {
  skillRoot: string;
  total: number;
  count: number;
  ok: boolean;
  errors: number;
  warnings: number;
  skills: SkillConformanceReport[];
};

function uniqueStrings(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).filter((value) => value.trim().length > 0))];
}

function countIssues(issues: SkillConformanceIssue[]): { errors: number; warnings: number } {
  return {
    errors: issues.filter((issue) => issue.severity === "error").length,
    warnings: issues.filter((issue) => issue.severity === "warning").length,
  };
}

function createIssue(issue: SkillConformanceIssue): SkillConformanceIssue {
  return issue;
}

function addScannerFindings(issues: SkillConformanceIssue[], findings: ScannerFinding[]): void {
  for (const finding of findings) {
    issues.push(
      createIssue({
        category: "security",
        severity: finding.severity === "high" ? "error" : "warning",
        code: `security.${finding.category}`,
        message: finding.message,
        finding,
      }),
    );
  }
}

async function readScriptText(skillPath: string, scriptPath: string): Promise<string | undefined> {
  try {
    return await readFile(path.join(skillPath, scriptPath), "utf8");
  } catch {
    return undefined;
  }
}

function getFrontmatterFields(skill: SkillManifest): string[] {
  return Object.keys(skill.frontmatter ?? {}).sort();
}

function isDefaultSensitiveResource(resourcePath: string): boolean {
  const basename = path.basename(resourcePath).toLowerCase();
  const extension = path.extname(resourcePath).toLowerCase();
  return (
    extension === ".env" ||
    extension === ".pem" ||
    extension === ".key" ||
    basename === ".env" ||
    basename === "credentials.json" ||
    basename === "id_rsa" ||
    /^\.env(?:\.|$)/iu.test(basename) ||
    /^secrets(?:\.|$)/iu.test(basename)
  );
}

async function lintSkill(skill: SkillManifest): Promise<SkillConformanceReport> {
  const issues: SkillConformanceIssue[] = [];

  const hasName = typeof skill.name === "string" && skill.name.trim().length > 0;
  const hasDescription = typeof skill.description === "string" && skill.description.trim().length > 0;
  const metadata = skill.metadata ?? {};
  const entrypoints = skill.entrypoints ?? { tools: undefined };
  const permissions = skill.permissions ?? {};

  if (!hasName) {
    issues.push({
      category: "frontmatter",
      severity: "error",
      code: "frontmatter.name_missing",
      message: "Skill frontmatter is missing a name.",
    });
  }
  if (!hasDescription) {
    issues.push({
      category: "frontmatter",
      severity: "error",
      code: "frontmatter.description_missing",
      message: "Skill frontmatter is missing a description.",
    });
  }

  if ((metadata.keywords ?? []).length === 0) {
    issues.push({
      category: "metadata",
      severity: "warning",
      code: "metadata.keywords_missing",
      message: "metadata.keywords is missing or empty.",
    });
  }
  if ((metadata.domains ?? []).length === 0) {
    issues.push({
      category: "metadata",
      severity: "warning",
      code: "metadata.domains_missing",
      message: "metadata.domains is missing or empty.",
    });
  }

  if (skill.references.length > 0 && !permissions.read) {
    issues.push({
      category: "permissions",
      severity: "warning",
      code: "permissions.read_missing",
      message: "Skill has references but no permissions.read allowlist.",
    });
  }
  if (skill.scripts.length > 0 && permissions.execute !== true) {
    issues.push({
      category: "permissions",
      severity: "warning",
      code: "permissions.execute_missing",
      message: "Skill has scripts but permissions.execute is not enabled.",
    });
  }
  if (permissions.network === true) {
    issues.push({
      category: "permissions",
      severity: "warning",
      code: "permissions.network_enabled",
      message: "Skill requests network access.",
    });
  }

  if (entrypoints.default && !skill.scripts.includes(entrypoints.default)) {
    issues.push({
      category: "entrypoints",
      severity: "error",
      code: "entrypoints.default_missing_script",
      path: entrypoints.default,
      message: "entrypoints.default does not point to a discovered script.",
    });
  }
  for (const [toolName, scriptPath] of Object.entries(entrypoints.tools ?? {})) {
    if (!skill.scripts.includes(scriptPath)) {
      issues.push({
        category: "entrypoints",
        severity: "error",
        code: "entrypoints.tool_missing_script",
        path: scriptPath,
        message: `Entry point tool "${toolName}" does not point to a discovered script.`,
      });
    }
  }

  if (skill.references.length === 0) {
    issues.push({
      category: "references",
      severity: "warning",
      code: "references.empty",
      message: "Skill does not declare any references.",
    });
  }
  for (const referencePath of skill.references) {
    if (isDefaultSensitiveResource(referencePath)) {
      issues.push({
        category: "references",
        severity: "error",
        code: "references.sensitive_default_denied",
        path: referencePath,
        message: "Reference path is denied by the default sensitive resource policy.",
      });
    }
  }
  if (skill.scripts.length === 0) {
    issues.push({
      category: "scripts",
      severity: "warning",
      code: "scripts.empty",
      message: "Skill does not declare any scripts.",
    });
  }

  const body = await readSkillBody(skill.path);
  addScannerFindings(
    issues,
    scanSkillText([JSON.stringify(skill.rawFrontmatter ?? skill.frontmatter), body].filter(Boolean).join("\n")),
  );

  for (const scriptPath of skill.scripts) {
    const content = await readScriptText(skill.path, scriptPath);
    if (content) {
      addScannerFindings(issues, scanSkillText(content));
    }
  }

  const { errors, warnings } = countIssues(issues);
  return {
    id: skill.id,
    name: skill.name,
    path: skill.path,
    ok: errors === 0,
    errors,
    warnings,
    frontmatter: {
      hasName,
      hasDescription,
      fields: getFrontmatterFields(skill),
    },
    metadata: {
      keywords: uniqueStrings(metadata.keywords),
      domains: uniqueStrings(metadata.domains),
      taskTypes: uniqueStrings(metadata.taskTypes),
    },
    entrypoints: {
      default: entrypoints.default,
      tools: Object.values(entrypoints.tools ?? {}),
    },
    permissions: {
      read: uniqueStrings(permissions.read),
      write: uniqueStrings(permissions.write),
      network: permissions.network,
      execute: permissions.execute,
    },
    references: [...skill.references],
    scripts: [...skill.scripts],
    issues,
  };
}

export async function lintSkillConformance(skillDirs: string[]): Promise<SkillConformanceSummary> {
  const skills = await scanSkillDirs(skillDirs);
  const reports = await Promise.all(skills.map((skill) => lintSkill(skill)));
  const errors = reports.reduce((sum, report) => sum + report.errors, 0);
  const warnings = reports.reduce((sum, report) => sum + report.warnings, 0);

  return {
    skillRoot: skillDirs.join(", "),
    total: reports.length,
    count: reports.length,
    ok: errors === 0,
    errors,
    warnings,
    skills: reports,
  };
}
