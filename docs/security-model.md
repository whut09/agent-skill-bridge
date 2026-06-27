# Security Model

SkillBridge is designed to keep the default path conservative.

## Resource Boundaries

Resource reads are restricted to files inside the selected skill directory.

Blocked:

```text
../outside.md
/absolute/path/outside/skill.md
```

Allowed:

```text
references/checklist.md
assets/template.json
```

## Script Execution

Scripts are disabled by default.

CLI:

```bash
pnpm skillbridge run ./my-skill scripts/check.mjs --enable-scripts
```

MCP server:

```bash
node packages/mcp-server/dist/server.js --skill-dir ./skills --enable-scripts
```

OpenAI proxy:

```bash
export SKILLBRIDGE_ENABLE_SCRIPTS=true
```

Scripts must live under `scripts/`. Shell execution is not enabled; scripts are executed with Node using `process.execPath`.

## Trust Model

Treat third-party skills as code.

Before enabling scripts:

- Inspect `SKILL.md`.
- Inspect every file under `scripts/`.
- Prefer read-only references for untrusted skills.
- Run untrusted skills in an OS/container sandbox.

## Traceability

Runtime trace events record scan, search, selection, context building, resource reads, and script execution outcomes.

OpenAI proxy responses include `x-skillbridge-trace-id` for request-level correlation.

## Path Exposure

MCP hides absolute paths by default. Use `--debug` only during local development.
