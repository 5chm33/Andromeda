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
}));

// Mock memory
vi.mock("../memory.js", () => ({
  storeMemory: vi.fn()
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
    return {
      allowed: true,
      result: { score: 95, issues: [] }
    };
  })
}));

describe("selfPatchFileTool", () => {
  let tmpDir: string;
  let originalCwd: string;
  let patchTool: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    registeredTools.clear();
    
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "andromeda-patch-test-"));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
    
    // Reset module to clear cache
    vi.resetModules();
    await import("./selfPatchFileTool");
    
    patchTool = registeredTools.get("self_patch_file");
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should patch a file successfully", async () => {
    const filePath = path.join(tmpDir, "test.ts");
    fs.writeFileSync(filePath, "line1\nline2\nline3");
    
    const result = await patchTool.execute({
      file_path: filePath,
      original_snippet: "line2",
      proposed_snippet: "line2_changed",
      rationale: "This is a long enough rationale to pass the thirty character limit"
    });
    
    expect(result.success).toBe(true);
    expect(result.output).toContain("Patched");
    
    const content = fs.readFileSync(filePath, "utf8");
    expect(content).toBe("line1\nline2_changed\nline3");
    expect(fs.existsSync(filePath + ".bak")).toBe(true);
  });

  it("should handle missing required parameters", async () => {
    const result = await patchTool.execute({
      file_path: "test.ts",
      original_snippet: "line2"
    });
    
    expect(result.success).toBe(false);
    expect(result.output).toContain("are all required");
  });

  it("should reject short rationale", async () => {
    const result = await patchTool.execute({
      file_path: "test.ts",
      original_snippet: "line2",
      proposed_snippet: "line2_changed",
      rationale: "too short"
    });
    
    expect(result.success).toBe(false);
    expect(result.output).toContain("Rationale too short");
  });

  it("should enforce hard limit on proposed snippet size", async () => {
    const hugeSnippet = "a".repeat(6001);
    
    const result = await patchTool.execute({
      file_path: "test.ts",
      original_snippet: "line2",
      proposed_snippet: hugeSnippet,
      rationale: "This is a long enough rationale to pass the thirty character limit"
    });
    
    expect(result.success).toBe(false);
    expect(result.output).toContain("HARD GUARD");
  });

  it("should reject forbidden files", async () => {
    const result = await patchTool.execute({
      file_path: "forbidden.ts",
      original_snippet: "line2",
      proposed_snippet: "line2_changed",
      rationale: "This is a long enough rationale to pass the thirty character limit"
    });
    
    expect(result.success).toBe(false);
    expect(result.output).toContain("protected system file");
  });

  it("should fail if snippet not found", async () => {
    const filePath = path.join(tmpDir, "test.ts");
    fs.writeFileSync(filePath, "line1\nline2\nline3");
    
    const result = await patchTool.execute({
      file_path: filePath,
      original_snippet: "missing",
      proposed_snippet: "changed",
      rationale: "This is a long enough rationale to pass the thirty character limit"
    });
    
    expect(result.success).toBe(false);
    expect(result.output).toContain("not found in");
  });

  it("should block patch if self-review fails", async () => {
    const filePath = path.join(tmpDir, "test.ts");
    fs.writeFileSync(filePath, "line1\nline2\nline3");
    
    const result = await patchTool.execute({
      file_path: filePath,
      original_snippet: "line2",
      proposed_snippet: "bad_code",
      rationale: "This is a long enough rationale to pass the thirty character limit"
    });
    
    expect(result.success).toBe(false);
    expect(result.output).toContain("Self-review gate BLOCKED");
    expect(result.output).toContain("This is bad code");
    
    // File should not be modified
    const content = fs.readFileSync(filePath, "utf8");
    expect(content).toBe("line1\nline2\nline3");
  });

  it("should handle line ending normalization", async () => {
    const filePath = path.join(tmpDir, "test.ts");
    fs.writeFileSync(filePath, "line1\r\nline2\r\nline3");
    
    const result = await patchTool.execute({
      file_path: filePath,
      original_snippet: "line2\n",
      proposed_snippet: "line2_changed\n",
      rationale: "This is a long enough rationale to pass the thirty character limit"
    });
    
    expect(result.success).toBe(true);
    expect(result.output).toContain("normalized line endings");
    
    const content = fs.readFileSync(filePath, "utf8");
    expect(content).toContain("line2_changed");
  });
});
