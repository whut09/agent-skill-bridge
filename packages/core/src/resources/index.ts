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
