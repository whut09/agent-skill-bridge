import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  SkillBridgeRuntime,
  type LocalScriptExecutorResult,
  type ResourceManagerResult,
  type SkillBridgeMessage,
  type SkillManifest,
} from "@skillbridge/core";
import { randomUUID } from "node:crypto";

export type OpenAIProxyOptions = {
  targetBaseUrl?: string;
  targetApiKey?: string;
  skillDirs?: string[];
  fetchImpl?: typeof fetch;
  mode?: OpenAIProxyMode;
  maxToolIterations?: number;
  enableScripts?: boolean;
};

export type OpenAIProxyMode = "prompt" | "tools" | "loop";

export type OpenAIChatCompletionRequest = {
  messages?: OpenAIChatMessage[];
  stream?: boolean;
  tools?: OpenAITool[];
  [key: string]: unknown;
};

export type OpenAIChatMessage = SkillBridgeMessage & {
  tool_call_id?: string;
  tool_calls?: OpenAIToolCall[];
};

type OpenAITool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

type OpenAIToolCall = {
  id: string;
  type?: "function";
  function?: {
    name?: string;
    arguments?: string;
  };
};

type OpenAIChatCompletionResponse = {
  choices?: Array<{
    message?: OpenAIChatMessage;
  }>;
  [key: string]: unknown;
};

const skillBridgeTools: OpenAITool[] = [
  {
    type: "function",
    function: {
      name: "skillbridge_read_resource",
      description: "Read a resource file from a named skill package.",
      parameters: {
        type: "object",
        properties: {
          skillName: { type: "string", description: "The skill name." },
          resourcePath: { type: "string", description: "Path inside the skill package." },
        },
        required: ["skillName", "resourcePath"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "skillbridge_run_script",
      description: "Run a script from a named skill package. Disabled unless explicitly enabled.",
      parameters: {
        type: "object",
        properties: {
          skillName: { type: "string", description: "The skill name." },
          scriptPath: { type: "string", description: "Path under scripts/ inside the skill package." },
          args: { type: "array", items: { type: "string" } },
          timeoutMs: { type: "number" },
        },
        required: ["skillName", "scriptPath"],
      },
    },
  },
];

function getEnvSkillDirs(): string[] {
  const rawSkillDir = process.env.SKILLBRIDGE_SKILL_DIR;
  if (!rawSkillDir) {
    return [];
  }

  return rawSkillDir.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  response.writeHead(statusCode, { "content-type": "application/json", ...headers });
  response.end(JSON.stringify(body));
}

function findLastUserMessage(messages: SkillBridgeMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user") {
      return message.content;
    }
  }

  return "";
}

function wrapSystemPatch(systemPatch: string): string {
  return `<skillbridge_runtime>\n${systemPatch}\n</skillbridge_runtime>`;
}

function injectSystemPatch(messages: SkillBridgeMessage[], systemPatch: string): SkillBridgeMessage[] {
  if (!systemPatch) {
    return messages;
  }

  const wrappedSystemPatch = wrapSystemPatch(systemPatch);
  const firstSystemIndex = messages.findIndex((message) => message.role === "system");

  if (firstSystemIndex === -1) {
    return [{ role: "system", content: wrappedSystemPatch }, ...messages];
  }

  return messages.map((message, index) =>
    index === firstSystemIndex
      ? {
          ...message,
          content: `${message.content}\n\n${wrappedSystemPatch}`,
        }
      : message,
  );
}

function appendSkillBridgeTools(tools: OpenAITool[] | undefined): OpenAITool[] {
  const existingTools = tools ?? [];
  const existingNames = new Set(existingTools.map((tool) => tool.function.name));
  const missingTools = skillBridgeTools.filter((tool) => !existingNames.has(tool.function.name));
  return [...existingTools, ...missingTools];
}

function readProxyMode(value: unknown): OpenAIProxyMode {
  if (value === "prompt" || value === "tools" || value === "loop") {
    return value;
  }

  return "loop";
}

function shouldExposeTools(mode: OpenAIProxyMode): boolean {
  return mode === "tools" || mode === "loop";
}

function shouldExecuteToolLoop(mode: OpenAIProxyMode): boolean {
  return mode === "loop";
}

function getToolCalls(body: OpenAIChatCompletionResponse): OpenAIToolCall[] {
  return body.choices?.flatMap((choice) => choice.message?.tool_calls ?? []) ?? [];
}

function parseToolArguments(rawArguments: string | undefined): Record<string, unknown> {
  if (!rawArguments) {
    return {};
  }

  const parsed = JSON.parse(rawArguments) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Tool arguments must be a JSON object.");
  }

  return parsed as Record<string, unknown>;
}

