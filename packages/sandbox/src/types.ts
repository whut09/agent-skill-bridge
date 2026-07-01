export type ScriptExecutorInput = {
  skillPath: string;
  scriptPath: string;
  enableScripts?: boolean;
  timeoutMs?: number;
  args?: string[];
};

export type ScriptExecutorResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
};

export interface ScriptExecutor {
  readonly name: string;
  execute(input: ScriptExecutorInput): Promise<ScriptExecutorResult>;
}
