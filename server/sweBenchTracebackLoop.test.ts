import { describe, expect, it } from "vitest";
import { allowRecoveryPatchApplication } from "./sweBenchTracebackLoop.js";

describe("sweBenchTracebackLoop patch-application policy", () => {
  it("requires exact patch application by default", () => {
    expect(allowRecoveryPatchApplication()).toBe(false);
    expect(allowRecoveryPatchApplication({})).toBe(false);
  });

  it("permits fuzzy recovery only with an explicit opt-in", () => {
    expect(allowRecoveryPatchApplication({ allowRecoveryPatchApplication: true })).toBe(true);
  });
});
