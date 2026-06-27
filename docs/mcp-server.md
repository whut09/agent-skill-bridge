# MCP Server

The MCP server exposes SkillBridge through tool calls for MCP-compatible clients.

## Build

```bash
pnpm install
pnpm build
```

## Run

```bash
node packages/mcp-server/dist/server.js --skill-dir ./examples/skills
```

Enable scripts only for trusted skill packages:

```bash
node packages/mcp-server/dist/server.js --skill-dir ./examples/skills --enable-scripts
```

Debug mode returns raw absolute paths:

```bash
node packages/mcp-server/dist/server.js --skill-dir ./examples/skills --debug
```

## Tools

- `skillbridge_list_skills`
- `skillbridge_search_skills`
- `skillbridge_activate_skill`
- `skillbridge_read_skill`
- `skillbridge_list_resources`
- `skillbridge_read_resource`
- `skillbridge_run_script`

Resource and script tools prefer `skillName`:

```json
{
  "skillName": "Code Review",
  "resourcePath": "references/checklist.md"
}
```

`skillPath` is still accepted as deprecated compatibility input and may be removed in `v0.2`.

## Claude Desktop

Example `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "skillbridge": {
      "command": "node",
      "args": [
        "F:/codex/code/agent-skill-bridge/packages/mcp-server/dist/server.js",
        "--skill-dir",
        "F:/codex/code/agent-skill-bridge/examples/skills"
      ]
    }
  }
}
```

## Cursor

Example MCP configuration:

```json
{
  "mcpServers": {
    "skillbridge": {
      "command": "node",
      "args": [
        "/absolute/path/to/agent-skill-bridge/packages/mcp-server/dist/server.js",
        "--skill-dir",
        "/absolute/path/to/agent-skill-bridge/examples/skills"
      ]
    }
  }
}
```

## LibreChat

Use the same command and args pattern in LibreChat's MCP server configuration:

```yaml
mcpServers:
  skillbridge:
    command: node
    args:
      - /absolute/path/to/agent-skill-bridge/packages/mcp-server/dist/server.js
      - --skill-dir
      - /absolute/path/to/agent-skill-bridge/examples/skills
```

Exact file placement depends on your LibreChat deployment.
