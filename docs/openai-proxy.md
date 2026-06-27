# OpenAI Proxy

The OpenAI-compatible proxy sits between an existing OpenAI client and a target model endpoint.

In `loop` mode, it acts as a SkillBridge middle-layer executor:

```text
Existing Agent -> OpenAI Proxy -> SkillBridge Loop -> Target LLM
```

Any agent that can change its OpenAI `base_url` can gain SkillBridge activation, progressive loading, and local tool execution without implementing a skill runtime.

It can do three things:

1. Selects relevant skills for each chat request.
2. Injects selected Skill context into the first system message.
3. Exposes or executes SkillBridge tool calls depending on proxy mode.

## Environment

```bash
export SKILLBRIDGE_TARGET_BASE_URL="https://api.openai.com"
export SKILLBRIDGE_TARGET_API_KEY="sk-..."
export SKILLBRIDGE_SKILL_DIR="./examples/skills"
export SKILLBRIDGE_PROXY_MODE="loop"
export SKILLBRIDGE_ENABLE_SCRIPTS="false"
```

`SKILLBRIDGE_PROXY_MODE` accepts:

- `prompt`: injects `systemPatch` only. This works with any OpenAI-compatible model.
- `tools`: injects `systemPatch` and appends SkillBridge OpenAI tools. The external agent receives `tool_calls` and must execute them.
- `loop`: injects `systemPatch`, appends tools, executes SkillBridge tool calls inside the proxy, appends tool messages, and asks the target model again. This is the default.

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

## Modes

### `prompt`

Prompt mode only injects the selected Skill context. It is the safest compatibility path for simple OpenAI-compatible clients and models that do not support tools.

### `tools`

Tools mode appends two OpenAI tools:

- `skillbridge_read_resource`
- `skillbridge_run_script`

The proxy does not execute returned `tool_calls` in this mode. The caller can handle tool execution itself.

### `loop`

Loop mode appends the same OpenAI tools:

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
