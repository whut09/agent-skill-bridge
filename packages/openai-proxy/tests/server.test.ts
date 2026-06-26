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
      expect(body).toEqual({ id: "chatcmpl-test", choices: [] });
      expect(receivedBodies).toHaveLength(1);
      expect(receivedBodies[0]).toMatchObject({
        model: "test-model",
      });
      expect((receivedBodies[0] as { messages: Array<{ role: string; content: string }> }).messages[0]).toMatchObject({
        role: "system",
      });
      expect((receivedBodies[0] as { messages: Array<{ role: string; content: string }> }).messages[0].content).toContain(
        "# Selected Skill: 代码评审",
      );
    } finally {
      proxyServer.close();
      targetServer.close();
    }
  });
});
