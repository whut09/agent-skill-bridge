import type { SkillManifest, SkillResource } from "./types.js";

export function createSkillPackage(input: {
  name: string;
  description: string;
  path: string;
  resources?: SkillResource[];
}): SkillManifest {
  const resources = input.resources ?? [];

  return {
    name: input.name,
    description: input.description,
    path: input.path,
    frontmatter: {},
    metadata: { keywords: [] },
    resources,
    references: resources.map((resource) => resource.path),
    scripts: [],
    assets: [],
  };
}
