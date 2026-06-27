import type { SkillContext, SkillContextInput, SkillManifest } from "../types.js";

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

function formatKeywords(skill: SkillManifest): string {
  return skill.metadata?.keywords?.length ? skill.metadata.keywords.join(", ") : "None";
}

function buildCatalog(skills: SkillManifest[]): string {
  if (skills.length === 0) {
    return "# Skill Catalog (Level 0)\n\nNo skills available.";
  }

  const lines = ["# Skill Catalog (Level 0)", ""];
  for (const skill of skills) {
    lines.push(`- ${skill.name}`);
    lines.push(`  Description: ${skill.description}`);
    lines.push(`  Keywords: ${formatKeywords(skill)}`);
  }

  return lines.join("\n");
}

function buildProgressiveLoadingPlan(selectedSkill?: SkillManifest): SkillContext["progressiveLoading"] {
  return {
    level0: {
      loaded: true,
      fields: ["name", "description", "metadata.keywords"],
    },
    ...(selectedSkill
      ? {
          level1: {
            loaded: true as const,
            skillName: selectedSkill.name,
            source: "SKILL.md" as const,
          },
        }
      : {}),
    level2: {
      loaded: false,
      references: selectedSkill?.references ?? [],
    },
    level3: {
      loaded: false,
      scripts: selectedSkill?.scripts ?? [],
      assets: selectedSkill?.assets ?? [],
    },
  };
}

function buildSelectedSkillBlock(skill: SkillManifest, body: string | undefined): string {
  const coreBody = estimateSkillBody(skill, body).trim();
  return [`# Selected Skill (Level 1): ${skill.name}`, "", coreBody].join("\n");
}

export async function buildSkillContext(input: SkillContextInput): Promise<SkillContext> {
  const budget = input.budget ?? 8000;
  const catalog = buildCatalog(input.skills);
  const selectedSkill = input.selectedSkill;
  const selectedBody = selectedSkill ? input.skillBodies?.[selectedSkill.path] : undefined;

  if (!selectedSkill) {
    const systemPatch = truncateText(catalog, budget);
    return { catalog, systemPatch, progressiveLoading: buildProgressiveLoadingPlan() };
  }

  const selectedSkillBlock = buildSelectedSkillBlock(selectedSkill, selectedBody);
  const availableForCatalog = Math.max(0, budget - selectedSkillBlock.length - 1);
  const catalogSection = truncateText(catalog, availableForCatalog);
  const systemPatch = [catalogSection, "", selectedSkillBlock].join("\n").trim();

  return {
    catalog,
    systemPatch,
    progressiveLoading: buildProgressiveLoadingPlan(selectedSkill),
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
