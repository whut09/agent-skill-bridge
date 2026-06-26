import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  SkillBridgeRuntime,
  type ResourceManagerInput,
} from "../../core/src/index.js";

export type SkillBridgeMcpServerOptions = {
  skillDirs: string[];
  enableScripts?: boolean;
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
          text: JSON.stringify(skills, null, 2),
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
            text: JSON.stringify(prepared.activeSkills, null, 2),
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
            text: JSON.stringify(
              {
                activeSkills: prepared.activeSkills,
                systemPatch: prepared.systemPatch,
                toolInstructions: prepared.toolInstructions,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    "skillbridge_read_skill",
    { skillPath: z.string() },
    async ({ skillPath }) => {
      const skill = await runtime.readResource({
        skillPath: skillPath as string,
        resourcePath: "SKILL.md",
      });
      return {
        content: [{ type: "text", text: JSON.stringify(skill, null, 2) }],
      };
    },
  );

  server.tool(
    "skillbridge_list_resources",
    { skillPath: z.string() },
    async ({ skillPath }) => {
      const skill = await runtime.init();
      const selected = skill.skills.find((manifest) => manifest.path === (skillPath as string));
      const resources = selected
        ? [...selected.references, ...selected.scripts, ...selected.assets]
        : [];

      return {
        content: [{ type: "text", text: JSON.stringify(resources, null, 2) }],
      };
    },
  );

  server.tool(
    "skillbridge_read_resource",
    { skillPath: z.string(), resourcePath: z.string() },
    async ({ skillPath, resourcePath }) => {
      const resource = await runtime.readResource({
        skillPath: skillPath as string,
        resourcePath: resourcePath as string,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(resource, null, 2) }],
      };
    },
  );

  server.tool(
    "skillbridge_run_script",
    {
      skillPath: z.string(),
      scriptPath: z.string(),
      enableScripts: z.boolean().optional(),
      timeoutMs: z.number().optional(),
      args: z.array(z.string()).optional(),
    },
    async ({ skillPath, scriptPath, enableScripts, timeoutMs, args }) => {
      if (options.enableScripts !== true || enableScripts !== true) {
        throw new Error("run_script is disabled by default. Pass enableScripts=true to allow execution.");
      }

      const skill = skillPath as string;
      const result = await runtime.runScript({
        skill: {
          name: pathBaseName(skill),
          description: "MCP skill",
          path: skill,
          frontmatter: {},
          references: [],
          scripts: [],
          assets: [],
        },
        scriptPath: scriptPath as string,
        enableScripts: true,
        timeoutMs: timeoutMs as number | undefined,
        args: (args as string[] | undefined) ?? [],
      });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  return { server, runtime };
}

function pathBaseName(input: string): string {
  return input.split(/[\\/]/u).filter(Boolean).pop() ?? input;
}

export async function runMcpServer(options: SkillBridgeMcpServerOptions): Promise<void> {
  const { server } = createMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export function parseCliArgs(argv: string[]): SkillBridgeMcpServerOptions {
  const skillDirs: string[] = [];
  let enableScripts = false;

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
    }
  }

  return { skillDirs, enableScripts };
}

if (process.argv[1]?.endsWith("server.js") || process.argv[1]?.endsWith("server.ts")) {
  const options = parseCliArgs(process.argv);
  void runMcpServer(options);
}
