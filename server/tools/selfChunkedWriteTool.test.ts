import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { createHash } from "crypto";

// Mock the registry
const registeredTools = new Map();
vi.mock("./toolRegistry.js", () => ({
  registerTool: vi.fn((tool) => {
    registeredTools.set(tool.name, tool);
  })
}));

// Mock nanoid
vi.mock("nanoid", () => ({
  nanoid: vi.fn(() => "test-session-id")
}));

// Mock selfModifyHelpers
vi.mock("./selfModifyHelpers.js", () => ({
  isForbidden: vi.fn((p) => p.includes("forbidden")),
  resolveServerPath: vi.fn((p) => p),
  getProjectRoot: vi.fn(() => process.cwd())
}));

// Mock memory
vi.mock("../memory.js", () => ({
  storeMemory: vi.fn()
}));

// Mock child_process
vi.mock("child_process", () => ({
  execSync: vi.fn((cmd) => {
    if (cmd.includes("fail")) throw new Error("Compile failed");
    return Buffer.from("Success");
  })
}));

describe("selfChunkedWriteTool", () => {
  let tmpDir: string;
  let originalCwd: string;
  let chunkTool: any;
  let verifyTool: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    registeredTools.clear();
    
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "andromeda-chunk-test-"));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
    
    // Reset module to clear cache
    vi.resetModules();
    await import("./selfChunkedWriteTool");
    
    chunkTool = registeredTools.get("self_write_file_chunked");
    verifyTool = registeredTools.get("verify_file_integrity");
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("self_write_file_chunked", () => {
    it("should start a chunk session", async () => {
      const result = await chunkTool.execute({
        action: "start",
        filePath: path.join(tmpDir, "test.txt"),
        totalChunks: 2,
        expectedHash: "fakehash",
        rationale: "test"
      });
      
      expect(result.success).toBe(true);
      expect(result.output).toContain("test-session-id");
    });

    it("should fail to start for forbidden files", async () => {
      const result = await chunkTool.execute({
        action: "start",
        filePath: "forbidden.ts",
        totalChunks: 1
      });
      
      expect(result.success).toBe(false);
      expect(result.output).toContain("forbidden");
    });

    it("should receive chunks", async () => {
      // Start session
      await chunkTool.execute({
        action: "start",
        filePath: path.join(tmpDir, "test.txt"),
        totalChunks: 2
      });
      
      // Send chunk 0
      const result = await chunkTool.execute({
        action: "chunk",
        chunkSessionId: "test-session-id",
        chunkIndex: 0,
        chunkContent: "Hello "
      });
      
      expect(result.success).toBe(true);
      expect(result.output).toContain("1/2");
    });

    it("should finish and write file", async () => {
      const filePath = path.join(tmpDir, "test.txt");
      
      // Calculate real hash
      const content = "Hello World";
      const hash = createHash("sha256").update(content, "utf8").digest("hex");
      
      await chunkTool.execute({ action: "start", filePath, totalChunks: 2, expectedHash: hash });
      await chunkTool.execute({ action: "chunk", chunkSessionId: "test-session-id", chunkIndex: 0, chunkContent: "Hello " });
      await chunkTool.execute({ action: "chunk", chunkSessionId: "test-session-id", chunkIndex: 1, chunkContent: "World" });
      
      const result = await chunkTool.execute({ action: "finish", chunkSessionId: "test-session-id" });
      
      expect(result.success).toBe(true);
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.readFileSync(filePath, "utf8")).toBe(content);
    });

    it("should fail finish if hash mismatches", async () => {
      const filePath = path.join(tmpDir, "test.txt");
      
      await chunkTool.execute({ action: "start", filePath, totalChunks: 1, expectedHash: "wronghash".padEnd(64, "0") });
      await chunkTool.execute({ action: "chunk", chunkSessionId: "test-session-id", chunkIndex: 0, chunkContent: "Hello" });
      
      const result = await chunkTool.execute({ action: "finish", chunkSessionId: "test-session-id" });
      
      expect(result.success).toBe(false);
      expect(result.output).toContain("Integrity check FAILED");
    });

    it("should report status", async () => {
      await chunkTool.execute({ action: "start", filePath: "test.txt", totalChunks: 2 });
      await chunkTool.execute({ action: "chunk", chunkSessionId: "test-session-id", chunkIndex: 0, chunkContent: "Hello" });
      
      const result = await chunkTool.execute({ action: "status", chunkSessionId: "test-session-id" });
      
      expect(result.success).toBe(true);
      expect(result.output).toContain("1/2 chunks");
      expect(result.output).toContain("Missing: [1]");
    });
    
    it("should report global status", async () => {
      await chunkTool.execute({ action: "start", filePath: "test.txt", totalChunks: 2 });
      
      const result = await chunkTool.execute({ action: "status" });
      
      expect(result.success).toBe(true);
      expect(result.output).toContain("Active sessions");
      expect(result.output).toContain("test-session-id");
    });
    
    it("should abort session", async () => {
      await chunkTool.execute({ action: "start", filePath: "test.txt", totalChunks: 2 });
      
      const result = await chunkTool.execute({ action: "abort", chunkSessionId: "test-session-id" });
      
      expect(result.success).toBe(true);
      
      // Verify it's gone
      const statusResult = await chunkTool.execute({ action: "status" });
      expect(statusResult.output).toContain("No active");
    });
  });

  describe("verify_file_integrity", () => {
    it("should fail if file not found", async () => {
      const result = await verifyTool.execute({ filePath: "missing.txt" });
      expect(result.success).toBe(false);
      expect(result.output).toContain("File not found");
    });

    it("should verify file integrity", async () => {
      const filePath = path.join(tmpDir, "test.txt");
      const content = "Hello World";
      fs.writeFileSync(filePath, content);
      
      const hash = createHash("sha256").update(content, "utf8").digest("hex");
      
      const result = await verifyTool.execute({ filePath, expectedHash: hash });
      
      expect(result.success).toBe(true);
      expect(result.output).toContain("MATCH");
    });

    it("should report mismatch", async () => {
      const filePath = path.join(tmpDir, "test.txt");
      fs.writeFileSync(filePath, "Hello World");
      
      const result = await verifyTool.execute({ filePath, expectedHash: "wrong" });
      
      expect(result.success).toBe(true); // Tool execution succeeds
      expect(result.output).toContain("MISMATCH");
    });

    it("should check compile for ts files", async () => {
      const filePath = path.join(tmpDir, "test.ts");
      fs.writeFileSync(filePath, "console.log('hello');");
      
      const result = await verifyTool.execute({ filePath, checkCompile: true });
      
      expect(result.success).toBe(true);
      expect(result.output).toContain("No syntax errors");
    });
  });
});
