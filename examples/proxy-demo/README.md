# Proxy Demo

Run the OpenAI-compatible proxy against any target chat completions provider:

```bash
export SKILLBRIDGE_TARGET_BASE_URL="https://api.openai.com"
export SKILLBRIDGE_TARGET_API_KEY="sk-..."
export SKILLBRIDGE_SKILL_DIR="./examples/skills"

pnpm --filter @skillbridge/openai-proxy exec tsx src/server.ts
```

Then point an OpenAI-compatible client to the proxy base URL:

```bash
curl http://127.0.0.1:3000/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{ "role": "user", "content": "帮我做代码评审" }]
  }'
```
