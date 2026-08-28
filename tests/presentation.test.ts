import { describe, expect, test } from "vitest";

import type { ResearchRun } from "../src/client/api.js";
import { runNotice, statusLabel } from "../src/client/presentation.js";

describe("research run presentation", () => {
  test("a completed joined run stays visibly labeled as reused work", () => {
    expect(statusLabel("completed", "deduplicated")).toBe("Joined result");
  });

  test("a cached run explains why it completed immediately", () => {
    const run = { reuseKind: "cached" } as ResearchRun;
    expect(runNotice(run)).toBe("A fresh cached result was ready immediately.");
  });
});
