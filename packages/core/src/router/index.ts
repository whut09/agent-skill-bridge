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

export type SkillRerankInput = SkillRouteInput & {
  candidates: SkillSearchResult[];
};

export interface SkillRouter {
  search(
    query: string,
    skills: SkillManifest[],
    options?: SkillSearchOptions,
  ): Promise<SkillSearchResult[]> | SkillSearchResult[];
}

export interface SkillActivationRouter extends SkillRouter {
  route(input: SkillRouteInput): Promise<ActivationDecision> | ActivationDecision;
}

export interface SkillCandidateFilter {
  filter(input: SkillRerankInput): Promise<SkillSearchResult[]> | SkillSearchResult[];
}

export interface SkillReranker {
  rerank(input: SkillRerankInput): Promise<SkillSearchResult[]> | SkillSearchResult[];
}

export type SkillRoutePipelineOptions = {
  router?: SkillRouter;
  policyFilter?: SkillCandidateFilter;
  reranker?: SkillReranker;
};

export type SkillRoutePipelineTrace = {
  retrieved: SkillSearchResult[];
  policyFiltered: SkillSearchResult[];
  reranked: SkillSearchResult[];
};

export type SkillRoutePipelineResult = {
  decision: ActivationDecision;
  trace: SkillRoutePipelineTrace;
};

export type EmbeddingRouterOptions = {
  search?: (input: SkillRouteInput) => Promise<SkillSearchResult[]> | SkillSearchResult[];
};

export type LlmRerankRouterOptions = {
  rerank?: (input: SkillRerankInput) => Promise<SkillSearchResult[]> | SkillSearchResult[];
};

export type LlmRouterOptions = LlmRerankRouterOptions;

export type PolicyFilterOptions = {
  allowUntrusted?: boolean;
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

export class RuleRouter implements SkillActivationRouter {
  search(query: string, skills: SkillManifest[], options?: SkillSearchOptions): SkillSearchResult[] {
    return searchSkills(query, skills, options);
  }

  route(input: SkillRouteInput): ActivationDecision {
    const candidates = this.search(input.query, input.skills, input.options);
    return createActivationDecision(input.query, candidates);
  }
}

export class EmbeddingRouter implements SkillActivationRouter {
  constructor(private readonly options: EmbeddingRouterOptions = {}) {}

  async search(query: string, skills: SkillManifest[], options?: SkillSearchOptions): Promise<SkillSearchResult[]> {
    if (!this.options.search) {
      return [];
    }

    return this.options.search({ query, skills, options });
  }

  async route(input: SkillRouteInput): Promise<ActivationDecision> {
    const candidates = await this.search(input.query, input.skills, input.options);
    if (candidates.length === 0 && !this.options.search) {
      return {
        runId: "",
        query: input.query,
        selected: false,
        candidates: [],
        confidence: 0,
        reason: "EmbeddingRouter is not configured.",
        systemPatch: "",
        allowedTools: [],
        nextActions: ["none"],
        requiredResources: [],
        requiredTools: [],
      };
    }

    return createActivationDecision(input.query, candidates);
  }
}

export class PolicyFilter implements SkillCandidateFilter {
  constructor(private readonly options: PolicyFilterOptions = {}) {}

  filter(input: SkillRerankInput): SkillSearchResult[] {
    if (this.options.allowUntrusted) {
      return input.candidates;
    }

    return input.candidates.filter((candidate) => {
      const trust = candidate.skill.rawFrontmatter?.trust ?? candidate.skill.frontmatter.trust;
      return trust !== "untrusted";
    });
  }
}

export class LlmRerankRouter implements SkillActivationRouter, SkillReranker {
  constructor(private readonly options: LlmRerankRouterOptions = {}) {}

  async rerank(input: SkillRerankInput): Promise<SkillSearchResult[]> {
    if (!this.options.rerank) {
      return input.candidates;
    }

    return this.options.rerank(input);
  }

  async search(): Promise<SkillSearchResult[]> {
    return [];
  }

  async route(input: SkillRouteInput): Promise<ActivationDecision> {
    const candidates = input.candidates ?? [];
    const reranked = await this.rerank({ ...input, candidates });
    if (reranked.length === 0 && !this.options.rerank) {
      return {
        runId: "",
        query: input.query,
        selected: false,
        candidates: [],
        confidence: 0,
        reason: "LlmRerankRouter requires candidates from a retrieval router.",
        systemPatch: "",
        allowedTools: [],
        nextActions: ["none"],
        requiredResources: [],
        requiredTools: [],
      };
    }

    return createActivationDecision(input.query, reranked);
  }
}

export class LlmRouter extends LlmRerankRouter {}

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
  routerOrPipeline: SkillRouter | SkillRoutePipelineOptions = new RuleRouter(),
): Promise<ActivationDecision> | ActivationDecision {
  const pipeline = "search" in routerOrPipeline ? { router: routerOrPipeline } : routerOrPipeline;
  const router = pipeline.router ?? new RuleRouter();
  const result = routeSkillsWithTrace(query, skills, options, {
    router,
    policyFilter: pipeline.policyFilter,
    reranker: pipeline.reranker,
  });

  if (result instanceof Promise) {
    return result.then((resolved) => resolved.decision);
  }

  return result.decision;
}

export function routeSkillsWithTrace(
  query: string,
  skills: SkillManifest[],
  options: SkillSearchOptions = {},
  pipeline: SkillRoutePipelineOptions = {},
): Promise<SkillRoutePipelineResult> | SkillRoutePipelineResult {
  const router = pipeline.router ?? new RuleRouter();
  const policyFilter = pipeline.policyFilter ?? new PolicyFilter();

  const buildResult = (
    retrieved: SkillSearchResult[],
    policyFiltered: SkillSearchResult[],
    reranked: SkillSearchResult[],
  ): SkillRoutePipelineResult => ({
    decision: createActivationDecision(query, reranked),
    trace: {
      retrieved,
      policyFiltered,
      reranked,
    },
  });

  const applyReranker = (
    retrieved: SkillSearchResult[],
    policyFiltered: SkillSearchResult[],
  ): Promise<SkillRoutePipelineResult> | SkillRoutePipelineResult => {
    if (!pipeline.reranker) {
      return buildResult(retrieved, policyFiltered, policyFiltered);
    }

    const reranked = pipeline.reranker.rerank({ query, skills, options, candidates: policyFiltered });
    if (reranked instanceof Promise) {
      return reranked.then((resolved) => buildResult(retrieved, policyFiltered, resolved));
    }

    return buildResult(retrieved, policyFiltered, reranked);
  };

  const applyPolicyFilter = (
    retrieved: SkillSearchResult[],
  ): Promise<SkillRoutePipelineResult> | SkillRoutePipelineResult => {
    const policyFiltered = policyFilter.filter({ query, skills, options, candidates: retrieved });
    if (policyFiltered instanceof Promise) {
      return policyFiltered.then((resolved) => applyReranker(retrieved, resolved));
    }

    return applyReranker(retrieved, policyFiltered);
  };

  const retrieved = router.search(query, skills, options);
  if (retrieved instanceof Promise) {
    return retrieved.then(applyPolicyFilter);
  }

  return applyPolicyFilter(retrieved);
}
