/**
 * crossProposalConflictDetector.test.ts — Comprehensive tests for crossProposalConflictDetector.ts
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  checkProposalConflicts,
  extractChangedExports,
  buildAppliedRecord,
  recordAppliedProposal,
  getRecentlyApplied,
  clearRecentlyApplied,
} from "./crossProposalConflictDetector.js";

const PROJECT_ROOT = "/project";

beforeEach(() => {
  clearRecentlyApplied();
});

describe("buildAppliedRecord", () => {
  it("builds a valid applied record with required fields", () => {
    const record = buildAppliedRecord("prop-1", "/server/foo.ts", "const x = 1;");
    expect(record.id).toBe("prop-1");
    expect(record.targetFile).toBe("/server/foo.ts");
    expect(record.appliedAt).toBeGreaterThan(0);
    expect(Array.isArray(record.changedExports)).toBe(true);
  });

  it("includes changedExports in the record", () => {
    const record = buildAppliedRecord("p1", "/server/foo.ts", "export function doThing() {}");
    expect(record.changedExports).toContain("doThing");
  });

  it("truncates long snippets to 500 chars", () => {
    const longSnippet = "x".repeat(1000);
    const record = buildAppliedRecord("p1", "/server/foo.ts", longSnippet);
    expect((record.snippet ?? "").length).toBeLessThanOrEqual(500);
  });
});

describe("recordAppliedProposal and getRecentlyApplied", () => {
  it("adds a record to the recently applied list", () => {
    const record = buildAppliedRecord("prop-1", "/server/foo.ts", "const x = 1;");
    recordAppliedProposal(record);
    const recent = getRecentlyApplied();
    expect(recent.length).toBe(1);
    expect(recent[0].id).toBe("prop-1");
  });

  it("accumulates multiple records", () => {
    recordAppliedProposal(buildAppliedRecord("p1", "/server/a.ts", "const a = 1;"));
    recordAppliedProposal(buildAppliedRecord("p2", "/server/b.ts", "const b = 2;"));
    recordAppliedProposal(buildAppliedRecord("p3", "/server/c.ts", "const c = 3;"));
    expect(getRecentlyApplied().length).toBe(3);
  });

  it("filters out stale records beyond the lookback window", () => {
    const staleRecord = buildAppliedRecord("stale", "/server/old.ts", "const old = 1;");
    (staleRecord as any).appliedAt = Date.now() - 2 * 60 * 60 * 1000;
    recordAppliedProposal(staleRecord);
    const recent = getRecentlyApplied();
    expect(recent.find(r => r.id === "stale")).toBeUndefined();
  });
});

describe("extractChangedExports", () => {
  it("extracts exported function names", () => {
    const snippet = "export function doThing() {}\nexport function doOther() {}";
    const exports = extractChangedExports(snippet);
    expect(exports).toContain("doThing");
    expect(exports).toContain("doOther");
  });

  it("extracts exported const names", () => {
    const snippet = "export const MY_CONST = 42;";
    const exports = extractChangedExports(snippet);
    expect(exports).toContain("MY_CONST");
  });

  it("extracts exported class names", () => {
    const snippet = "export class MyService {}";
    const exports = extractChangedExports(snippet);
    expect(exports).toContain("MyService");
  });

  it("extracts exported interface names", () => {
    const snippet = "export interface IUser { name: string; }";
    const exports = extractChangedExports(snippet);
    expect(exports).toContain("IUser");
  });

  it("returns empty array for snippets with no exports", () => {
    const snippet = "const x = 1;\nconst y = 2;";
    const exports = extractChangedExports(snippet);
    expect(exports).toHaveLength(0);
  });

  it("handles empty snippets", () => {
    expect(extractChangedExports("")).toHaveLength(0);
  });
});

describe("checkProposalConflicts", () => {
  it("returns no conflicts when recentlyApplied is empty", async () => {
    const result = await checkProposalConflicts("p1", "/server/foo.ts", "const x = 1;", [], PROJECT_ROOT);
    expect(result.hasConflicts).toBe(false);
    expect(result.conflicts).toHaveLength(0);
    expect(result.suggestedAction).toBe("proceed");
  });

  it("returns no conflicts for a proposal targeting a new file", async () => {
    const recent = [buildAppliedRecord("p1", "/server/existing.ts", "const x = 1;")];
    const result = await checkProposalConflicts("p2", "/server/newFile.ts", "const y = 2;", recent, PROJECT_ROOT);
    expect(result.hasConflicts).toBe(false);
  });

  it("detects a SAME_FILE conflict when same file was recently modified", async () => {
    const recent = [buildAppliedRecord("p1", "/server/shared.ts", "function foo() {}")];
    const result = await checkProposalConflicts("p2", "/server/shared.ts", "function bar() {}", recent, PROJECT_ROOT);
    expect(result.hasConflicts).toBe(true);
    expect(result.conflicts.length).toBeGreaterThan(0);
    expect(result.conflicts[0].type).toBe("SAME_FILE");
    expect(result.conflicts[0].severity).toBe("critical");
    expect(result.criticalCount).toBe(1);
    expect(result.suggestedAction).toBe("regenerate");
  });

  it("detects a SIGNATURE_CONFLICT when two proposals reference the same export", async () => {
    const snippet1 = "export function processData(data: string) { return data; }";
    // snippet2 references processData which was changed by p1
    const snippet2 = "const result = processData(42);";
    const recent = [buildAppliedRecord("p1", "/server/processor.ts", snippet1)];
    const result = await checkProposalConflicts("p2", "/server/consumer.ts", snippet2, recent, PROJECT_ROOT);
    expect(result.hasConflicts).toBe(true);
    const sigConflict = result.conflicts.find(c => c.type === "SIGNATURE_CONFLICT");
    expect(sigConflict).toBeDefined();
    expect(sigConflict?.conflictingProposalId).toBe("p1");
  });

  it("ignores stale records beyond the lookback window", async () => {
    const staleRecord = buildAppliedRecord("stale", "/server/shared.ts", "function old() {}");
    (staleRecord as any).appliedAt = Date.now() - 2 * 60 * 60 * 1000;
    const result = await checkProposalConflicts("p-new", "/server/shared.ts", "function new_() {}", [staleRecord], PROJECT_ROOT);
    expect(result.hasConflicts).toBe(false);
  });

  it("returns durationMs >= 0", async () => {
    const result = await checkProposalConflicts("p1", "/server/foo.ts", "const x = 1;", [], PROJECT_ROOT);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns severity information in conflicts", async () => {
    const recent = [buildAppliedRecord("p1", "/server/conflict.ts", "function foo() {}")];
    const result = await checkProposalConflicts("p2", "/server/conflict.ts", "function bar() {}", recent, PROJECT_ROOT);
    if (result.hasConflicts) {
      for (const conflict of result.conflicts) {
        expect(["critical", "warning"]).toContain(conflict.severity);
      }
    }
  });

  it("does not flag proposals with no shared exports or files", async () => {
    const recent = [buildAppliedRecord("p1", "/server/a.ts", "export function aFunc() {}")];
    const result = await checkProposalConflicts("p2", "/server/b.ts", "export function bFunc() {}", recent, PROJECT_ROOT);
    // No same-file conflict, no signature conflict (different function names)
    const sameFile = result.conflicts.filter(c => c.type === "SAME_FILE");
    expect(sameFile).toHaveLength(0);
  });
});

describe("clearRecentlyApplied", () => {
  it("clears all records from the recently applied list", () => {
    recordAppliedProposal(buildAppliedRecord("p1", "/server/a.ts", "const a = 1;"));
    recordAppliedProposal(buildAppliedRecord("p2", "/server/b.ts", "const b = 2;"));
    clearRecentlyApplied();
    expect(getRecentlyApplied()).toHaveLength(0);
  });
});
