# OpenAI Proxy

The OpenAI-compatible proxy sits between an existing OpenAI client and a target model endpoint.

It does three things:

1. Selects relevant skills for each chat request.
2. Injects selected Skill context into the first system message.
3. Executes SkillBridge tool calls returned by the target model.

## Environment

```bash
export SKILLBRIDGE_TARGET_BASE_URL="https://api.openai.com"
export SKILLBRIDGE_TARGET_API_KEY="sk-..."
export SKILLBRIDGE_SKILL_DIR="./examples/skills"
export SKILLBRIDGE_ENABLE_SCRIPTS="false"
```

`SKILLBRIDGE_ENABLE_SCRIPTS=true` is required for `skillbridge_run_script`.

## Start

```bash
pnpm build
node packages/openai-proxy/dist/server.js
```

The proxy listens on `PORT`, default `3000`.

## Point A Client At The Proxy

Use the proxy as the OpenAI base URL:

```text
http://localhost:3000/v1
```

Requests to `/v1/chat/completions` are forwarded to:

```text
${SKILLBRIDGE_TARGET_BASE_URL}/v1/chat/completions
```

## System Injection

SkillBridge wraps runtime context in:

```xml
<skillbridge_runtime>
...
</skillbridge_runtime>
```

If the request already has a system message, the proxy appends the wrapped context to that message. Otherwise it creates a new system message.

## Tool Interception

The proxy appends two OpenAI tools:

- `skillbridge_read_resource`
- `skillbridge_run_script`

If the model returns `tool_calls`, the proxy:

1. Parses tool name and JSON arguments.
2. Calls `runtime.readResource` or `runtime.runScript`.
3. Appends the assistant tool call message.
4. Appends the tool result message.
5. Sends a second request to the target model.

Tool loops are capped by `maxToolIterations`, default `3`.

## Trace Header

Every proxy response includes:

```text
x-skillbridge-trace-id: <uuid>
```

Use this ID to correlate application logs with SkillBridge runtime decisions.

## Streaming

Streaming requests are forwarded without local tool interception.
