import type { SkillManifest, SkillSearchResult } from "../types.js";

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
