import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// We need to mock LLM calls before importing the module
vi.mock("./llmProvider.js", () => {
  return {
    simpleChatCompletion: vi.fn().mockResolvedValue(JSON.stringify({
      toolName: "TestTool",
      toolDescription: "A test tool",
      filename: "testTool.ts",
      code: "export const testTool = async () => { return true; };\n"
    }))
  };
});

// Mock child_process.execSync to bypass validateInSandbox and validateAtRuntime
vi.mock("child_process", () => {
  return {
    execSync: vi.fn().mockReturnValue(Buffer.from("success"))
  };
});

describe("capabilityBootstrapper", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "capability-bootstrapper-test-"));
    process.chdir(tmpDir);
    
    vi.resetModules();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    vi.clearAllMocks();
  });

  it("should log a new capability gap", async () => {
    const { registerCapabilityGap } = await import("./capabilityBootstrapper");
    
    registerCapabilityGap(
      "test_source",
      "Missing PDF parsing",
      "Tried to read a PDF file"
    );
    
    const gapsPath = path.join(tmpDir, "data", "capability_gaps.json");
    expect(fs.existsSync(gapsPath)).toBe(true);
    
    const gaps = JSON.parse(fs.readFileSync(gapsPath, "utf-8"));
    expect(gaps.length).toBe(1);
    expect(gaps[0].source).toBe("test_source");
    expect(gaps[0].description).toBe("Missing PDF parsing");
    expect(gaps[0].status).toBe("pending");
  });

  it("should bootstrap a capability and generate a proposal", async () => {
    const { registerCapabilityGap, bootstrapCapability } = await import("./capabilityBootstrapper");
    
    // Create a gap
    registerCapabilityGap("test_source", "Needs PDF parsing", "Failed to read PDF");
    const gapsPath = path.join(tmpDir, "data", "capability_gaps.json");
    const gaps = JSON.parse(fs.readFileSync(gapsPath, "utf-8"));
    const gapId = gaps[0].id;
    
    // Bootstrap it
    const result = await bootstrapCapability(gapId);
    
    expect(result).not.toBeNull();
    expect(result?.toolName).toBe("TestTool");
    expect(result?.validationPassed).toBe(true);
    
    // Check that gap status was updated
    const updatedGaps = JSON.parse(fs.readFileSync(gapsPath, "utf-8"));
    expect(updatedGaps[0].status).toBe("bootstrapped");
    
    // Check that a proposal was created
    const proposalsPath = path.join(tmpDir, "workspace", ".andromeda_proposals.json");
    expect(fs.existsSync(proposalsPath)).toBe(true);
    const proposalsStore = JSON.parse(fs.readFileSync(proposalsPath, "utf-8"));
    expect(proposalsStore.proposals.length).toBe(1);
    expect(proposalsStore.proposals[0].targetFile).toBe("tools/testTool.ts");
  });

  it("should return null when bootstrapping an invalid gap ID", async () => {
    const { bootstrapCapability } = await import("./capabilityBootstrapper");
    const result = await bootstrapCapability("invalid-id");
    expect(result).toBeNull();
  });

  it("should return a summary of bootstrapping activity", async () => {
    const { registerCapabilityGap, getBootstrapSummary } = await import("./capabilityBootstrapper");
    
    // Initial summary
    expect(getBootstrapSummary()).toContain("Gaps: 0 total | 0 pending");
    
    // Log a gap
    registerCapabilityGap("test", "test", "test");
    expect(getBootstrapSummary()).toContain("Gaps: 1 total | 1 pending");
  });

  it("should process pending gaps up to limit of 2", async () => {
    const { registerCapabilityGap, processPendingGaps } = await import("./capabilityBootstrapper");
    
    // Create 3 gaps
    registerCapabilityGap("src1", "desc1", "fail1");
    registerCapabilityGap("src2", "desc2", "fail2");
    registerCapabilityGap("src3", "desc3", "fail3");
    
    // Process them
    await processPendingGaps();
    
    const gapsPath = path.join(tmpDir, "data", "capability_gaps.json");
    const gaps = JSON.parse(fs.readFileSync(gapsPath, "utf-8"));
    
    // Only 2 should be processed
    const bootstrappedCount = gaps.filter((g: any) => g.status === "bootstrapped").length;
    const pendingCount = gaps.filter((g: any) => g.status === "pending").length;
    
    expect(bootstrappedCount).toBe(2);
    expect(pendingCount).toBe(1);
  });
});
