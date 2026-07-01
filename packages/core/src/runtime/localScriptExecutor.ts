import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { LocalScriptExecutorInput, LocalScriptExecutorResult, ScriptExecutor } from "../types.js";

function ensureScriptExecutionEnabled(enableScripts?: boolean): void {
  if (enableScripts !== true) {
    throw new Error("Script execution is disabled. Set enableScripts=true to allow execution.");
  }
}

function resolveScriptPath(skillPath: string, scriptPath: string): string {
  const normalizedSkillPath = path.resolve(skillPath);
  const normalizedScriptPath = path.resolve(normalizedSkillPath, scriptPath);
  const relative = path.relative(normalizedSkillPath, normalizedScriptPath);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to execute outside scripts directory: ${scriptPath}`);
  }

  if (!relative.startsWith("scripts")) {
    throw new Error(`Refusing to execute non-scripts path: ${scriptPath}`);
  }

  return normalizedScriptPath;
}

export class LocalNodeScriptExecutor implements ScriptExecutor {
  readonly name = "local-node";

  async execute(input: LocalScriptExecutorInput): Promise<LocalScriptExecutorResult> {
    ensureScriptExecutionEnabled(input.enableScripts);

    const scriptAbsolutePath = resolveScriptPath(input.skillPath, input.scriptPath);
    const stat = await fs.stat(scriptAbsolutePath);

    if (!stat.isFile()) {
      throw new Error(`Script path is not a file: ${input.scriptPath}`);
    }

    const timeoutMs = input.timeoutMs ?? 30000;
    const args = input.args ?? [];

    return new Promise<LocalScriptExecutorResult>((resolve, reject) => {
      const childProcess = spawn(process.execPath, [scriptAbsolutePath, ...args], {
        cwd: path.dirname(scriptAbsolutePath),
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let finished = false;

      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        childProcess.kill("SIGKILL");
      }, timeoutMs);

      childProcess.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });

      childProcess.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });

      childProcess.on("error", (error) => {
        if (!finished) {
          finished = true;
          clearTimeout(timeoutHandle);
          reject(error);
        }
      });

      childProcess.on("close", (exitCode) => {
        if (finished) {
          return;
        }

        finished = true;
        clearTimeout(timeoutHandle);
        resolve({ stdout, stderr, exitCode, timedOut });
      });
    });
  }
}

export function executeLocalScript(input: LocalScriptExecutorInput): Promise<LocalScriptExecutorResult> {
  return new LocalNodeScriptExecutor().execute(input);
}
