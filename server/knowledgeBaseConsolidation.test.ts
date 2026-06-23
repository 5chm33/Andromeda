import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// We need to mock LLM calls before importing the module
vi.mock("./llmProvider.js", () => {
  return {
    simpleChatCompletion: vi.fn().mockResolvedValue(JSON.stringify({
      redundantGroups: [[0, 1]],
      lowSignalIndices: [2],
      constitutionPatterns: ["never use eval()"],
      newInsights: ["Andromeda performs best when testing thoroughly"],
      consolidatedEntries: [{
        title: "Consolidated Arch",
        content: "Merged arch decision",
        section: "architecture",
        confidence: 0.9
      }]
    }))
  };
});

describe("knowledgeBaseConsolidation", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "andromeda-kb-test-"));
    originalCwd = process.cwd();
    
    // Create necessary directories
    fs.mkdirSync(path.join(tmpDir, "data"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "workspace"), { recursive: true });
    
    // Change cwd so the module uses our tmpDir
    process.chdir(tmpDir);
    
    // Clear require cache so it re-evaluates process.cwd()
    vi.resetModules();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("should skip consolidation if not due and not forced", async () => {
    const { runKBConsolidation } = await import("./knowledgeBaseConsolidation");
    
    // Create state file indicating it just ran
    const statePath = path.join(tmpDir, "data", "kb_consolidation_state.json");
    fs.writeFileSync(statePath, JSON.stringify({
      lastConsolidatedAt: Date.now() - 1000,
      history: []
    }));
    
    const result = await runKBConsolidation(false);
    expect(result).toBeNull();
  });

  it("should skip if knowledge base has fewer than 5 entries", async () => {
    const { runKBConsolidation } = await import("./knowledgeBaseConsolidation");
    
    // Create small KB
    const kbPath = path.join(tmpDir, "workspace", ".andromeda_knowledge_base.json");
    fs.writeFileSync(kbPath, JSON.stringify({
      architectureDecisions: [{ id: "1", title: "Test", content: "Test" }]
    }));
    
    const result = await runKBConsolidation(true);
    expect(result).toBeNull();
  });

  it("should run consolidation and update state correctly", async () => {
    const { runKBConsolidation, isKBConsolidationDue, getKBConsolidationSummary } = await import("./knowledgeBaseConsolidation");
    
    // Create KB with 5+ entries to trigger run
    const kbPath = path.join(tmpDir, "workspace", ".andromeda_knowledge_base.json");
    fs.writeFileSync(kbPath, JSON.stringify({
      architectureDecisions: [
        { id: "1", title: "Arch 1", content: "Test 1" },
        { id: "2", title: "Arch 2", content: "Test 2" },
        { id: "3", title: "Arch 3", content: "Test 3" }
      ],
      knownIssues: [
        { id: "4", title: "Issue 1", content: "Test 4" }
      ],
      learnings: [
        { id: "5", title: "Learning 1", content: "Test 5" }
      ]
    }));
    
    // Create constitution
    const constPath = path.join(tmpDir, "andromeda-constitution.json");
    fs.writeFileSync(constPath, JSON.stringify({
      version: "1.0",
      patterns: []
    }));
    
    // Run consolidation
    const result = await runKBConsolidation(true);
    
    expect(result).not.toBeNull();
    expect(result?.entriesBefore).toBe(5);
    expect(result?.redundantMerged).toBe(1); // from redundantGroups [[0, 1]]
    expect(result?.archived).toBe(1); // from lowSignalIndices [2]
    expect(result?.promotedToConstitution).toBe(1);
    expect(result?.newInsights.length).toBe(1);
    
    // Verify updated KB
    const updatedKb = JSON.parse(fs.readFileSync(kbPath, "utf-8"));
    // 3 arch - 2 removed (index 1, 2) + 1 consolidated = 2
    expect(updatedKb.architectureDecisions.length).toBe(2);
    // 1 issue - 0 removed = 1
    expect(updatedKb.knownIssues.length).toBe(1);
    // 1 learning - 0 removed + 1 insight = 2
    expect(updatedKb.learnings.length).toBe(2);
    
    // Verify constitution
    const updatedConst = JSON.parse(fs.readFileSync(constPath, "utf-8"));
    expect(updatedConst.patterns).toContain("never use eval()");
    
    // Verify archive
    const archivePath = path.join(tmpDir, "data", "archived_kb_entries.json");
    expect(fs.existsSync(archivePath)).toBe(true);
    const archive = JSON.parse(fs.readFileSync(archivePath, "utf-8"));
    expect(archive.length).toBe(1);
    expect(archive[0].count).toBe(2); // 2 entries removed
    
    // Verify state
    expect(isKBConsolidationDue()).toBe(false);
    
    // Verify summary
    const summary = getKBConsolidationSummary();
    expect(summary).toContain("entries");
  });

  it("should handle missing constitution file gracefully", async () => {
    const { runKBConsolidation } = await import("./knowledgeBaseConsolidation");
    
    // Create KB with 5+ entries to trigger run
    const kbPath = path.join(tmpDir, "workspace", ".andromeda_knowledge_base.json");
    fs.writeFileSync(kbPath, JSON.stringify({
      architectureDecisions: [
        { id: "1", title: "Arch 1", content: "Test 1" },
        { id: "2", title: "Arch 2", content: "Test 2" },
        { id: "3", title: "Arch 3", content: "Test 3" },
        { id: "4", title: "Arch 4", content: "Test 4" },
        { id: "5", title: "Arch 5", content: "Test 5" }
      ]
    }));
    
    // Run consolidation without creating constitution file
    const result = await runKBConsolidation(true);
    
    expect(result).not.toBeNull();
    expect(result?.promotedToConstitution).toBe(1);
    
    // Verify constitution was created
    const constPath = path.join(tmpDir, "andromeda-constitution.json");
    expect(fs.existsSync(constPath)).toBe(true);
    const updatedConst = JSON.parse(fs.readFileSync(constPath, "utf-8"));
    expect(updatedConst.patterns).toContain("never use eval()");
  });
  
  it("should start the daemon correctly", async () => {
    const { startKBConsolidationDaemon } = await import("./knowledgeBaseConsolidation");
    
    vi.useFakeTimers();
    
    // Should not throw
    startKBConsolidationDaemon();
    
    vi.useRealTimers();
  });
});
