import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Mock the registry
const registeredTools = new Map();
vi.mock("./toolRegistry.js", () => ({
  registerTool: vi.fn((tool) => {
    registeredTools.set(tool.name, tool);
  })
}));

// Mock selfModifyHelpers
vi.mock("./selfModifyHelpers.js", () => ({
  isForbidden: vi.fn((p) => p.includes("forbidden")),
  resolveServerPath: vi.fn((p) => p),
  getServerDir: vi.fn(() => process.cwd()),
}));

// Mock twoPhaseCommit
vi.mock("../twoPhaseCommit.js", () => ({
  twoPhaseCommit: vi.fn(async ({ filePath, proposedContent }) => {
    if (proposedContent.includes("fail_commit")) {
      return {
        success: false,
        error: "Commit failed",
        phase: "validate",
        durationMs: 100
      };
    }
    
    // Simulate writing the file
    fs.writeFileSync(filePath, proposedContent);
    
    return {
      success: true,
      backupPath: filePath + ".bak",
      sha256After: "abcdef1234567890",
      phase: "commit",
      durationMs: 200
    };
  })
}));

// Mock selfTestGenerator
vi.mock("../selfTestGenerator.js", () => ({
  generateSmokeTests: vi.fn()
}));

// Mock selfReview
vi.mock("../selfReview.js", () => ({
  reviewAndGate: vi.fn((code) => {
    if (code.includes("bad_code")) {
      return {
        allowed: false,
        result: {
          score: 40,
          issues: [{ severity: "critical", message: "This is bad code" }]
        }
      };
    }
    if (code.includes("needs_fix")) {
      return {
        allowed: true,
        result: {
          score: 80,
          issues: [],
          autoFixCount: 1,
          fixedCode: "fixed_code"
        }
      };
    }
    return {
      allowed: true,
      result: { score: 95, issues: [] }
    };
  })
}));

describe("selfWriteFileTool", () => {
  let tmpDir: string;
  let originalCwd: string;
  let writeTool: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    registeredTools.clear();
    
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "andromeda-write-test-"));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
    
    // Reset module to clear cache
    vi.resetModules();
    await import("./selfWriteFileTool");
    
    writeTool = registeredTools.get("self_write_file");
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should write a file successfully", async () => {
    const filePath = path.join(tmpDir, "test.ts");
    fs.writeFileSync(filePath, "old content");
    
    const result = await writeTool.execute({
      file_path: filePath,
      content: "new content",
      rationale: "This is a long enough rationale to pass the thirty character limit"
    });
    
    expect(result.success).toBe(true);
    expect(result.output).toContain("Written:");
    expect(result.output).toContain("abcdef123456");
    
    const content = fs.readFileSync(filePath, "utf8");
    expect(content).toBe("new content");
  });

  it("should create a file if missing and create_if_missing is true", async () => {
    const filePath = path.join(tmpDir, "new_file.ts");
    
    const result = await writeTool.execute({
      file_path: filePath,
      content: "new content",
      rationale: "This is a long enough rationale to pass the thirty character limit",
      create_if_missing: true
    });
    
    expect(result.success).toBe(true);
    
    const content = fs.readFileSync(filePath, "utf8");
    expect(content).toBe("new content");
  });

  it("should fail if file is missing and create_if_missing is false", async () => {
    const filePath = path.join(tmpDir, "missing.ts");
    
    const result = await writeTool.execute({
      file_path: filePath,
      content: "new content",
      rationale: "This is a long enough rationale to pass the thirty character limit"
    });
    
    expect(result.success).toBe(false);
    expect(result.output).toContain("PATH VALIDATION GUARD");
    expect(result.output).toContain("does not exist");
  });

  it("should reject short rationale", async () => {
    const result = await writeTool.execute({
      file_path: "test.ts",
      content: "new content",
      rationale: "too short"
    });
    
    expect(result.success).toBe(false);
    expect(result.output).toContain("Rationale too short");
  });

  it("should reject forbidden files", async () => {
    const result = await writeTool.execute({
      file_path: "forbidden.ts",
      content: "new content",
      rationale: "This is a long enough rationale to pass the thirty character limit"
    });
    
    expect(result.success).toBe(false);
    expect(result.output).toContain("protected system file");
  });

  it("should enforce truncation guard on large content", async () => {
    const hugeContent = "a".repeat(3001);
    
    const result = await writeTool.execute({
      file_path: "test.ts",
      content: hugeContent,
      rationale: "This is a long enough rationale to pass the thirty character limit"
    });
    
    expect(result.success).toBe(false);
    expect(result.output).toContain("TRUNCATION GUARD");
  });

  it("should block write if self-review fails", async () => {
    const filePath = path.join(tmpDir, "test.ts");
    fs.writeFileSync(filePath, "old content");
    
    const result = await writeTool.execute({
      file_path: filePath,
      content: "bad_code",
      rationale: "This is a long enough rationale to pass the thirty character limit"
    });
    
    expect(result.success).toBe(false);
    expect(result.output).toContain("Self-review gate BLOCKED");
    expect(result.output).toContain("This is bad code");
  });

  it("should apply auto-fixes from self-review", async () => {
    const filePath = path.join(tmpDir, "test.ts");
    fs.writeFileSync(filePath, "old content");
    
    const result = await writeTool.execute({
      file_path: filePath,
      content: "needs_fix",
      rationale: "This is a long enough rationale to pass the thirty character limit"
    });
    
    expect(result.success).toBe(true);
    expect(result.output).toContain("auto-fix(es) applied");
    
    const content = fs.readFileSync(filePath, "utf8");
    expect(content).toBe("fixed_code");
  });

  it("should handle commit failure", async () => {
    const filePath = path.join(tmpDir, "test.ts");
    fs.writeFileSync(filePath, "old content");
    
    const result = await writeTool.execute({
      file_path: filePath,
      content: "fail_commit",
      rationale: "This is a long enough rationale to pass the thirty character limit"
    });
    
    expect(result.success).toBe(false);
    expect(result.output).toContain("Write FAILED");
    expect(result.output).toContain("Commit failed");
  });
});
