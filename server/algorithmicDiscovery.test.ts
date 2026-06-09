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
    const longCode = "export function test() { return true; }\n// " + "A".repeat(600);
    if (prompt.includes("context_compression")) {
      return { content: "```typescript\n" + longCode + "\n```" };
    }
    if (prompt.includes("proposal_ranking")) {
      return { content: longCode }; // No markdown
    }
    if (prompt.includes("goal_decomposition")) {
      return { content: "too short" };
    }
    return { content: "" };
  })
}));

describe("algorithmicDiscovery", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "andromeda-algo-test-"));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should handle failed generation (too short)", async () => {
    const { discoverAlgorithm } = await import("./algorithmicDiscovery");
    mockScore = 50;
    
    const result = await discoverAlgorithm("goal_decomposition");
    expect(result.success).toBe(false);
    expect(result.filePath).toBe("");
  });

  it("should successfully discover and keep an algorithm if score improves", async () => {
    const { discoverAlgorithm } = await import("./algorithmicDiscovery");
    
    // First call baseline = 50
    // Second call newScore = 60
    let callCount = 0;
    const { runBenchmarks } = await import("./benchmarkRunner.js");
    (runBenchmarks as any).mockImplementation(async () => {
      callCount++;
      return { overallScore: callCount === 1 ? 50 : 60 };
    });
    
    const result = await discoverAlgorithm("context_compression");
    
    expect(result.success).toBe(true);
    expect(result.baselineScore).toBe(50);
    expect(result.newScore).toBe(60);
    expect(result.filePath).toContain("algo_context_compression_");
    expect(fs.existsSync(result.filePath)).toBe(true);
    
    const content = fs.readFileSync(result.filePath, "utf8");
    expect(content).toContain("export function test");
    expect(content).not.toContain("```typescript");
  });

  it("should reject an algorithm if score does not improve", async () => {
    const { discoverAlgorithm } = await import("./algorithmicDiscovery");
    
    // First call baseline = 50
    // Second call newScore = 40
    let callCount = 0;
    const { runBenchmarks } = await import("./benchmarkRunner.js");
    (runBenchmarks as any).mockImplementation(async () => {
      callCount++;
      return { overallScore: callCount === 1 ? 50 : 40 };
    });
    
    const result = await discoverAlgorithm("proposal_ranking");
    
    expect(result.success).toBe(false);
    expect(result.baselineScore).toBe(50);
    expect(result.newScore).toBe(40);
    expect(result.filePath).toBe("");
    
    // Ensure file was cleaned up
    const dir = path.join(tmpDir, "server", "algorithms");
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      expect(files.length).toBe(0);
    }
  });

  it("should handle benchmark crashes and clean up", async () => {
    const { discoverAlgorithm } = await import("./algorithmicDiscovery");
    
    let callCount = 0;
    const { runBenchmarks } = await import("./benchmarkRunner.js");
    (runBenchmarks as any).mockImplementation(async () => {
      callCount++;
      if (callCount === 2) throw new Error("Crash");
      return { overallScore: 50 };
    });
    
    const result = await discoverAlgorithm("context_compression");
    
    expect(result.success).toBe(false);
    expect(result.filePath).toBe("");
    
    // Ensure file was cleaned up
    const dir = path.join(tmpDir, "server", "algorithms");
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      expect(files.length).toBe(0);
    }
  });
});
