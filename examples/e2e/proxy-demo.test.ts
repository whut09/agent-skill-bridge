import { createServer, type IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { createOpenAIProxyServer } from "../../packages/openai-proxy/src/server.js";

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

describe("proxy e2e", () => {
  it("executes a SkillBridge read_resource tool loop against example skills", async () => {
    const receivedBodies: Array<{ messages: Array<{ role: string; content?: string }>; tools?: unknown[] }> = [];
    const targetServer = createServer(async (request, response) => {
      receivedBodies.push(JSON.parse(await readBody(request)));
      response.writeHead(200, { "content-type": "application/json" });

      if (receivedBodies.length === 1) {
        response.end(
          JSON.stringify({
            id: "chatcmpl-tool",
            choices: [
              {
                message: {
                  role: "assistant",
                  tool_calls: [
                    {
                      id: "call_read_guide",
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
        JSON.stringify({
          id: "chatcmpl-final",
          choices: [{ message: { role: "assistant", content: "guide loaded" } }],
        }),
      );
    });
    const targetPort = await listen(targetServer);
    const proxyServer = createOpenAIProxyServer({
      targetBaseUrl: `http://127.0.0.1:${targetPort}`,
      skillDirs: ["examples/skills"],
      mode: "loop",
    });
    const proxyPort = await listen(proxyServer);

    try {
      const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "test-model",
          messages: [{ role: "user", content: "review this PR" }],
        }),
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(response.headers.get("x-skillbridge-trace-id")).toBeTruthy();
      expect(body).toMatchObject({ id: "chatcmpl-final" });
      expect(receivedBodies).toHaveLength(2);
      expect(receivedBodies[0].tools).toEqual(expect.any(Array));
      expect(receivedBodies[1].messages.find((message) => message.role === "tool")?.content).toContain(
        "Code Review Guide",
      );
    } finally {
      proxyServer.close();
      targetServer.close();
    }
  });
});
