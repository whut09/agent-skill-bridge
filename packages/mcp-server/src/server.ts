import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  SkillBridgeRuntime,
  createRuntimePolicyFromConfig,
  loadSkillBridgePolicy,
  type SkillBridgePolicyConfig,
} from "@skillbridge/core";
import path from "node:path";
import type { ResourceManagerResult } from "@skillbridge/core";

export type SkillBridgeMcpServerOptions = {
  skillDirs: string[];
  enableScripts?: boolean;
  debug?: boolean;
  policy?: SkillBridgePolicyConfig;
};

export function createMcpServer(options: SkillBridgeMcpServerOptions) {
  const runtime = new SkillBridgeRuntime(options.skillDirs, createRuntimePolicyFromConfig(options.policy ?? {}));
  const server = new McpServer({
    name: "agent-skill-bridge",
    version: "0.1.0",
  });

  registerNativeTools(server, runtime, options);
  registerNativeResources(server, runtime);
  registerNativePrompts(server);
  registerLegacyTools(server, runtime, options);

  return { server, runtime };
}

export async function createMcpServerWithLoadedPolicy(options: SkillBridgeMcpServerOptions) {
  const { config } = await loadSkillBridgePolicy([...options.skillDirs, process.cwd()]);
  return createMcpServer({ ...options, policy: options.policy ?? config });
}

