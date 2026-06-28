#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const diffPath = process.argv[2];

if (!diffPath) {
  console.log(
    JSON.stringify(
      {
        ok: false,
        error: "Usage: analyze-diff.mjs <diff-file>",
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} else {
  const diff = await readFile(diffPath, "utf8");
  const added = diff.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
  const removed = diff.split("\n").filter((line) => line.startsWith("-") && !line.startsWith("---")).length;
  const files = [...diff.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)].map((match) => match[2]);

  console.log(
    JSON.stringify(
      {
        ok: true,
        files,
        added,
        removed,
        riskHints: [
          added + removed > 200 ? "large change size" : undefined,
          files.some((file) => file.includes("auth") || file.includes("security"))
            ? "security-sensitive path"
            : undefined,
          files.some((file) => file.includes("test") || file.includes("spec")) ? undefined : "no test files changed",
        ].filter(Boolean),
      },
      null,
      2,
    ),
  );
}
