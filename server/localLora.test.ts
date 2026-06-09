import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { EventEmitter } from "events";

// Mock dependencies
vi.mock("./logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })
}));

let mockExportDpoDatasetResult: any = { success: true, path: "/mock/dataset.jsonl" };
vi.mock("./selfDistillation.js", () => ({
  exportDpoDataset: vi.fn(() => mockExportDpoDatasetResult)
}));

// Mock child_process spawn
let mockSpawnExitCode = 0;
vi.mock("child_process", () => {
  return {
    spawn: vi.fn((cmd, args) => {
      const mockProcess = new EventEmitter() as any;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      
      setTimeout(() => {
        mockProcess.stdout.emit("data", Buffer.from("Training..."));
        if (mockSpawnExitCode !== 0) {
          mockProcess.stderr.emit("data", Buffer.from("Error"));
        }
        mockProcess.emit("close", mockSpawnExitCode);
      }, 10);
      
      return mockProcess;
    })
  };
});

describe("localLora", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "andromeda-lora-test-"));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
    
    mockExportDpoDatasetResult = { success: true, path: "/mock/dataset.jsonl" };
    mockSpawnExitCode = 0;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should write the python script if it does not exist", async () => {
    const { runLocalLoraTraining } = await import("./localLora");
    
    const result = await runLocalLoraTraining({
      modelId: "test-model",
      datasetPath: "/test/path.jsonl"
    });
    
    expect(result.success).toBe(true);
    
    const scriptPath = path.join(tmpDir, "scripts", "train_lora.py");
    expect(fs.existsSync(scriptPath)).toBe(true);
    
    const content = fs.readFileSync(scriptPath, "utf8");
    expect(content).toContain("import argparse");
    expect(content).toContain("DPOTrainer");
  });

  it("should extract dataset if not provided", async () => {
    const { runLocalLoraTraining } = await import("./localLora");
    const { exportDpoDataset } = await import("./selfDistillation");
    
    const result = await runLocalLoraTraining({
      modelId: "test-model"
    });
    
    expect(exportDpoDataset).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it("should fail if dataset extraction fails", async () => {
    const { runLocalLoraTraining } = await import("./localLora");
    mockExportDpoDatasetResult = { success: false, error: "Extraction failed" };
    
    const result = await runLocalLoraTraining({
      modelId: "test-model"
    });
    
    expect(result.success).toBe(false);
    expect(result.error).toContain("Extraction failed");
  });

  it("should fail if python process exits with non-zero code", async () => {
    const { runLocalLoraTraining } = await import("./localLora");
    mockSpawnExitCode = 1;
    
    const result = await runLocalLoraTraining({
      modelId: "test-model",
      datasetPath: "/test/path.jsonl"
    });
    
    expect(result.success).toBe(false);
    expect(result.error).toContain("exited with code 1");
  });
});
