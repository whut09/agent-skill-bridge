import { promises as fs } from "node:fs";
import type { Stats } from "node:fs";
import path from "node:path";
import type { ResourceFileMetadata, ResourceManagerInput, ResourceManagerResult } from "../types.js";

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
  ".sh",
  ".bash",
  ".py",
  ".ps1",
  ".ts",
  ".tsx",
  ".css",
  ".html",
  ".csv",
  ".xml",
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
  ".sh": "text/x-shellscript; charset=utf-8",
  ".bash": "text/x-shellscript; charset=utf-8",
  ".py": "text/x-python; charset=utf-8",
  ".ps1": "text/plain; charset=utf-8",
  ".ts": "text/typescript; charset=utf-8",
  ".tsx": "text/typescript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".jsonl": "application/x-ndjson; charset=utf-8",
};

const defaultDeniedExtensions = [".env", ".pem", ".key"];
const defaultDeniedBasenames = [".env", "credentials.json", "id_rsa"];
const defaultDeniedFilenamePatterns = [/^\.env(?:\.|$)/iu, /^secrets(?:\.|$)/iu];

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

function createResourceMetadata(absolutePath: string, stat: Stats): ResourceFileMetadata {
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

function normalizeExtension(value: string): string {
  const extension = value.trim().toLowerCase();
  if (!extension) {
    return "";
  }

  return extension.startsWith(".") ? extension : `.${extension}`;
}

function normalizeExtensions(values: string[] | undefined): string[] {
  return values?.map(normalizeExtension).filter(Boolean) ?? [];
}

function assertDefaultSensitiveResourceAllowed(resourcePath: string, extension: string): void {
  const basename = path.basename(resourcePath).toLowerCase();
  if (
    defaultDeniedExtensions.includes(extension) ||
    defaultDeniedBasenames.includes(basename) ||
    defaultDeniedFilenamePatterns.some((pattern) => pattern.test(basename))
  ) {
    throw new Error(`Resource is denied by default sensitive resource policy: ${resourcePath}`);
  }
}

function assertExtensionAllowed(input: ResourceManagerInput, extension: string): void {
  const deniedExtensions = [...defaultDeniedExtensions, ...normalizeExtensions(input.deniedExtensions)];
  const allowedExtensions = normalizeExtensions(input.allowedExtensions);

  if (extension && deniedExtensions.includes(extension)) {
    throw new Error(`Resource extension is denied by policy: ${extension}`);
  }

  if (allowedExtensions.length > 0 && (!extension || !allowedExtensions.includes(extension))) {
    throw new Error(`Resource extension is not in allowedExtensions: ${extension || "(none)"}`);
  }
}

function assertBinaryAllowed(input: ResourceManagerInput, metadata: ResourceFileMetadata): void {
  if (!metadata.isText && input.allowBinary !== true) {
    throw new Error(`Binary resource reads are disabled by default: ${input.resourcePath}`);
  }
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
  if (input.maxFileBytes !== undefined && stat.size > input.maxFileBytes) {
    throw new Error(`Resource exceeds configured maxFileBytes: ${input.resourcePath}`);
  }

  const metadata = createResourceMetadata(resourceAbsolutePath, stat);
  assertDefaultSensitiveResourceAllowed(input.resourcePath, metadata.extension);
  assertExtensionAllowed(input, metadata.extension);
  assertBinaryAllowed(input, metadata);

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
