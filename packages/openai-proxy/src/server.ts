import { createServer } from "node:http";

export function createOpenAIProxyServer() {
  return createServer((request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        ok: true,
        message: "OpenAI-compatible proxy scaffold",
        method: request.method,
        url: request.url,
      }),
    );
  });
}
