export function executeLocally(command: string): { command: string; status: "ready" } {
  return { command, status: "ready" };
}
