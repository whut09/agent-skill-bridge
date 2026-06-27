export type SkillResource = {
  path: string;
  content: string;
};

export type SkillManifest = {
  name: string;
  description: string;
  version?: string;
  license?: string;
  author?: string;
  compatibility?: {
    agents?: string[];
    runtimes?: string[];
    models?: string[];
  };
  allowedTools?: string[];
  deniedTools?: string[];
  permissions?: {
    read?: string[];
    write?: string[];
    network?: boolean;
    execute?: boolean;
  };
  entrypoints?: {
    default?: string;
    tools?: Record<string, string>;
  };
  path: string;
  frontmatter: Record<string, unknown>;
  rawFrontmatter?: Record<string, unknown>;
  metadata?: {
    keywords?: string[];
    domains?: string[];
    taskTypes?: string[];
  };
  resources?: SkillResource[];
  references: string[];
  scripts: string[];
  assets: string[];
};

export type SkillSearchResult = {
  skill: SkillManifest;
  score: number;
  reason: string[];
};

export type ActivationDecision = {
  selected: boolean;
  skill?: SkillManifest;
  candidates: SkillSearchResult[];
  confidence: number;
  reason: string;
  requiredResources: string[];
  requiredTools: string[];
};

export type ResourceFileMetadata = {
  path: string;
  size: number;
  mimeType: string;
  extension: string;
  isText: boolean;
  modifiedAt: string;
};

export type ResourceManagerTextResult = {
  type: "text";
  path: string;
  content: string;
  metadata: ResourceFileMetadata;
};

export type ResourceManagerBinaryResult = {
  type: "binary";
  path: string;
  content: Buffer;
  metadata: ResourceFileMetadata;
};

export type ResourceManagerResult = ResourceManagerTextResult | ResourceManagerBinaryResult;

export type ResourceManagerInput = {
  skillPath: string;
  resourcePath: string;
};

export type LocalScriptExecutorInput = {
  skillPath: string;
  scriptPath: string;
  enableScripts?: boolean;
  timeoutMs?: number;
  args?: string[];
};

export type LocalScriptExecutorResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
};

export type SkillContextInput = {
  query?: string;
  skills: SkillManifest[];
  selectedSkill?: SkillManifest;
  skillBodies?: Record<string, string>;
  budget?: number;
};

export type SkillContext = {
  catalog: string;
  systemPatch: string;
  progressiveLoading: {
    level0: {
      loaded: true;
      fields: string[];
    };
    level1?: {
      loaded: true;
      skillName: string;
      source: "SKILL.md";
    };
    level2: {
      loaded: false;
      references: string[];
    };
    level3: {
      loaded: false;
      scripts: string[];
      assets: string[];
    };
  };
  selectedSkill?: {
    name: string;
    description: string;
    body?: string;
    references: string[];
    scripts: string[];
    assets: string[];
  };
};

export type SkillBridgeMessage = {
  role: string;
  content: string;
};

export type SkillBridgePrepareInput = {
  messages: SkillBridgeMessage[];
  userMessage: string;
  budget?: number;
};

export type SkillBridgePrepareOutput = SkillContext & {
  activeSkills: SkillSearchResult[];
  activationDecision: ActivationDecision;
  toolInstructions: string;
};

export type SkillBridgeRuntimeInitResult = {
  skills: SkillManifest[];
};

export type SkillBridgeRuntimeRunScriptInput = Omit<LocalScriptExecutorInput, "skillPath" | "scriptPath"> & {
  skill: SkillManifest;
  scriptPath: string;
};

export type RuntimeTraceEvent = {
  type: string;
  message: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
};
