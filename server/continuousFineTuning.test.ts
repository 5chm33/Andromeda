import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("./logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })
}));

let mockGenerateRlaifPairsResult: any[] = [];
vi.mock("./rlaifJudge.js", () => ({
  generateRlaifPairs: vi.fn(async () => {
    return mockGenerateRlaifPairsResult;
  })
}));

let mockExportDpoDatasetResult: any = { success: true, count: 20, path: "/mock/dataset.jsonl" };
vi.mock("./selfDistillation.js", () => ({
  exportDpoDataset: vi.fn(() => mockExportDpoDatasetResult)
}));

let mockRunLocalLoraTrainingResult: any = { success: true };
vi.mock("./localLora.js", () => ({
  runLocalLoraTraining: vi.fn(async () => mockRunLocalLoraTrainingResult)
}));

describe("continuousFineTuning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateRlaifPairsResult = [{}, {}];
    mockExportDpoDatasetResult = { success: true, count: 20, path: "/mock/dataset.jsonl" };
    mockRunLocalLoraTrainingResult = { success: true };
  });

  it("should complete a successful nightly cycle", async () => {
    const { runNightlyFineTuningCycle } = await import("./continuousFineTuning");
    
    const result = await runNightlyFineTuningCycle();
    
    expect(result.success).toBe(true);
    expect(result.rlaifPairsGenerated).toBe(2);
    expect(result.totalDatasetSize).toBe(20);
    expect(result.outputDir).toContain("lora-");
  });

  it("should abort if dataset export fails", async () => {
    const { runNightlyFineTuningCycle } = await import("./continuousFineTuning");
    
    mockExportDpoDatasetResult = { success: false, error: "Disk full" };
    
    const result = await runNightlyFineTuningCycle();
    
    expect(result.success).toBe(false);
    expect(result.error).toContain("Dataset export failed");
  });

  it("should abort if insufficient data", async () => {
    const { runNightlyFineTuningCycle } = await import("./continuousFineTuning");
    
    mockExportDpoDatasetResult = { success: true, count: 5, path: "/mock/dataset.jsonl" };
    
    const result = await runNightlyFineTuningCycle();
    
    expect(result.success).toBe(false);
    expect(result.error).toContain("Insufficient data");
  });

  it("should abort if training fails", async () => {
    const { runNightlyFineTuningCycle } = await import("./continuousFineTuning");
    
    mockRunLocalLoraTrainingResult = { success: false, error: "OOM" };
    
    const result = await runNightlyFineTuningCycle();
    
    expect(result.success).toBe(false);
    expect(result.error).toContain("Training failed");
  });
});
