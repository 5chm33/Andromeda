import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Mock dependencies
vi.mock("./logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })
}));

let mockScore = 50;

vi.mock("./benchmarkRunner.js", () => ({
  runBenchmarks: vi.fn(async () => {
    if (mockScore === -1) throw new Error("Benchmark crashed");
    return { overallScore: mockScore };
  })
}));

vi.mock("./llmProvider.js", () => ({
  getProviderForTier: vi.fn().mockReturnValue("pro-provider"),
  chatCompletion: vi.fn(async (messages) => {
    const prompt = messages[0].content;
    const longCode = "export function target() { return true; }\n// " + "A".repeat(600);
    
    if (prompt.includes("target1.ts")) {
      return { content: "```typescript\n" + longCode + "\n```" };
    }
    if (prompt.includes("target2.ts")) {
      return { content: longCode };
    }
    if (prompt.includes("target3.ts")) {
      return { content: "too short" };
    }
    return { content: "" };
  })
}));

describe("evolutionarySearch", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "andromeda-evo-test-"));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
    
    fs.mkdirSync(path.join(tmpDir, "server"), { recursive: true });
    
    // Create target files
    const origCode = "export function target() { return false; }\n// " + "B".repeat(600);
    fs.writeFileSync(path.join(tmpDir, "server", "target1.ts"), origCode);
    fs.writeFileSync(path.join(tmpDir, "server", "target2.ts"), origCode);
    fs.writeFileSync(path.join(tmpDir, "server", "target3.ts"), origCode);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should throw if target file does not exist", async () => {
    const { runEvolutionaryGeneration } = await import("./evolutionarySearch");
    
    await expect(runEvolutionaryGeneration("missing.ts", 1)).rejects.toThrow("Target file not found");
  });

  it("should handle failed mutation (too short)", async () => {
    const { runEvolutionaryGeneration } = await import("./evolutionarySearch");
    mockScore = 50;
    
    const result = await runEvolutionaryGeneration("target3.ts", 1);
    
    expect(result.success).toBe(false);
    expect(result.diff).toContain("Truncated output");
  });

  it("should keep mutation if fitness improves", async () => {
    const { runEvolutionaryGeneration } = await import("./evolutionarySearch");
    
    let callCount = 0;
    const { runBenchmarks } = await import("./benchmarkRunner.js");
    (runBenchmarks as any).mockImplementation(async () => {
      callCount++;
      return { overallScore: callCount === 1 ? 50 : 60 };
    });
    
    const result = await runEvolutionaryGeneration("target1.ts", 1);
    
    expect(result.success).toBe(true);
    expect(result.originalScore).toBe(50);
    expect(result.newScore).toBe(60);
    
    // Verify file was modified
    const content = fs.readFileSync(path.join(tmpDir, "server", "target1.ts"), "utf8");
    expect(content).toContain("export function target() { return true; }");
  });

  it("should rollback mutation if fitness decreases", async () => {
    const { runEvolutionaryGeneration } = await import("./evolutionarySearch");
    
    let callCount = 0;
    const { runBenchmarks } = await import("./benchmarkRunner.js");
    (runBenchmarks as any).mockImplementation(async () => {
      callCount++;
      return { overallScore: callCount === 1 ? 50 : 40 };
    });
    
    const result = await runEvolutionaryGeneration("target2.ts", 1);
    
    expect(result.success).toBe(false);
    expect(result.originalScore).toBe(50);
    expect(result.newScore).toBe(40);
    
    // Verify file was rolled back
    const content = fs.readFileSync(path.join(tmpDir, "server", "target2.ts"), "utf8");
    expect(content).toContain("export function target() { return false; }");
  });

  it("should rollback if benchmark crashes", async () => {
    const { runEvolutionaryGeneration } = await import("./evolutionarySearch");
    
    let callCount = 0;
    const { runBenchmarks } = await import("./benchmarkRunner.js");
    (runBenchmarks as any).mockImplementation(async () => {
      callCount++;
      if (callCount === 2) throw new Error("Crash");
      return { overallScore: 50 };
    });
    
    const result = await runEvolutionaryGeneration("target1.ts", 1);
    
    expect(result.success).toBe(false);
    
    // Verify file was rolled back
    const content = fs.readFileSync(path.join(tmpDir, "server", "target1.ts"), "utf8");
    expect(content).toContain("export function target() { return false; }");
  });
});
