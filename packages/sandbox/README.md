# @skillbridge/sandbox

Sandbox hosts script executor implementations for SkillBridge.

## ScriptExecutor

All executors implement the same stable interface:

```ts
type ScriptExecutorInput = {
  skillPath: string;
  scriptPath: string;
  enableScripts?: boolean;
  timeoutMs?: number;
  args?: string[];
};

type ScriptExecutorResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
};

interface ScriptExecutor {
  readonly name: string;
  execute(input: ScriptExecutorInput): Promise<ScriptExecutorResult>;
}
```

## LocalNodeScriptExecutor

`LocalNodeScriptExecutor` runs `scripts/*.mjs` style skill scripts with the current Node.js executable. It preserves the existing safety defaults:

- execution requires `enableScripts: true`
- script paths must stay inside the skill directory
- script paths must live under `scripts/`
- child processes run with `shell: false`

The legacy `executeLocalScript(input)` helper remains available and delegates to `LocalNodeScriptExecutor`.

## DockerScriptExecutor

`DockerScriptExecutor` is a stable interface stub. It accepts Docker-oriented options such as `image`, `network`, and resource limits, but currently throws a clear not-implemented error from `execute()`.

Future Docker support should keep the same `ScriptExecutor` input and result shape so runtimes can swap executors without changing their calling code.
