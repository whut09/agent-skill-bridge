import { createServer, type IncomingMessage } from "node:http";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createOpenAIProxyServer } from "../src/server.js";

function readBody(request: IncomingMessage): Promise<string> {
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

function listen(server: ReturnType<typeof createServer>): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "object" && address) {
        resolve(address.port);
      }
    });
  });
}

describe("openai proxy", () => {
  it("serves health and forwards model listing", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "skillbridge-proxy-health-"));
    const skillRoot = path.join(tempRoot, "skills");
    const skillDir = path.join(skillRoot, "review");
    const receivedPaths: string[] = [];

    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, "SKILL.md"),
      `---
name: Code Review
id: code-review
description: Review code changes
metadata:
  keywords: review
---

# Code Review`,
      "utf8",
    );

    const targetServer = createServer((request, response) => {
      receivedPaths.push(request.url ?? "");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ object: "list", data: [{ id: "target-model", object: "model" }] }));
    });
    const targetPort = await listen(targetServer);
    const proxyServer = createOpenAIProxyServer({
      targetBaseUrl: `http://127.0.0.1:${targetPort}`,
      targetApiKey: "test-key",
      skillDirs: [skillRoot],
      mode: "prompt",
    });
    const proxyPort = await listen(proxyServer);

    try {
      const healthResponse = await fetch(`http://127.0.0.1:${proxyPort}/skillbridge/health`);
      const healthBody = await healthResponse.json();
      const modelsResponse = await fetch(`http://127.0.0.1:${proxyPort}/v1/models`);
      const modelsBody = await modelsResponse.json();

      expect(healthResponse.status).toBe(200);
      expect(healthResponse.headers.get("x-skillbridge-trace-id")).toBeTruthy();
      expect(healthBody).toMatchObject({
        ok: true,
        mode: "prompt",
        skillCount: 1,
        scriptsEnabled: false,
      });
      expect(modelsResponse.status).toBe(200);
      expect(modelsResponse.headers.get("x-skillbridge-trace-id")).toBeTruthy();
      expect(modelsBody).toMatchObject({ object: "list", data: [{ id: "target-model" }] });
      expect(receivedPaths).toEqual(["/v1/models"]);
    } finally {
      proxyServer.close();
      targetServer.close();
    }
  });

  it("injects systemPatch and forwards chat completions", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "skillbridge-proxy-"));
    const skillRoot = path.join(tempRoot, "skills");
    const skillDir = path.join(skillRoot, "review");
    const receivedBodies: unknown[] = [];

    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, "SKILL.md"),
      `---
name: 代码评审
description: 对代码改动进行审查、指出问题并给出建议
---

# 核心指令

- 审查代码`,
      "utf8",
    );

    const targetServer = createServer(async (request, response) => {
      receivedBodies.push(JSON.parse(await readBody(request)));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: "chatcmpl-test", choices: [] }));
    });
    const targetPort = await listen(targetServer);
    const proxyServer = createOpenAIProxyServer({
      targetBaseUrl: `http://127.0.0.1:${targetPort}`,
      targetApiKey: "test-key",
      skillDirs: [skillRoot],
    });
    const proxyPort = await listen(proxyServer);

    try {
      const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "test-model",
          messages: [
            { role: "system", content: "existing system" },
            { role: "user", content: "代码评审" },
          ],
        }),
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(response.headers.get("x-skillbridge-trace-id")).toBeTruthy();
      expect(body).toEqual({ id: "chatcmpl-test", choices: [] });
      expect(receivedBodies).toHaveLength(1);
      expect(receivedBodies[0]).toMatchObject({
        model: "test-model",
      });
      const forwardedMessages = (receivedBodies[0] as { messages: Array<{ role: string; content: string }> }).messages;
      const systemMessages = forwardedMessages.filter((message) => message.role === "system");

      expect(systemMessages).toHaveLength(1);
      expect(forwardedMessages[0]).toMatchObject({
        role: "system",
      });
      expect(forwardedMessages[0].content).toContain("existing system");
      expect(forwardedMessages[0].content).toContain("<skillbridge_runtime>");
      expect(forwardedMessages[0].content).toContain("# Selected Skill (Level 1): 代码评审");
      expect(forwardedMessages[0].content).toContain("</skillbridge_runtime>");
    } finally {
      proxyServer.close();
      targetServer.close();
    }
  });

  it("creates a wrapped systemPatch system message when none exists", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "skillbridge-proxy-no-system-"));
    const skillRoot = path.join(tempRoot, "skills");
    const skillDir = path.join(skillRoot, "review");
    const receivedBodies: unknown[] = [];

    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, "SKILL.md"),
      `---
name: Code Review
id: code-review
description: Review code changes
metadata:
  keywords: review
---

# Code Review`,
      "utf8",
    );

    const targetServer = createServer(async (request, response) => {
      receivedBodies.push(JSON.parse(await readBody(request)));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: "chatcmpl-test", choices: [] }));
    });
    const targetPort = await listen(targetServer);
    const proxyServer = createOpenAIProxyServer({
      targetBaseUrl: `http://127.0.0.1:${targetPort}`,
      skillDirs: [skillRoot],
    });
    const proxyPort = await listen(proxyServer);

    try {
      const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "test-model",
          messages: [{ role: "user", content: "review" }],
        }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("x-skillbridge-trace-id")).toBeTruthy();
      const forwardedMessages = (receivedBodies[0] as { messages: Array<{ role: string; content: string }> }).messages;
      const systemMessages = forwardedMessages.filter((message) => message.role === "system");

      expect(systemMessages).toHaveLength(1);
      expect(forwardedMessages[0].role).toBe("system");
      expect(forwardedMessages[0].content).toContain("<skillbridge_runtime>");
      expect(forwardedMessages[0].content).toContain("# Selected Skill (Level 1): Code Review");
      expect(forwardedMessages[0].content).toContain("</skillbridge_runtime>");
    } finally {
      proxyServer.close();
      targetServer.close();
    }
  });

  it("executes read_resource tool calls and sends a second target request", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "skillbridge-proxy-tools-"));
    const skillRoot = path.join(tempRoot, "skills");
    const skillDir = path.join(skillRoot, "review");
    const receivedBodies: Array<{
      tools?: Array<{ function: { name: string } }>;
      messages: Array<{ role: string; content?: string; tool_call_id?: string }>;
    }> = [];

    await mkdir(path.join(skillDir, "references"), { recursive: true });
    await writeFile(
      path.join(skillDir, "SKILL.md"),
      `---
name: Code Review
id: code-review
description: Review code changes
metadata:
  keywords: review
---

# Code Review`,
      "utf8",
    );
    await writeFile(path.join(skillDir, "references", "guide.md"), "resource guidance", "utf8");

    const targetServer = createServer(async (request, response) => {
      const requestBody = JSON.parse(await readBody(request));
      receivedBodies.push(requestBody);
      response.writeHead(200, { "content-type": "application/json" });

      if (receivedBodies.length === 1) {
        response.end(
          JSON.stringify({
            id: "chatcmpl-tool",
            choices: [
              {
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "call_read_1",
                      type: "function",
                      function: {
                        name: "skillbridge_read_resource",
                        arguments: JSON.stringify({
                          skillId: "code-review",
                          resourcePath: "references/guide.md",
                        }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
        );
        return;
      }

      response.end(
        JSON.stringify({ id: "chatcmpl-final", choices: [{ message: { role: "assistant", content: "ok" } }] }),
      );
    });
    const targetPort = await listen(targetServer);
    const proxyServer = createOpenAIProxyServer({
      targetBaseUrl: `http://127.0.0.1:${targetPort}`,
      skillDirs: [skillRoot],
    });
    const proxyPort = await listen(proxyServer);

    try {
      const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "test-model",
          messages: [{ role: "user", content: "review" }],
        }),
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(response.headers.get("x-skillbridge-trace-id")).toBeTruthy();
      expect(body).toMatchObject({ id: "chatcmpl-final" });
      expect(receivedBodies).toHaveLength(2);
      expect(receivedBodies[0].tools?.map((tool) => tool.function.name)).toEqual(
        expect.arrayContaining(["skillbridge_read_resource", "skillbridge_run_script"]),
      );
      const secondRequestToolMessage = receivedBodies[1].messages.find((message) => message.role === "tool");
      expect(secondRequestToolMessage).toMatchObject({ tool_call_id: "call_read_1" });
      expect(secondRequestToolMessage?.content).toContain("resource guidance");
    } finally {
      proxyServer.close();
      targetServer.close();
    }
  });

  it("stores traces by response trace id", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "skillbridge-proxy-trace-"));
    const skillRoot = path.join(tempRoot, "skills");
    const skillDir = path.join(skillRoot, "review");

    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, "SKILL.md"),
      `---
name: Code Review
id: code-review
description: Review code changes
metadata:
  keywords: review
---

# Code Review`,
      "utf8",
    );

    const targetServer = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: "chatcmpl-trace", choices: [] }));
    });
    const targetPort = await listen(targetServer);
    const proxyServer = createOpenAIProxyServer({
      targetBaseUrl: `http://127.0.0.1:${targetPort}`,
      skillDirs: [skillRoot],
    });
    const proxyPort = await listen(proxyServer);

    try {
      const chatResponse = await fetch(`http://127.0.0.1:${proxyPort}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "test-model",
          messages: [{ role: "user", content: "review" }],
        }),
      });
      const traceId = chatResponse.headers.get("x-skillbridge-trace-id");
      const latestResponse = await fetch(`http://127.0.0.1:${proxyPort}/skillbridge/traces/latest`);
      const latestBody = await latestResponse.json();
      const traceResponse = await fetch(`http://127.0.0.1:${proxyPort}/skillbridge/traces/${traceId}`);
      const traceBody = await traceResponse.json();

      expect(traceId).toBeTruthy();
      expect(latestResponse.status).toBe(200);
      expect(latestBody).toMatchObject({
        traceId,
        userMessage: "review",
        selectedSkill: "Code Review",
      });
      expect(traceResponse.status).toBe(200);
      expect(traceBody).toMatchObject({
        traceId,
        userMessage: "review",
        selectedSkill: "Code Review",
      });
    } finally {
      proxyServer.close();
      targetServer.close();
    }
  });

  it("returns failed tool calls as tool messages instead of proxy errors", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "skillbridge-proxy-tool-error-"));
    const skillRoot = path.join(tempRoot, "skills");
    const skillDir = path.join(skillRoot, "review");
    const receivedBodies: Array<{
      messages: Array<{ role: string; content?: string; tool_call_id?: string }>;
    }> = [];

    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, "SKILL.md"),
      `---
name: Code Review
id: code-review
description: Review code changes
metadata:
  keywords: review
---

# Code Review`,
      "utf8",
    );

    const targetServer = createServer(async (request, response) => {
      const requestBody = JSON.parse(await readBody(request));
      receivedBodies.push(requestBody);
      response.writeHead(200, { "content-type": "application/json" });

      if (receivedBodies.length === 1) {
        response.end(
          JSON.stringify({
            id: "chatcmpl-tool-error",
            choices: [
              {
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "call_missing_resource",
                      type: "function",
                      function: {
                        name: "skillbridge_read_resource",
                        arguments: JSON.stringify({
                          skillId: "code-review",
                          resourcePath: "references/missing.md",
                        }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
        );
        return;
      }

      response.end(
        JSON.stringify({
          id: "chatcmpl-final-after-error",
          choices: [{ message: { role: "assistant", content: "ok" } }],
        }),
      );
    });
    const targetPort = await listen(targetServer);
    const proxyServer = createOpenAIProxyServer({
      targetBaseUrl: `http://127.0.0.1:${targetPort}`,
      skillDirs: [skillRoot],
    });
    const proxyPort = await listen(proxyServer);

    try {
      const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "test-model",
          messages: [{ role: "user", content: "review" }],
        }),
      });
      const body = await response.json();
      const secondRequestToolMessage = receivedBodies[1].messages.find((message) => message.role === "tool");

      expect(response.status).toBe(200);
      expect(body).toMatchObject({ id: "chatcmpl-final-after-error" });
      expect(receivedBodies).toHaveLength(2);
      expect(secondRequestToolMessage).toMatchObject({ tool_call_id: "call_missing_resource" });
      expect(JSON.parse(secondRequestToolMessage?.content ?? "{}")).toMatchObject({
        ok: false,
        error: expect.stringContaining("ENOENT"),
      });
      expect(secondRequestToolMessage?.content).not.toContain(tempRoot);
    } finally {
      proxyServer.close();
      targetServer.close();
    }
  });

  it("prompt mode injects context without exposing SkillBridge tools", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "skillbridge-proxy-prompt-mode-"));
    const skillRoot = path.join(tempRoot, "skills");
    const skillDir = path.join(skillRoot, "review");
    const receivedBodies: Array<{ tools?: unknown[]; messages: Array<{ role: string; content?: string }> }> = [];

    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, "SKILL.md"),
      `---
name: Code Review
id: code-review
description: Review code changes
metadata:
  keywords: review
---

# Code Review`,
      "utf8",
    );

    const targetServer = createServer(async (request, response) => {
      receivedBodies.push(JSON.parse(await readBody(request)));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: "chatcmpl-prompt", choices: [] }));
    });
    const targetPort = await listen(targetServer);
    const proxyServer = createOpenAIProxyServer({
      targetBaseUrl: `http://127.0.0.1:${targetPort}`,
      skillDirs: [skillRoot],
      mode: "prompt",
    });
    const proxyPort = await listen(proxyServer);

    try {
      const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "test-model",
          messages: [{ role: "user", content: "review" }],
        }),
      });

      expect(response.status).toBe(200);
      expect(receivedBodies).toHaveLength(1);
      expect(receivedBodies[0].tools).toBeUndefined();
      expect(receivedBodies[0].messages[0]).toMatchObject({ role: "system" });
      expect(receivedBodies[0].messages[0].content).toContain("<skillbridge_runtime>");
    } finally {
      proxyServer.close();
      targetServer.close();
    }
  });

  it("tools mode exposes tools without executing returned tool calls", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "skillbridge-proxy-tools-mode-"));
    const skillRoot = path.join(tempRoot, "skills");
    const skillDir = path.join(skillRoot, "review");
    const receivedBodies: Array<{ tools?: Array<{ function: { name: string } }> }> = [];

    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, "SKILL.md"),
      `---
name: Code Review
id: code-review
description: Review code changes
metadata:
  keywords: review
---

# Code Review`,
      "utf8",
    );

    const targetServer = createServer(async (request, response) => {
      receivedBodies.push(JSON.parse(await readBody(request)));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id: "chatcmpl-tool-call",
          choices: [
            {
              message: {
                role: "assistant",
                tool_calls: [
                  {
                    id: "call_read_1",
                    type: "function",
                    function: {
                      name: "skillbridge_read_resource",
                      arguments: JSON.stringify({ skillId: "code-review", resourcePath: "references/guide.md" }),
                    },
                  },
                ],
              },
            },
          ],
        }),
      );
    });
    const targetPort = await listen(targetServer);
    const proxyServer = createOpenAIProxyServer({
      targetBaseUrl: `http://127.0.0.1:${targetPort}`,
      skillDirs: [skillRoot],
      mode: "tools",
    });
    const proxyPort = await listen(proxyServer);

    try {
      const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "test-model",
          messages: [{ role: "user", content: "review" }],
        }),
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(receivedBodies).toHaveLength(1);
      expect(receivedBodies[0].tools?.map((tool) => tool.function.name)).toEqual(
        expect.arrayContaining(["skillbridge_read_resource", "skillbridge_run_script"]),
      );
      expect(body).toMatchObject({ id: "chatcmpl-tool-call" });
      expect(body.choices[0].message.tool_calls[0]).toMatchObject({ id: "call_read_1" });
    } finally {
      proxyServer.close();
      targetServer.close();
    }
  });
});
