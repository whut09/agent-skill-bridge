import type { ActivationDecision, SkillManifest, SkillSearchResult } from "../types.js";

export type SkillSearchOptions = {
  topK?: number;
  minScore?: number;
};

export type SkillRouteInput = {
  query: string;
  skills: SkillManifest[];
  options?: SkillSearchOptions;
  candidates?: SkillSearchResult[];
};

export interface SkillRouter {
  route(input: SkillRouteInput): Promise<ActivationDecision> | ActivationDecision;
}

export type EmbeddingRouterOptions = {
  route?: (input: SkillRouteInput) => Promise<ActivationDecision> | ActivationDecision;
};

export type LlmRouterOptions = {
  route?: (input: SkillRouteInput) => Promise<ActivationDecision> | ActivationDecision;
};

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function tokenizeQuery(query: string): string[] {
  return normalizeText(query)
    .split(/[\s,.;:，。；：/\\-]+/u)
    .map((token) => token.trim())
    .filter(Boolean);
}

function hasChinese(value: string): boolean {
  return /\p{Script=Han}/u.test(value);
}

function createCharBigrams(value: string): string[] {
  const chars = Array.from(value.replace(/\s+/gu, ""));
  const bigrams: string[] = [];

  for (let index = 0; index < chars.length - 1; index += 1) {
    const bigram = `${chars[index]}${chars[index + 1]}`;
    if (hasChinese(bigram)) {
      bigrams.push(bigram);
    }
  }

  return bigrams;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function createSearchTerms(query: string): string[] {
  const normalizedQuery = normalizeText(query);
  const tokens = tokenizeQuery(query);
  const bigrams = hasChinese(normalizedQuery) ? createCharBigrams(normalizedQuery) : [];
  return unique([...tokens, ...bigrams]);
}

function countMatchingTerms(terms: string[], values: string[]): string[] {
  const normalizedValues = values.map(normalizeText).filter(Boolean);

  return terms.filter((term) =>
    normalizedValues.some((value) => value === term || value.includes(term) || term.includes(value)),
  );
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(1, score));
}

function scoreSkill(query: string, skill: SkillManifest): SkillSearchResult | null {
  const normalizedQuery = normalizeText(query);
  const queryTerms = createSearchTerms(query);
  const reasons: string[] = [];
  let score = 0;

  if (normalizedQuery === normalizeText(skill.name)) {
    score += 1;
    reasons.push("name exact match");
  } else if (normalizedQuery.length > 0 && normalizeText(skill.name).includes(normalizedQuery)) {
    score += 0.9;
    reasons.push("name contains query");
  } else {
    const matchedNameTerms = countMatchingTerms(queryTerms, [skill.name]);
    if (matchedNameTerms.length > 0) {
      score += Math.min(0.75, matchedNameTerms.length * 0.18);
      reasons.push(`name matched: ${matchedNameTerms.join(", ")}`);
    }
  }

  const description = normalizeText(skill.description);
  const matchedDescriptionTerms = queryTerms.filter((term) => description.includes(term));
  if (matchedDescriptionTerms.length > 0) {
    score += Math.min(0.55, matchedDescriptionTerms.length * 0.14);
    reasons.push(`description matched: ${matchedDescriptionTerms.join(", ")}`);
  }

  const matchedKeywords = countMatchingTerms(queryTerms, skill.metadata?.keywords ?? []);
  if (matchedKeywords.length > 0) {
    score += Math.min(0.95, matchedKeywords.length * 0.28);
    reasons.push(`keywords matched: ${matchedKeywords.join(", ")}`);
  }

  if (score === 0) {
    return null;
  }

  return {
    skill,
    score: clampScore(score),
    reason: reasons,
  };
}

function inferRequiredResources(skill: SkillManifest): string[] {
  return skill.entrypoints?.default ? [skill.entrypoints.default] : [];
}

function inferRequiredTools(skill: SkillManifest): string[] {
  return skill.allowedTools ?? [];
}

function createSkillId(skill: SkillManifest): string {
  return skill.id;
}

function decorateCandidate(result: SkillSearchResult) {
  return {
    ...result,
    skillId: createSkillId(result.skill),
    name: result.skill.name,
    reasons: result.reason,
  };
}

function createActivationDecision(query: string, candidates: SkillSearchResult[]): ActivationDecision {
  const decoratedCandidates = candidates.map(decorateCandidate);
  const selectedCandidate = decoratedCandidates[0];

  if (!selectedCandidate) {
    return {
      runId: "",
      query,
      selected: false,
      candidates: decoratedCandidates,
      confidence: 0,
      reason: "No skill candidate met the routing threshold.",
      systemPatch: "",
      allowedTools: [],
      nextActions: ["none"],
      requiredResources: [],
      requiredTools: [],
    };
  }

  return {
    runId: "",
    query,
    selected: true,
    selectedSkill: {
      id: selectedCandidate.skillId,
      name: selectedCandidate.skill.name,
    },
    skill: selectedCandidate.skill,
    candidates: decoratedCandidates,
    confidence: selectedCandidate.score,
    reason: selectedCandidate.reason.join("; "),
    systemPatch: "",
    allowedTools: inferRequiredTools(selectedCandidate.skill),
    nextActions: ["readResource"],
    requiredResources: inferRequiredResources(selectedCandidate.skill),
    requiredTools: inferRequiredTools(selectedCandidate.skill),
  };
}

export class RuleRouter implements SkillRouter {
  route(input: SkillRouteInput): ActivationDecision {
    const candidates = searchSkills(input.query, input.skills, input.options);
    return createActivationDecision(input.query, candidates);
  }
}

export class EmbeddingRouter implements SkillRouter {
  constructor(private readonly options: EmbeddingRouterOptions = {}) {}

  async route(input: SkillRouteInput): Promise<ActivationDecision> {
    if (!this.options.route) {
      return {
        runId: "",
        query: input.query,
        selected: false,
        candidates: (input.candidates ?? []).map(decorateCandidate),
        confidence: 0,
        reason: "EmbeddingRouter is not configured.",
        systemPatch: "",
        allowedTools: [],
        nextActions: ["none"],
        requiredResources: [],
        requiredTools: [],
      };
    }

    return this.options.route(input);
  }
}

export class LlmRouter implements SkillRouter {
  constructor(private readonly options: LlmRouterOptions = {}) {}

  async route(input: SkillRouteInput): Promise<ActivationDecision> {
    if (!this.options.route) {
      return {
        runId: "",
        query: input.query,
        selected: false,
        candidates: (input.candidates ?? []).map(decorateCandidate),
        confidence: 0,
        reason: "LlmRouter is not configured.",
        systemPatch: "",
        allowedTools: [],
        nextActions: ["none"],
        requiredResources: [],
        requiredTools: [],
      };
    }

    return this.options.route(input);
  }
}

export function searchSkills(
  query: string,
  skills: SkillManifest[],
  options: SkillSearchOptions = {},
): SkillSearchResult[] {
  const topK = options.topK ?? 5;
  const minScore = options.minScore ?? 0.15;

  return skills
    .map((skill) => scoreSkill(query, skill))
    .filter((result): result is SkillSearchResult => result !== null)
    .filter((result) => result.score >= minScore)
    .sort((left, right) => right.score - left.score || left.skill.name.localeCompare(right.skill.name))
    .slice(0, topK);
}

export function routeSkills(
  query: string,
  skills: SkillManifest[],
  options: SkillSearchOptions = {},
  router: SkillRouter = new RuleRouter(),
): Promise<ActivationDecision> | ActivationDecision {
  return router.route({ query, skills, options });
}
