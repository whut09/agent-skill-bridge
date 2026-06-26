import type { RuntimeTraceEvent } from "../types.js";

export function createRuntimeTraceEvent(
  type: string,
  message: string,
  metadata?: Record<string, unknown>,
): RuntimeTraceEvent {
  return {
    type,
    message,
    timestamp: new Date().toISOString(),
    metadata,
  };
}
