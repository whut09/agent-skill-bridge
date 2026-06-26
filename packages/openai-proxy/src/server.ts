import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { SkillBridgeRuntime, type SkillBridgeMessage } from "@skillbridge/core";

export type OpenAIProxyOptions = {
  targetBaseUrl?: string;
  targetApiKey?: string;
  skillDirs?: string[];
  fetchImpl?: typeof fetch;
};

export type OpenAIChatCompletionRequest = {
  messages?: SkillBridgeMessage[];
  stream?: boolean;
  [key: string]: unknown;
};

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

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json" });
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

function injectSystemPatch(messages: SkillBridgeMessage[], systemPatch: string): SkillBridgeMessage[] {
  if (!systemPatch) {
    return messages;
  }

  return [{ role: "system", content: systemPatch }, ...messages];
}

async function forwardResponse(targetResponse: Response, response: ServerResponse): Promise<void> {
  response.writeHead(targetResponse.status, Object.fromEntries(targetResponse.headers.entries()));

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
  const runtime = new SkillBridgeRuntime(skillDirs);

  let initPromise: Promise<unknown> | undefined;
  const initRuntime = () => {
    initPromise ??= runtime.init();
    return initPromise;
  };

  return createServer(async (request, response) => {
    try {
      if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
        writeJson(response, 404, { error: "Not found" });
        return;
      }

      if (!targetBaseUrl) {
        writeJson(response, 500, { error: "SKILLBRIDGE_TARGET_BASE_URL is required" });
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
      };
      const targetUrl = new URL("/v1/chat/completions", targetBaseUrl).toString();
      const targetResponse = await fetchImpl(targetUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(targetApiKey ? { authorization: `Bearer ${targetApiKey}` } : {}),
        },
        body: JSON.stringify(proxiedPayload),
      });

      await forwardResponse(targetResponse, response);
    } catch (error) {
      writeJson(response, 500, { error: error instanceof Error ? error.message : "Unknown proxy error" });
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
