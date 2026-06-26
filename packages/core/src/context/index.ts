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
  const coreSection = [`# Selected Skill: ${skill.name}`, "", coreBody, ""].join("\n");

  const fixedSections = ["## References", "", "## Scripts", "", "## Assets", ""].join("\n");
  const availableForResources = Math.max(0, budget - coreSection.length - fixedSections.length);
  if (availableForResources <= 0) {
    return `${coreSection}${fixedSections}`;
  }

  const referenceLines: string[] = [];
  let remainingBudget = availableForResources;
  for (const reference of skill.references) {
    const line = `- ${reference}`;
    if (line.length + 1 > remainingBudget) {
      break;
    }
    referenceLines.push(line);
    remainingBudget -= line.length + 1;
  }

  const scriptLines = skill.scripts.map((script) => `- ${script}`);
  const assetLines = skill.assets.map((asset) => `- ${asset}`);

  const resourceBlock = [
    "## References",
    "",
    ...(referenceLines.length > 0 ? referenceLines : ["- None"]),
    "",
    "## Scripts",
    ...(scriptLines.length > 0 ? scriptLines : ["- None"]),
    "",
    "## Assets",
    ...(assetLines.length > 0 ? assetLines : ["- None"]),
  ].join("\n");

  return `${coreSection}${resourceBlock}`;
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