function registerNativeTools(
  server: McpServer,
  runtime: SkillBridgeRuntime,
  options: SkillBridgeMcpServerOptions,
): void {
  server.registerTool(
    "skillbridge.search",
    {
      title: "Search Skills",
      description: "Search available skills for a user task.",
      inputSchema: { query: z.string() },
    },
    async ({ query }) => {
      const prepared = await runtime.prepare({ messages: [], userMessage: query as string });
      return {
        content: [
          {
            type: "text",
            text: stringifyResult(prepared.activeSkills, options.debug),
          },
        ],
      };
    },
  );

  server.registerTool(
    "skillbridge.activate",
    {
      title: "Activate Skill",
      description: "Route a user task, load the selected SKILL.md body, and return runtime context.",
      inputSchema: { query: z.string() },
    },
    async ({ query }) => {
      const prepared = await runtime.prepare({ messages: [], userMessage: query as string });
      return {
        content: [
          {
            type: "text",
            text: stringifyResult(
              {
                activeSkills: prepared.activeSkills,
                systemPatch: prepared.systemPatch,
                progressiveLoading: prepared.progressiveLoading,
                toolInstructions: prepared.toolInstructions,
              },
              options.debug,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    "skillbridge.run_script",
    {
      title: "Run Skill Script",
      description:
        "Run a script from the selected skill scripts directory. Disabled unless scripts are explicitly enabled.",
      inputSchema: {
        skillId: z.string(),
        skillName: z.string().optional().describe("Deprecated. Use skillId instead; scheduled for removal in v0.2."),
        scriptPath: z.string(),
        enableScripts: z.boolean().optional(),
        timeoutMs: z.number().optional(),
        args: z.array(z.string()).optional(),
      },
    },
    async ({ skillId, skillName, scriptPath, enableScripts, timeoutMs, args }) => {
      const result = await runScriptTool(runtime, options, {
        skillId: skillId as string,
        skillName: skillName as string | undefined,
        scriptPath: scriptPath as string,
        enableScripts: enableScripts as boolean | undefined,
        timeoutMs: timeoutMs as number | undefined,
        args: args as string[] | undefined,
      });

      return {
        content: [{ type: "text", text: stringifyResult(result, options.debug) }],
      };
    },
  );
}

function registerNativeResources(server: McpServer, runtime: SkillBridgeRuntime): void {
  const completion = {
    skillId: async (value: string) => {
      const { skills } = await ensureRuntimeInitialized(runtime);
      const normalizedValue = value.toLowerCase();
      return skills.map((skill) => skill.id).filter((id) => id.toLowerCase().includes(normalizedValue));
    },
  };

  server.registerResource(
    "skillbridge-skill-md",
    new ResourceTemplate("skill://{skillId}/SKILL.md", {
      list: async () => ({
        resources: (await ensureRuntimeInitialized(runtime)).skills.map((skill) => ({
          uri: toSkillUri(skill.id, "SKILL.md"),
          name: `${skill.name} SKILL.md`,
          title: `${skill.name} SKILL.md`,
          description: skill.description,
          mimeType: "text/markdown",
        })),
      }),
      complete: completion,
    }),
    {
      title: "Skill Instructions",
      description: "Selected skill SKILL.md files.",
      mimeType: "text/markdown",
    },
    async (uri, variables) => readSkillResourceUri(runtime, uri, variables.skillId as string, "SKILL.md"),
  );

  server.registerResource(
    "skillbridge-reference",
    new ResourceTemplate("skill://{skillId}/references/{file}", {
      list: async () => listSkillResources(runtime, "references"),
      complete: completion,
    }),
    {
      title: "Skill References",
      description: "Reference files exposed by skills.",
    },
    async (uri, variables) =>
      readSkillResourceUri(runtime, uri, variables.skillId as string, `references/${variables.file as string}`),
  );

  server.registerResource(
    "skillbridge-asset",
    new ResourceTemplate("skill://{skillId}/assets/{file}", {
      list: async () => listSkillResources(runtime, "assets"),
      complete: completion,
    }),
    {
      title: "Skill Assets",
      description: "Asset files exposed by skills.",
    },
    async (uri, variables) =>
      readSkillResourceUri(runtime, uri, variables.skillId as string, `assets/${variables.file as string}`),
  );
}

function registerNativePrompts(server: McpServer): void {
  server.registerPrompt(
    "skillbridge-use-skill",
    {
      title: "Use SkillBridge Skill",
      description: "Ask an agent to activate and use the best SkillBridge skill for a task.",
      argsSchema: {
        task: z.string(),
      },
    },
    ({ task }) => ({
      description: "Activate a skill and follow SkillBridge progressive loading.",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Task: ${task}`,
              "",
              "Use skillbridge.activate to select the best skill.",
              "Load reference resources only when the selected SKILL.md instructions make them necessary.",
              "Run scripts only when explicitly needed and allowed.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "skillbridge-debug-skill",
    {
      title: "Debug SkillBridge Skill",
      description: "Inspect why a skill was or was not selected for a task.",
      argsSchema: {
        task: z.string(),
      },
    },
    ({ task }) => ({
      description: "Debug SkillBridge routing and progressive loading.",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Task: ${task}`,
              "",
              "Use skillbridge.search to inspect candidates and scores.",
              "Use skillbridge.activate to inspect the selected systemPatch and progressiveLoading metadata.",
              "Explain routing confidence, missing keywords, and which resources would be read next.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "skillbridge-create-skill",
    {
      title: "Create SkillBridge Skill",
      description: "Draft a compatible SKILL.md package layout for a new skill.",
      argsSchema: {
        skillName: z.string(),
        goal: z.string(),
      },
    },
    ({ skillName, goal }) => ({
      description: "Create a progressive SkillBridge skill package.",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Skill name: ${skillName}`,
              `Goal: ${goal}`,
              "",
              "Draft a SKILL.md with name, description, metadata.keywords, permissions, and concise operating instructions.",
              "Suggest references/, scripts/, and assets/ files only when they support progressive loading.",
            ].join("\n"),
          },
        },
      ],
    }),
  );
}

function registerLegacyTools(
  server: McpServer,
  runtime: SkillBridgeRuntime,
  options: SkillBridgeMcpServerOptions,
): void {
  server.tool("skillbridge_list_skills", {}, async () => {
    const { skills } = await runtime.init();
    return {
      content: [
        {
          type: "text",
          text: stringifyResult(skills, options.debug),
        },
      ],
    };
  });

  server.tool("skillbridge_search_skills", { query: z.string() }, async ({ query }) => {
    const prepared = await runtime.prepare({ messages: [], userMessage: query as string });
    return {
      content: [
        {
          type: "text",
          text: stringifyResult(prepared.activeSkills, options.debug),
        },
      ],
    };
  });

  server.tool("skillbridge_activate_skill", { query: z.string() }, async ({ query }) => {
    const prepared = await runtime.prepare({ messages: [], userMessage: query as string });
    return {
      content: [
        {
          type: "text",
          text: stringifyResult(
            {
              activeSkills: prepared.activeSkills,
              systemPatch: prepared.systemPatch,
              toolInstructions: prepared.toolInstructions,
            },
            options.debug,
          ),
        },
      ],
    };
  });

  server.tool(
    "skillbridge_read_skill",
    {
      skillId: z.string().optional(),
      skillName: z.string().optional(),
      skillPath: z.string().optional().describe("Deprecated. Use skillId instead; scheduled for removal in v0.2."),
    },
    async ({ skillId, skillName, skillPath }) => {
      const skill = await resolveSkill(
        runtime,
        skillId as string | undefined,
        skillName as string | undefined,
        skillPath as string | undefined,
      );
      const resource = await runtime.readResource({
        skillPath: skill.path,
        resourcePath: "SKILL.md",
      });
      return {
        content: [{ type: "text", text: stringifyResult(resource, options.debug) }],
      };
    },
  );

  server.tool(
    "skillbridge_list_resources",
    {
      skillId: z.string().optional(),
      skillName: z.string().optional(),
      skillPath: z.string().optional().describe("Deprecated. Use skillId instead; scheduled for removal in v0.2."),
    },
    async ({ skillId, skillName, skillPath }) => {
      const skill = await resolveSkill(
        runtime,
        skillId as string | undefined,
        skillName as string | undefined,
        skillPath as string | undefined,
      );
      const resources = [...skill.references, ...skill.scripts, ...skill.assets];

      return {
        content: [{ type: "text", text: stringifyResult(resources, options.debug) }],
      };
    },
  );

  server.tool(
    "skillbridge_read_resource",
    {
      skillId: z.string().optional(),
      skillName: z.string().optional(),
      skillPath: z.string().optional().describe("Deprecated. Use skillId instead; scheduled for removal in v0.2."),
      resourcePath: z.string(),
    },
    async ({ skillId, skillName, skillPath, resourcePath }) => {
      const skill = await resolveSkill(
        runtime,
        skillId as string | undefined,
        skillName as string | undefined,
        skillPath as string | undefined,
      );
      const resource = await runtime.readResource({
        skillPath: skill.path,
        resourcePath: resourcePath as string,
      });
      return {
        content: [{ type: "text", text: stringifyResult(resource, options.debug) }],
      };
    },
  );

  server.tool(
    "skillbridge_run_script",
    {
      skillId: z.string().optional(),
      skillName: z.string().optional(),
      skillPath: z.string().optional().describe("Deprecated. Use skillId instead; scheduled for removal in v0.2."),
      scriptPath: z.string(),
      enableScripts: z.boolean().optional(),
      timeoutMs: z.number().optional(),
      args: z.array(z.string()).optional(),
    },
    async ({ skillId, skillName, skillPath, scriptPath, enableScripts, timeoutMs, args }) => {
      const result = await runScriptTool(runtime, options, {
        skillId: skillId as string | undefined,
        skillName: skillName as string | undefined,
        skillPath: skillPath as string | undefined,
        scriptPath: scriptPath as string,
        enableScripts: enableScripts as boolean | undefined,
        timeoutMs: timeoutMs as number | undefined,
        args: (args as string[] | undefined) ?? [],
      });

      return {
        content: [{ type: "text", text: stringifyResult(result, options.debug) }],
      };
    },
  );
}

async function ensureRuntimeInitialized(runtime: SkillBridgeRuntime) {
  return runtime.init();
}

async function listSkillResources(runtime: SkillBridgeRuntime, kind: "references" | "assets") {
  const { skills } = await ensureRuntimeInitialized(runtime);
  const resources = skills.flatMap((skill) => {
    const paths = kind === "references" ? skill.references : skill.assets;
    return paths.map((resourcePath) => ({
      uri: toSkillUri(skill.id, resourcePath),
      name: `${skill.name} ${resourcePath}`,
      title: `${skill.name}: ${resourcePath}`,
      description: kind === "references" ? skill.description : `Asset from ${skill.name}`,
    }));
  });

  return { resources };
}

async function readSkillResourceUri(runtime: SkillBridgeRuntime, uri: URL, skillId: string, resourcePath: string) {
  const skill = await resolveSkill(runtime, decodeURIComponent(skillId));
  const resource = await runtime.readResource({
    skillPath: skill.path,
    resourcePath: decodeResourcePath(resourcePath),
  });

  return {
    contents: [toMcpResourceContent(uri.toString(), resource)],
  };
}

async function runScriptTool(
  runtime: SkillBridgeRuntime,
  options: SkillBridgeMcpServerOptions,
  input: {
    skillId?: string;
    skillName?: string;
    skillPath?: string;
    scriptPath: string;
    enableScripts?: boolean;
    timeoutMs?: number;
    args?: string[];
  },
) {
  const scriptsEnabled = options.enableScripts === true || options.policy?.scripts?.enabled === true;
  if (!scriptsEnabled && input.enableScripts !== true) {
    throw new Error("run_script is disabled by default. Pass enableScripts=true to allow execution.");
  }

  const skill = await resolveSkill(runtime, input.skillId, input.skillName, input.skillPath);
  return runtime.runScript({
    skill,
    scriptPath: input.scriptPath,
    enableScripts: input.enableScripts ?? options.policy?.scripts?.enabled ?? options.enableScripts,
    timeoutMs: input.timeoutMs,
    args: input.args ?? [],
  });
}

async function resolveSkill(
  runtime: SkillBridgeRuntime,
  skillId?: string,
  deprecatedSkillName?: string,
  deprecatedSkillPath?: string,
) {
  const { skills } = await ensureRuntimeInitialized(runtime);

  if (skillId) {
    const skill = runtime.getSkillById(skillId);
    if (!skill) {
      throw new Error(`Skill not found by id: ${skillId}`);
    }

    return skill;
  }

  if (deprecatedSkillName) {
    const skill = runtime.getSkillByName(deprecatedSkillName);
    if (!skill) {
      throw new Error(`Skill not found by deprecated skillName: ${deprecatedSkillName}`);
    }

    return skill;
  }

  if (deprecatedSkillPath) {
    const normalizedDeprecatedPath = path.resolve(deprecatedSkillPath);
    const skill = skills.find((manifest) => path.resolve(manifest.path) === normalizedDeprecatedPath);
    if (!skill) {
      throw new Error(`Skill not found by deprecated skillPath: ${deprecatedSkillPath}`);
    }

    return skill;
  }

  throw new Error("skillId is required. Deprecated skillName and skillPath are still accepted until v0.2.");
}

function toSkillUri(skillId: string, resourcePath: string): string {
  const normalizedResourcePath = resourcePath.split(path.sep).join("/");
  if (normalizedResourcePath === "SKILL.md") {
    return `skill://${encodeURIComponent(skillId)}/SKILL.md`;
  }

  const [firstSegment, ...rest] = normalizedResourcePath.split("/");
  return `skill://${encodeURIComponent(skillId)}/${firstSegment}/${encodeURIComponent(rest.join("/"))}`;
}

function decodeResourcePath(resourcePath: string): string {
  return decodeURIComponent(resourcePath).split("\\").join("/");
}

function toMcpResourceContent(uri: string, resource: ResourceManagerResult) {
  if (resource.type === "text") {
    return {
      uri,
      mimeType: resource.metadata.mimeType,
      text: resource.content,
    };
  }

  return {
    uri,
    mimeType: resource.metadata.mimeType,
    blob: resource.content.toString("base64"),
  };
}

function stringifyResult(value: unknown, debug?: boolean): string {
  return JSON.stringify(debug ? value : hideAbsolutePaths(value), null, 2);
}

function hideAbsolutePaths(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => hideAbsolutePaths(entry));
  }

  if (!value || typeof value !== "object" || Buffer.isBuffer(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      key === "path" && typeof entry === "string" ? toSafeDisplayPath(entry) : hideAbsolutePaths(entry),
    ]),
  );
}

function toSafeDisplayPath(candidatePath: string): string {
  if (!path.isAbsolute(candidatePath)) {
    return candidatePath;
  }

  const relativePath = path.relative(process.cwd(), candidatePath);
  if (!relativePath.startsWith("..") && !path.isAbsolute(relativePath)) {
    return relativePath.split(path.sep).join("/");
  }

  return path.basename(candidatePath);
}

export async function runMcpServer(options: SkillBridgeMcpServerOptions): Promise<void> {
  const { server } = await createMcpServerWithLoadedPolicy(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export function parseCliArgs(argv: string[]): SkillBridgeMcpServerOptions {
  const skillDirs: string[] = [];
  let enableScripts = false;
  let debug = false;

  for (let index = 2; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--skill-dir") {
      const nextValue = argv[index + 1];
      if (nextValue) {
        skillDirs.push(nextValue);
        index += 1;
      }
      continue;
    }

    if (argument === "--enable-scripts") {
      enableScripts = true;
      continue;
    }

    if (argument === "--debug") {
      debug = true;
    }
  }

  return { skillDirs, enableScripts, debug };
}

if (process.argv[1]?.endsWith("server.js") || process.argv[1]?.endsWith("server.ts")) {
  const options = parseCliArgs(process.argv);
  void runMcpServer(options);
}
