import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
  tmpDir = mkdtempSync(join(tmpdir(), "init-safety-test-"));
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("runBootIntegrityCheck", () => {
  it("should create .andromeda dir and write crash flag on first boot", async () => {
    const { runBootIntegrityCheck } = await import("./initSafety");
    await runBootIntegrityCheck();
    
    const andDir = join(tmpDir, ".andromeda");
    expect(existsSync(andDir)).toBe(true);
    expect(existsSync(join(andDir, ".boot_crash_flag"))).toBe(true);
    expect(existsSync(join(andDir, ".boot_count"))).toBe(true);
    expect(readFileSync(join(andDir, ".boot_count"), "utf-8")).toBe("1");
  });

  it("should increment boot count on subsequent boots", async () => {
    const { runBootIntegrityCheck } = await import("./initSafety");
    await runBootIntegrityCheck();
    await runBootIntegrityCheck();
    
    const bootCount = readFileSync(join(tmpDir, ".andromeda", ".boot_count"), "utf-8");
    expect(parseInt(bootCount)).toBe(2);
  });

  it("should detect and remove crash flag from previous boot", async () => {
    const { runBootIntegrityCheck } = await import("./initSafety");
    // First boot - creates crash flag
    await runBootIntegrityCheck();
    
    const andDir = join(tmpDir, ".andromeda");
    expect(existsSync(join(andDir, ".boot_crash_flag"))).toBe(true);
    
    // Second boot - should detect crash flag and remove it, then write new one
    await runBootIntegrityCheck();
    
    // Crash flag should still exist (new one written after old one removed)
    expect(existsSync(join(andDir, ".boot_crash_flag"))).toBe(true);
  });
});

describe("clearCrashFlag", () => {
  it("should remove the crash flag", async () => {
    const { runBootIntegrityCheck, clearCrashFlag } = await import("./initSafety");
    await runBootIntegrityCheck();
    
    const crashFlagPath = join(tmpDir, ".andromeda", ".boot_crash_flag");
    expect(existsSync(crashFlagPath)).toBe(true);
    
    clearCrashFlag();
    expect(existsSync(crashFlagPath)).toBe(false);
  });

  it("should not throw if crash flag does not exist", async () => {
    const { clearCrashFlag } = await import("./initSafety");
    expect(() => clearCrashFlag()).not.toThrow();
  });
});
