import { describe, expect, it } from "vitest";
import { executeLocally } from "../src/local-executor.js";

describe("sandbox", () => {
  it("returns a ready status", () => {
    expect(executeLocally("echo test").status).toBe("ready");
  });
});
