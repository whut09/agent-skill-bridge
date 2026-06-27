# MCP Server

The MCP server exposes SkillBridge with native MCP tools, resources, and prompts.

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

Primary tools:

- `skillbridge.search`
- `skillbridge.activate`
- `skillbridge.run_script`

Compatibility tools retained for existing clients:

- `skillbridge_list_skills`
- `skillbridge_search_skills`
- `skillbridge_activate_skill`
- `skillbridge_read_skill`
- `skillbridge_list_resources`
- `skillbridge_read_resource`
- `skillbridge_run_script`

Resource and script tools prefer stable `skillId`. `skillName` remains a deprecated compatibility field:

```json
{
  "skillId": "code-review",
  "resourcePath": "references/checklist.md"
}
```

`skillName` and `skillPath` are still accepted as deprecated compatibility input and may be removed in `v0.2`.

## Resources

Skill files are exposed as MCP resources so clients can browse and read them with native resource UX:

- `skill://{skillId}/SKILL.md`
- `skill://{skillId}/references/{file}`
- `skill://{skillId}/assets/{file}`

Nested reference and asset paths are URL encoded inside `{file}`. For example:

```text
skill://code-review/references/checklists%2Fpr-risk.md
```

Resources preserve progressive loading: catalog and selected `SKILL.md` are used for activation, while references and assets are read only when the client requests the resource.

## Prompts

The server registers workflow prompts:

- `skillbridge-use-skill`
- `skillbridge-debug-skill`
- `skillbridge-create-skill`

These prompts give MCP clients natural entry points for using, debugging, and authoring skills without turning every workflow into a custom tool.

## Transport

The current server runs over MCP stdio. Streamable HTTP is a natural next transport for hosted deployments, but the CLI entry point currently starts stdio only.

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