function getStringArgument(argumentsObject: Record<string, unknown>, key: string): string {
  const value = argumentsObject[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing required tool argument: ${key}`);
  }

  return value;
}

function resolveSkill(runtime: SkillBridgeRuntime, skillName: string): SkillManifest {
  const skill = runtime.getSkillByName(skillName);
  if (!skill) {
    throw new Error(`Skill not found by name: ${skillName}`);
  }

  return skill;
}

function normalizeToolResult(result: ResourceManagerResult | LocalScriptExecutorResult): unknown {
  if ("type" in result && result.type === "binary") {
    return {
      ...result,
      content: result.content.toString("base64"),
      encoding: "base64",
    };
  }

  return result;
}

async function executeSkillBridgeTool(
  runtime: SkillBridgeRuntime,
  toolCall: OpenAIToolCall,
  enableScripts: boolean,
): Promise<OpenAIChatMessage> {
  const toolName = toolCall.function?.name;
  const toolArguments = parseToolArguments(toolCall.function?.arguments);

  let result: unknown;
  if (toolName === "skillbridge_read_resource") {
    const skill = resolveSkill(runtime, getStringArgument(toolArguments, "skillName"));
    result = normalizeToolResult(
      await runtime.readResource({
        skillPath: skill.path,
        resourcePath: getStringArgument(toolArguments, "resourcePath"),
      }),
    );
  } else if (toolName === "skillbridge_run_script") {
    const skill = resolveSkill(runtime, getStringArgument(toolArguments, "skillName"));
    const args = Array.isArray(toolArguments.args)
      ? toolArguments.args.filter((entry): entry is string => typeof entry === "string")
      : [];
    const timeoutMs = typeof toolArguments.timeoutMs === "number" ? toolArguments.timeoutMs : undefined;
    result = await runtime.runScript({
      skill,
      scriptPath: getStringArgument(toolArguments, "scriptPath"),
      enableScripts,
      timeoutMs,
      args,
    });
  } else {
    throw new Error(`Unsupported tool call: ${toolName ?? "unknown"}`);
  }

  return {
    role: "tool",
    tool_call_id: toolCall.id,
    content: JSON.stringify(result),
  };
}

async function forwardResponse(
  targetResponse: Response,
  response: ServerResponse,
  headers: Record<string, string> = {},
): Promise<void> {
  response.writeHead(targetResponse.status, { ...Object.fromEntries(targetResponse.headers.entries()), ...headers });

  if (targetResponse.body) {
    for await (const chunk of targetResponse.body) {
      response.write(Buffer.from(chunk));
    }
    response.end();
    return;
  }

  response.end(await targetResponse.text());
}

export function createOpenAIProxyServer(options: OpenAIProxyOptions = {}) {
  const targetBaseUrl = options.targetBaseUrl ?? process.env.SKILLBRIDGE_TARGET_BASE_URL;
  const targetApiKey = options.targetApiKey ?? process.env.SKILLBRIDGE_TARGET_API_KEY;
  const skillDirs = options.skillDirs ?? getEnvSkillDirs();
  const fetchImpl = options.fetchImpl ?? fetch;
  const mode = options.mode ?? readProxyMode(process.env.SKILLBRIDGE_PROXY_MODE);
  const maxToolIterations = options.maxToolIterations ?? 3;
  const enableScripts = options.enableScripts ?? process.env.SKILLBRIDGE_ENABLE_SCRIPTS === "true";
  const runtime = new SkillBridgeRuntime(skillDirs);

  let initPromise: Promise<unknown> | undefined;
  const initRuntime = () => {
    initPromise ??= runtime.init();
    return initPromise;
  };

  return createServer(async (request, response) => {
    const traceId = randomUUID();
    const traceHeaders = { "x-skillbridge-trace-id": traceId };

    try {
      if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
        writeJson(response, 404, { error: "Not found" }, traceHeaders);
        return;
      }

      if (!targetBaseUrl) {
        writeJson(response, 500, { error: "SKILLBRIDGE_TARGET_BASE_URL is required" }, traceHeaders);
        return;
      }

      const body = await readRequestBody(request);
      const payload = JSON.parse(body || "{}") as OpenAIChatCompletionRequest;
      const messages = payload.messages ?? [];
      const userMessage = findLastUserMessage(messages);

      await initRuntime();
      const prepared = await runtime.prepare({ messages, userMessage });
      const proxiedPayload = {
        ...payload,
        messages: injectSystemPatch(messages, prepared.systemPatch),
        tools: shouldExposeTools(mode) ? appendSkillBridgeTools(payload.tools) : payload.tools,
      };
      const targetUrl = new URL("/v1/chat/completions", targetBaseUrl).toString();
      const sendTargetRequest = async (nextPayload: OpenAIChatCompletionRequest) =>
        fetchImpl(targetUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(targetApiKey ? { authorization: `Bearer ${targetApiKey}` } : {}),
          },
          body: JSON.stringify(nextPayload),
        });

      let targetResponse = await sendTargetRequest(proxiedPayload);
      if (payload.stream || !shouldExecuteToolLoop(mode)) {
        await forwardResponse(targetResponse, response, traceHeaders);
        return;
      }

      for (let iteration = 0; iteration < maxToolIterations; iteration += 1) {
        const responseBodyText = await targetResponse.text();
        const responseBody = JSON.parse(responseBodyText || "{}") as OpenAIChatCompletionResponse;
        const toolCalls = getToolCalls(responseBody);

        if (toolCalls.length === 0) {
          writeJson(response, targetResponse.status, responseBody, traceHeaders);
          return;
        }

        const assistantMessage = responseBody.choices?.[0]?.message;
        if (!assistantMessage) {
          writeJson(response, targetResponse.status, responseBody, traceHeaders);
          return;
        }

        const toolMessages = await Promise.all(
          toolCalls.map((toolCall) => executeSkillBridgeTool(runtime, toolCall, enableScripts)),
        );
        proxiedPayload.messages = [...(proxiedPayload.messages ?? []), assistantMessage, ...toolMessages];
        targetResponse = await sendTargetRequest(proxiedPayload);
      }

      await forwardResponse(targetResponse, response, traceHeaders);
    } catch (error) {
      writeJson(response, 500, { error: error instanceof Error ? error.message : "Unknown proxy error" }, traceHeaders);
    }
  });
}

if (process.argv[1]?.endsWith("server.js") || process.argv[1]?.endsWith("server.ts")) {
  const port = Number(process.env.PORT ?? 3000);
  const server = createOpenAIProxyServer();
  server.listen(port, () => {
    process.stderr.write(`agent-skill-bridge OpenAI proxy listening on ${port}\n`);
  });
}
