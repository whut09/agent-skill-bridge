import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { SkillBridgeRuntime } from "@skillbridge/core";
import path from "node:path";

export type SkillBridgeMcpServerOptions = {
  skillDirs: string[];
  enableScripts?: boolean;
  debug?: boolean;
};

export function createMcpServer(options: SkillBridgeMcpServerOptions) {
  const runtime = new SkillBridgeRuntime(options.skillDirs);
  const server = new McpServer({
    name: "agent-skill-bridge",
    version: "0.1.0",
  });

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

  server.tool(
    "skillbridge_search_skills",
    { query: z.string() },
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

  server.tool(
    "skillbridge_activate_skill",
    { query: z.string() },
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
                toolInstructions: prepared.toolInstructions,
              },
              options.debug,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    "skillbridge_read_skill",
    {
      skillName: z.string().optional(),
      skillPath: z.string().optional().describe("Deprecated. Use skillName instead; scheduled for removal in v0.2."),
    },
    async ({ skillName, skillPath }) => {
      const skill = await resolveSkill(runtime, skillName as string | undefined, skillPath as string | undefined);
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
      skillName: z.string().optional(),
      skillPath: z.string().optional().describe("Deprecated. Use skillName instead; scheduled for removal in v0.2."),
    },
    async ({ skillName, skillPath }) => {
      const skill = await resolveSkill(runtime, skillName as string | undefined, skillPath as string | undefined);
      const resources = [...skill.references, ...skill.scripts, ...skill.assets];

      return {
        content: [{ type: "text", text: stringifyResult(resources, options.debug) }],
      };
    },
  );

  server.tool(
    "skillbridge_read_resource",
    {
      skillName: z.string().optional(),
      skillPath: z.string().optional().describe("Deprecated. Use skillName instead; scheduled for removal in v0.2."),
      resourcePath: z.string(),
    },
    async ({ skillName, skillPath, resourcePath }) => {
      const skill = await resolveSkill(runtime, skillName as string | undefined, skillPath as string | undefined);
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
      skillName: z.string().optional(),
      skillPath: z.string().optional().describe("Deprecated. Use skillName instead; scheduled for removal in v0.2."),
      scriptPath: z.string(),
      enableScripts: z.boolean().optional(),
      timeoutMs: z.number().optional(),
      args: z.array(z.string()).optional(),
    },
    async ({ skillName, skillPath, scriptPath, enableScripts, timeoutMs, args }) => {
      if (options.enableScripts !== true || enableScripts !== true) {
        throw new Error("run_script is disabled by default. Pass enableScripts=true to allow execution.");
      }

      const skill = await resolveSkill(runtime, skillName as string | undefined, skillPath as string | undefined);
      const result = await runtime.runScript({
        skill,
        scriptPath: scriptPath as string,
        enableScripts: true,
        timeoutMs: timeoutMs as number | undefined,
        args: (args as string[] | undefined) ?? [],
      });

      return {
        content: [{ type: "text", text: stringifyResult(result, options.debug) }],
      };
    },
  );

  return { server, runtime };
}

async function ensureRuntimeInitialized(runtime: SkillBridgeRuntime) {
  return runtime.init();
}

async function resolveSkill(runtime: SkillBridgeRuntime, skillName?: string, deprecatedSkillPath?: string) {
  const { skills } = await ensureRuntimeInitialized(runtime);

  if (skillName) {
    const skill = runtime.getSkillByName(skillName);
    if (!skill) {
      throw new Error(`Skill not found by name: ${skillName}`);
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

  throw new Error("skillName is required. Deprecated skillPath is still accepted until v0.2.");
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
  const { server } = createMcpServer(options);
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
