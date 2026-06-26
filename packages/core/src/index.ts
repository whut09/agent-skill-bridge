export type SkillResource = {
  path: string;
  content: string;
};

export type SkillPackage = {
  name: string;
  description: string;
  path: string;
  resources: SkillResource[];
};

export type RuntimeTraceEvent = {
  type: string;
  message: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
};

export function createRuntimeTraceEvent(
  type: string,
  message: string,
  metadata?: Record<string, unknown>,
): RuntimeTraceEvent {
  return {
    type,
    message,
    timestamp: new Date().toISOString(),
    metadata,
  };
}

export function createSkillPackage(input: {
  name: string;
  description: string;
  path: string;
  resources?: SkillResource[];
}): SkillPackage {
  return {
    name: input.name,
    description: input.description,
    path: input.path,
    resources: input.resources ?? [],
  };
}
