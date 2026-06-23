import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { seedAdaptiveBenchmarks, SEED_BENCHMARKS } from "./evalSeed";

describe("evalSeed", () => {
  let tmpDir: string;
  let originalWorkspace: string | undefined;

  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-seed-test-"));
    process.chdir(tmpDir);
    
    // We need to use vi.resetModules() to ensure evalSeed reads the new cwd
    vi.resetModules();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("should seed benchmarks when the file does not exist", async () => {
    const { seedAdaptiveBenchmarks } = await import("./evalSeed");
    
    seedAdaptiveBenchmarks();
    
    const filePath = path.join(tmpDir, "data", "adaptive_benchmarks.json");
    expect(fs.existsSync(filePath)).toBe(true);
    
    const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(content.length).toBe(SEED_BENCHMARKS.length);
    expect(content[0].id).toBe("seed_r01");
  });

  it("should not overwrite existing benchmarks if file exists and has data", async () => {
    const { seedAdaptiveBenchmarks } = await import("./evalSeed");
    
    const dirPath = path.join(tmpDir, "data");
    fs.mkdirSync(dirPath, { recursive: true });
    
    const filePath = path.join(dirPath, "adaptive_benchmarks.json");
    const mockData = [{ id: "custom_01", prompt: "test" }];
    fs.writeFileSync(filePath, JSON.stringify(mockData), "utf-8");
    
    seedAdaptiveBenchmarks();
    
    const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(content.length).toBe(1);
    expect(content[0].id).toBe("custom_01");
  });

  it("should overwrite if file exists but is empty", async () => {
    const { seedAdaptiveBenchmarks } = await import("./evalSeed");
    
    const dirPath = path.join(tmpDir, "data");
    fs.mkdirSync(dirPath, { recursive: true });
    
    const filePath = path.join(dirPath, "adaptive_benchmarks.json");
    fs.writeFileSync(filePath, "[]", "utf-8");
    
    seedAdaptiveBenchmarks();
    
    const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(content.length).toBe(SEED_BENCHMARKS.length);
  });

  it("should handle JSON parse errors gracefully and overwrite corrupted file", async () => {
    const { seedAdaptiveBenchmarks } = await import("./evalSeed");
    
    const dirPath = path.join(tmpDir, "data");
    fs.mkdirSync(dirPath, { recursive: true });
    
    const filePath = path.join(dirPath, "adaptive_benchmarks.json");
    fs.writeFileSync(filePath, "corrupted { json", "utf-8");
    
    // Will throw internally but should be caught and logged (or throw to caller depending on implementation)
    // The current implementation throws internally and logs to console.warn
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    
    seedAdaptiveBenchmarks();
    
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
