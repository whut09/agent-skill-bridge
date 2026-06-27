# @skillbridge/mcp-server

MCP stdio server for `agent-skill-bridge`.

It exposes native MCP:

- Tools: `skillbridge.search`, `skillbridge.activate`, `skillbridge.run_script`
- Resources: `skill://{skillName}/SKILL.md`, `skill://{skillName}/references/{file}`, `skill://{skillName}/assets/{file}`
- Prompts: `skillbridge-use-skill`, `skillbridge-debug-skill`, `skillbridge-create-skill`

Legacy underscore tool names remain available for compatibility.

## Usage

```bash
pnpm --filter @skillbridge/mcp-server exec tsx src/server.ts --skill-dir ./examples/skills
```

To enable script execution, pass `--enable-scripts` explicitly:

```bash
pnpm --filter @skillbridge/mcp-server exec tsx src/server.ts --skill-dir ./examples/skills --enable-scripts
```
