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
  getProjectRoot: vi.fn(() => process.cwd()),
}));

// Mock child_process
vi.mock("child_process", () => ({
  execSync: vi.fn((cmd) => {
    if (cmd.includes("tsc")) {
      if (cmd.includes("fail_ts")) return "error TS1234: Bad thing happened";
      return "Success";
    }
    if (cmd.includes("test")) {
      if (cmd.includes("fail_test")) return "1 failed, 0 passed";
      return "Success";
    }
    if (cmd.includes("git add")) return "";
    if (cmd.includes("git commit")) {
      if (cmd.includes("fail_git")) throw new Error("Git failed");
      return "";
    }
    if (cmd.includes("git rev-parse")) return "abcdef1";
    if (cmd.includes("build.mjs")) {
      if (cmd.includes("fail_build")) throw new Error("Build failed");
      return "Build success";
    }
    if (cmd.includes("git revert")) return "";
    return "";
  })
}));

// Mock process.kill
const originalKill = process.kill;
const mockKill = vi.fn();

describe("selfRunTestsTool", () => {
  let tmpDir: string;
  let originalCwd: string;
  let testTool: any;
  let restartTool: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    registeredTools.clear();
    
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "andromeda-tests-test-"));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
    
    // Create dummy package.json
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({
      scripts: { test: "vitest run" }
    }));
    
    // Reset module to clear cache
    vi.resetModules();
    
    // Override process.kill
    process.kill = mockKill as any;
    
    await import("./selfRunTestsTool");
    
    testTool = registeredTools.get("self_run_tests");
    restartTool = registeredTools.get("self_restart");
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.kill = originalKill;
  });

  describe("self_run_tests", () => {
    it("should pass when both succeed", async () => {
      const result = await testTool.execute({ check_type: "both" });
      
      expect(result.success).toBe(true);
      expect(result.output).toContain("0 errors");
      expect(result.output).toContain("all tests passed");
      expect(result.output).toContain("SAFE TO PROCEED");
    });

    it("should handle no test script", async () => {
      fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({
        scripts: { test: 'echo "Error: no test specified" && exit 1' }
      }));
      
      const result = await testTool.execute({ check_type: "tests" });
      
      expect(result.success).toBe(true);
      expect(result.output).toContain("no test script configured");
    });

    it("should report test failures", async () => {
      // We simulate test failure by overriding execSync for this test
      const { execSync } = await import("child_process");
      (execSync as any).mockImplementationOnce(() => "Success") // tsc
        .mockImplementationOnce(() => "1 failed, 0 passed"); // test
        
      const result = await testTool.execute({ check_type: "both" });
      
      expect(result.success).toBe(false);
      expect(result.output).toContain("failures detected");
      expect(result.output).toContain("DO NOT PROCEED");
    });

    it("should report TS failures", async () => {
      const { execSync } = await import("child_process");
      (execSync as any).mockImplementationOnce(() => "error TS1234: Bad thing happened"); // tsc
        
      const result = await testTool.execute({ check_type: "typescript" });
      
      expect(result.success).toBe(false);
      expect(result.output).toContain("1 error(s)");
      expect(result.output).toContain("error TS1234");
      expect(result.output).toContain("DO NOT PROCEED");
    });
  });

  describe("self_restart", () => {
    it("should require commit message", async () => {
      const result = await restartTool.execute({ commit_message: "short" });
      
      expect(result.success).toBe(false);
      expect(result.output).toContain("min 10 chars");
    });

    it("should restart successfully", async () => {
      const result = await restartTool.execute({ 
        commit_message: "Valid commit message",
        rebuild: true
      });
      
      expect(result.success).toBe(true);
      expect(result.output).toContain("Git snapshot created");
      expect(result.output).toContain("rebuilt successfully");
      expect(result.output).toContain("Restart signal written");
      expect(result.output).toContain("SIGUSR2 sent");
      
      expect(fs.existsSync(path.join(tmpDir, ".restart_signal"))).toBe(true);
      expect(mockKill).toHaveBeenCalledWith(process.pid, "SIGUSR2");
    });

    it("should handle build failure and rollback", async () => {
      const { execSync } = await import("child_process");
      (execSync as any).mockImplementation((cmd: string) => {
        if (cmd.includes("build.mjs")) throw new Error("Build failed");
        return "";
      });
      
      const result = await restartTool.execute({ 
        commit_message: "Valid commit message",
        rebuild: true
      });
      
      expect(result.success).toBe(false);
      expect(result.output).toContain("Build failed");
      expect(result.output).toContain("reverting last git commit");
    });

    it("should handle git failure gracefully", async () => {
      const { execSync } = await import("child_process");
      (execSync as any).mockImplementation((cmd: string) => {
        if (cmd.includes("git commit")) throw new Error("Git failed");
        return "";
      });
      
      const result = await restartTool.execute({ 
        commit_message: "Valid commit message",
        rebuild: false
      });
      
      expect(result.success).toBe(true);
      expect(result.output).toContain("Git snapshot skipped");
    });
  });
});
