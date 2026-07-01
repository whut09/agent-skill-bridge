import type { ScriptExecutor, ScriptExecutorResult } from "./types.js";

export type DockerScriptExecutorOptions = {
  image: string;
  dockerBinary?: string;
  workdir?: string;
  network?: "none" | "bridge";
  memoryLimit?: string;
  cpuLimit?: string;
};

export class DockerScriptExecutor implements ScriptExecutor {
  readonly name = "docker";

  constructor(readonly options: DockerScriptExecutorOptions) {}

  async execute(): Promise<ScriptExecutorResult> {
    throw new Error(
      [
        "DockerScriptExecutor is a stable interface stub and is not implemented yet.",
        "Use LocalNodeScriptExecutor for local execution until Docker support is wired.",
      ].join(" "),
    );
  }
}
