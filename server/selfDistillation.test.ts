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

let mockDbRows: any[] = [];
vi.mock("./andromedaDb.js", () => ({
  getDb: () => ({
    prepare: vi.fn(() => ({
      all: vi.fn(() => mockDbRows)
    }))
  })
}));

describe("selfDistillation", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "andromeda-distill-test-"));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
    mockDbRows = [];
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should extract empty dataset if no pairs exist", async () => {
    const { extractDpoDataset } = await import("./selfDistillation");
    
    mockDbRows = [
      { query: "q1", response: "r1", rating: 1 }, // Only positive
      { query: "q2", response: "r2", rating: -1 } // Only negative
    ];
    
    const dataset = extractDpoDataset();
    expect(dataset.length).toBe(0);
  });

  it("should extract DPO pairs correctly", async () => {
    const { extractDpoDataset } = await import("./selfDistillation");
    
    mockDbRows = [
      { query: "q1", response: "pos1", rating: 1 },
      { query: "q1", response: "neg1", rating: -1 },
      { query: "q1", response: "pos2", rating: 1 }, // Multiple positives
      { query: "q2", response: "pos", rating: 1 },
      { query: "q2", response: "neg", rating: -1 }
    ];
    
    const dataset = extractDpoDataset();
    expect(dataset.length).toBe(2);
    
    const q1Pair = dataset.find(p => p.prompt === "q1");
    expect(q1Pair).toBeDefined();
    expect(q1Pair?.chosen).toBe("pos1"); // First positive in array
    expect(q1Pair?.rejected).toBe("neg1"); // First negative in array
  });

  it("should fail export if no pairs exist", async () => {
    const { exportDpoDataset } = await import("./selfDistillation");
    
    mockDbRows = [];
    
    const result = exportDpoDataset();
    expect(result.success).toBe(false);
    expect(result.error).toContain("Not enough RLHF data");
  });

  it("should export dataset to JSONL", async () => {
    const { exportDpoDataset } = await import("./selfDistillation");
    
    mockDbRows = [
      { query: "q1", response: "pos1", rating: 1 },
      { query: "q1", response: "neg1", rating: -1 }
    ];
    
    const outPath = path.join(tmpDir, "custom.jsonl");
    const result = exportDpoDataset(outPath);
    
    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
    expect(result.path).toBe(outPath);
    
    expect(fs.existsSync(outPath)).toBe(true);
    const content = fs.readFileSync(outPath, "utf8");
    const parsed = JSON.parse(content);
    expect(parsed.prompt).toBe("q1");
    expect(parsed.chosen).toBe("pos1");
    expect(parsed.rejected).toBe("neg1");
  });
  
  it("should create default directory if path not provided", async () => {
    const { exportDpoDataset } = await import("./selfDistillation");
    
    mockDbRows = [
      { query: "q1", response: "pos1", rating: 1 },
      { query: "q1", response: "neg1", rating: -1 }
    ];
    
    const result = exportDpoDataset();
    
    expect(result.success).toBe(true);
    expect(result.path).toContain("data/dpo_dataset_");
    expect(fs.existsSync(result.path!)).toBe(true);
  });
});
