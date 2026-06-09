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
  resolveServerPath: vi.fn((p) => p),
}));

describe("selfDiffReadTool", () => {
  let tmpDir: string;
  let originalCwd: string;
  let diffTool: any;
  let readTool: any;
  let readFileTool: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    registeredTools.clear();
    
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "andromeda-diff-test-"));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
    
    // Reset module to clear cache
    vi.resetModules();
    await import("./selfDiffReadTool");
    
    diffTool = registeredTools.get("self_diff");
    readTool = registeredTools.get("self_read_server_file");
    readFileTool = registeredTools.get("self_read_file");
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("self_diff", () => {
    it("should fail if file not found", async () => {
      const result = await diffTool.execute({ filePath: "missing.ts", proposedContent: "test" });
      expect(result.success).toBe(false);
      expect(result.output).toContain("not found");
    });

    it("should generate a full file diff", async () => {
      const filePath = path.join(tmpDir, "test.ts");
      fs.writeFileSync(filePath, "line1\nline2\nline3");
      
      const result = await diffTool.execute({ 
        filePath, 
        proposedContent: "line1\nline2_changed\nline3" 
      });
      
      expect(result.success).toBe(true);
      expect(result.output).toContain("Diff preview");
      expect(result.output).toContain("-line2");
      expect(result.output).toContain("+line2_changed");
    });

    it("should generate a patch diff", async () => {
      const filePath = path.join(tmpDir, "test.ts");
      fs.writeFileSync(filePath, "line1\nline2\nline3");
      
      const result = await diffTool.execute({ 
        filePath, 
        originalSnippet: "line2",
        proposedSnippet: "line2_changed"
      });
      
      expect(result.success).toBe(true);
      expect(result.output).toContain("patch diff");
      expect(result.output).toContain("-line2");
      expect(result.output).toContain("+line2_changed");
    });

    it("should fail if original snippet not found", async () => {
      const filePath = path.join(tmpDir, "test.ts");
      fs.writeFileSync(filePath, "line1\nline2\nline3");
      
      const result = await diffTool.execute({ 
        filePath, 
        originalSnippet: "missing",
        proposedSnippet: "changed"
      });
      
      expect(result.success).toBe(false);
      expect(result.output).toContain("not found in");
    });

    it("should report if no differences", async () => {
      const filePath = path.join(tmpDir, "test.ts");
      fs.writeFileSync(filePath, "line1\nline2");
      
      const result = await diffTool.execute({ 
        filePath, 
        proposedContent: "line1\nline2" 
      });
      
      expect(result.success).toBe(true);
      expect(result.output).toContain("No differences found");
    });
  });

  describe("self_read_server_file", () => {
    it("should read a file with line numbers", async () => {
      const filePath = path.join(tmpDir, "test.ts");
      fs.writeFileSync(filePath, "line1\nline2\nline3");
      
      const result = await readTool.execute({ file_path: filePath });
      
      expect(result.success).toBe(true);
      expect(result.output).toContain("1 | line1");
      expect(result.output).toContain("3 | line3");
    });

    it("should handle start and end lines", async () => {
      const filePath = path.join(tmpDir, "test.ts");
      fs.writeFileSync(filePath, "line1\nline2\nline3\nline4\nline5");
      
      const result = await readTool.execute({ 
        file_path: filePath,
        start_line: 2,
        end_line: 4
      });
      
      expect(result.success).toBe(true);
      expect(result.output).toContain("2 | line2");
      expect(result.output).toContain("4 | line4");
      expect(result.output).not.toContain("1 | line1");
      expect(result.output).toContain("Showing lines 2-4 of 5 total");
    });

    it("should fail if file not found", async () => {
      const result = await readTool.execute({ file_path: "missing.ts" });
      expect(result.success).toBe(false);
      expect(result.output).toContain("not found");
    });
  });

  describe("self_read_file (alias)", () => {
    it("should work just like self_read_server_file", async () => {
      const filePath = path.join(tmpDir, "test.ts");
      fs.writeFileSync(filePath, "line1\nline2\nline3");
      
      const result = await readFileTool.execute({ file_path: filePath });
      
      expect(result.success).toBe(true);
      expect(result.output).toContain("1 | line1");
    });
  });
});
