import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createCliProgram } from "../src/index.js";

describe("cli package", () => {
  it("has a test harness", () => {
    expect(true).toBe(true);
  });

  it("prints runtime trace events", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "skillbridge-cli-trace-"));
    const chunks: string[] = [];
    const originalWrite = process.stdout.write;

    process.stdout.write = ((chunk: string | Uint8Array) => {
      chunks.push(chunk.toString());
      return true;
    }) as typeof process.stdout.write;

    try {
      await createCliProgram().parseAsync(["node", "skillbridge", "trace", tempRoot]);
    } finally {
      process.stdout.write = originalWrite;
    }

    const output = chunks.join("");
    expect(output).toContain("scan_start");
    expect(output).toContain("scan_complete");
  });
});
