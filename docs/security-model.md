# Security Model

SkillBridge treats a skill as operational input, not passive documentation. `SKILL.md` metadata and instructions influence discovery, routing, activation, resource loading, and tool execution, so the runtime applies policy checks before sensitive actions.

## Policy Pipeline

```text
Skill selected
  -> Permission check
  -> Trust level check
  -> Policy approval
  -> Sandbox execution
  -> Trace log
```

## Policy Package

Security policy lives in `packages/policy`:

- `permission.ts`: read, write, network, and execute decisions.
- `allowlist.ts`: allowed tools, scripts, and command surfaces.
- `trust.ts`: `trusted`, `local`, `community`, and `untrusted` trust levels.
- `scanner.ts`: prompt-injection, dangerous-command, metadata-risk, and external-download checks.
- `audit.ts`: structured policy audit events.

Core runtime uses this package before resource reads and script execution.

## Policy File

CLI, MCP Server, and OpenAI Proxy look for `.skillbridge/policy.yaml` from the skill directory upward, then from the current working directory upward.

Supported fields:

```yaml
scripts:
  enabled: false
  timeoutMs: 30000
  allow:
    - scripts/check.mjs
trust:
  minimumTrustForScripts: local
  default: local
resources:
  maxFileBytes: 1048576
  allow:
    - references/**
  allowBinary: false
  allowedExtensions:
    - .md
    - .txt
    - .json
  deniedExtensions:
    - .exe
network:
  enabled: false
```

Effects:

- `scripts.enabled` enables script execution by default for entrypoints that read policy.
- `scripts.timeoutMs` sets the default script timeout when a command/tool does not pass one.
- `scripts.allow` limits script execution to the listed relative script paths.
- `trust.minimumTrustForScripts` sets the minimum trust level required before script execution.
- `trust.default` sets the trust level assigned to loaded skills when no narrower runtime policy overrides it.
- `resources.maxFileBytes` rejects resource reads above the configured size.
- `resources.allow` limits resource reads to the listed relative paths or glob patterns.
- `resources.allowBinary` allows binary resource reads when explicitly set to `true`; binary reads are denied by default.
- `resources.allowedExtensions` allows only the listed resource extensions when present.
- `resources.deniedExtensions` rejects listed extensions in addition to default sensitive extensions.
- `network.enabled` is parsed and surfaced for policy-aware entrypoints; network execution remains disabled unless an adapter explicitly supports it.

Policy files are parsed as YAML and validated with zod. The original simple shape remains supported, so existing policy files that only set `scripts.enabled`, `scripts.timeoutMs`, `trust.minimumTrustForScripts`, `resources.maxFileBytes`, and `network.enabled` continue to load unchanged.

## Resource Boundaries

Resource reads are restricted to files inside the selected skill directory and can also be constrained by `permissions.read`.

Blocked:

```text
../outside.md
/absolute/path/outside/skill.md
assets/secret.txt    # when permissions.read only allows references/**
.env
*.pem
*.key
id_rsa
credentials.json
secrets.*
assets/image.png     # unless resources.allowBinary is true
```

Allowed:

```text
references/checklist.md
assets/template.json # when allowed by policy
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

Before execution, runtime checks:

- `allowedTools` / `deniedTools`
- `permissions.execute`
- minimum trust level
- optional script allowlist
- `scripts/` path boundary
- `shell:false` execution through Node

## Prompt And Metadata Risk

Skill text can contain operational instructions that affect runtime behavior. During scan, SkillBridge checks `SKILL.md` and frontmatter for risky patterns such as:

- attempts to override system or developer instructions
- requests to reveal secrets or hidden prompts
- destructive shell commands
- remote download and execute patterns
- metadata that appears to contain operational instructions

Findings are recorded as `policy_scan_finding` trace events.

## Trust Model

Default local skills are treated as `local`. Policy supports:

- `trusted`: reviewed first-party skills.
- `local`: local development or private repository skills.
- `community`: third-party shared skills.
- `untrusted`: unknown or quarantined skills.

Script execution defaults to requiring at least `local`. Runtime callers can raise that bar with `minimumTrustForScripts`.

## Traceability

Runtime trace events include:

- `policy_scan_finding`
- `policy_audit`
- `resource_read`
- `script_run_start`
- `script_run_complete`
- `script_run_failed`

OpenAI proxy responses include `x-skillbridge-trace-id` for request-level correlation.

## Path Exposure

MCP hides absolute paths by default. Use `--debug` only during local development.
