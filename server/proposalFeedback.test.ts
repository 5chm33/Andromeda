import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("proposalFeedback", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "andromeda-feedback-test-"));
    originalCwd = process.cwd();
    
    // Change cwd so the module uses our tmpDir
    process.chdir(tmpDir);
    
    // Clear require cache so it re-evaluates __dirname / __filename logic
    vi.resetModules();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    
    // Clean up the actual file if it was created in the real workspace due to __dirname resolution
    const realWorkspacePath = path.join(originalCwd, "workspace", ".andromeda_proposal_feedback.json");
    if (fs.existsSync(realWorkspacePath)) {
      fs.rmSync(realWorkspacePath, { force: true });
    }
  });

  it("should record rejection feedback correctly", async () => {
    const { recordRejectionFeedback, getRejectionContext } = await import("./proposalFeedback");
    
    recordRejectionFeedback(
      "prop_123",
      "/path/to/target.ts",
      "Test proposal",
      "const a = 1;",
      "const a = 2;",
      "Syntax error: missing semicolon"
    );
    
    const context = getRejectionContext("/path/to/target.ts");
    expect(context).toContain("PREVIOUS FAILED PROPOSALS");
    expect(context).toContain("[SYNTAX]");
    expect(context).toContain("Test proposal");
    expect(context).toContain("Syntax error");
  });

  it("should classify rejection reasons correctly", async () => {
    const { recordRejectionFeedback, getRejectionContext } = await import("./proposalFeedback");
    
    // Constitution
    recordRejectionFeedback("p1", "f1.ts", "T1", "o", "p", "Blocked by constitution");
    expect(getRejectionContext("f1.ts")).toContain("[CONSTITUTION]");
    
    // Test failure
    recordRejectionFeedback("p2", "f2.ts", "T2", "o", "p", "Tests failed after apply");
    expect(getRejectionContext("f2.ts")).toContain("[TEST_FAILURE]");
    
    // Type error
    recordRejectionFeedback("p3", "f3.ts", "T3", "o", "p", "error TS2322");
    expect(getRejectionContext("f3.ts")).toContain("[TYPE_ERROR]");
    
    // Patch mismatch
    recordRejectionFeedback("p4", "f4.ts", "T4", "o", "p", "Patch mismatch");
    expect(getRejectionContext("f4.ts")).toContain("[PATCH_MISMATCH]");
    
    // Other
    recordRejectionFeedback("p5", "f5.ts", "T5", "o", "p", "Unknown error");
    expect(getRejectionContext("f5.ts")).toContain("[OTHER]");
  });

  it("should return empty context if no feedback exists", async () => {
    const { getRejectionContext } = await import("./proposalFeedback");
    
    const context = getRejectionContext("missing.ts");
    expect(context).toBe("");
  });

  it("should get file rejection stats", async () => {
    const { recordRejectionFeedback, getFileRejectionStats } = await import("./proposalFeedback");
    
    for (let i = 0; i < 9; i++) {
      recordRejectionFeedback(
        `prop_${i}`,
        "heavy.ts",
        `Title ${i}`,
        "o",
        "p",
        "Syntax error"
      );
    }
    
    const stats = getFileRejectionStats("heavy.ts");
    expect(stats.totalRejections).toBe(9);
    expect(stats.recentRejections).toBe(9);
    expect(stats.dominantCategory).toBe("syntax");
    expect(stats.shouldSkip).toBe(true);
  });

  it("should clear file feedback", async () => {
    const { recordRejectionFeedback, clearFileFeedback, getRejectionContext } = await import("./proposalFeedback");
    
    recordRejectionFeedback("p1", "clear.ts", "T1", "o", "p", "error");
    expect(getRejectionContext("clear.ts")).not.toBe("");
    
    clearFileFeedback("clear.ts");
    expect(getRejectionContext("clear.ts")).toBe("");
  });
});
