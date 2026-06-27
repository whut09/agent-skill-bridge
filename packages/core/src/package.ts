import type { SkillManifest, SkillResource } from "./types.js";

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

export function createSkillPackage(input: {
  name: string;
  description: string;
  path: string;
  resources?: SkillResource[];
}): SkillManifest {
  const resources = input.resources ?? [];

  return {
    id: slugify(input.name),
    name: input.name,
    description: input.description,
    path: input.path,
    frontmatter: {},
    rawFrontmatter: {},
    metadata: { keywords: [] },
    resources,
    references: resources.map((resource) => resource.path),
    scripts: [],
    assets: [],
  };
}
