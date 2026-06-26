# @skillbridge/mcp-server

MCP stdio server for `agent-skill-bridge`.

## Usage

```bash
pnpm --filter @skillbridge/mcp-server exec tsx src/server.ts --skill-dir ./examples/skills
```

To enable script execution, pass `--enable-scripts` explicitly:

```bash
pnpm --filter @skillbridge/mcp-server exec tsx src/server.ts --skill-dir ./examples/skills --enable-scripts
```
