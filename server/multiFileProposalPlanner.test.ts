import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// We need to mock LLM calls before importing the module
vi.mock("./llmProvider.js", () => {
  return {
    simpleChatCompletion: vi.fn().mockResolvedValue(JSON.stringify({
      title: "Test multi-file plan",
      rationale: "Improves code",
      category: "readability",
      impact: "high",
      confidence: 0.9,
      primaryFile: "primary.ts",
      primaryOriginalSnippet: "const old = true;",
      primaryProposedSnippet: "const newVar = true;",
      secondaryChanges: [
        {
          targetFile: "secondary.ts",
          originalSnippet: "import { old } from './primary';",
          proposedSnippet: "import { newVar } from './primary';",
          reason: "Update import"
        }
      ]
    }))
  };
});

// Mock importGraph
vi.mock("./importGraph.js", () => {
  return {
    getExportedSymbols: vi.fn().mockResolvedValue(["old"]),
    findSymbolUsages: vi.fn().mockResolvedValue(["/path/to/secondary.ts"])
  };
});

// Mock selfImprove to avoid errors when importing
vi.mock("./selfImprove.js", () => {
  return {
    analyzeAndPropose: vi.fn(),
    listProposals: vi.fn().mockReturnValue([])
  };
});

describe("multiFileProposalPlanner", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "andromeda-multifile-test-"));
    originalCwd = process.cwd();
    
    // Change cwd so the module uses our tmpDir
    process.chdir(tmpDir);
    
    // Create necessary directories and files
    fs.mkdirSync(path.join(tmpDir, "server"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "workspace"), { recursive: true });
    
    // In the test, import.meta.url resolves to the test file in the real server dir,
    // so we need to put the mock files there OR mock resolveServerFile.
    // Actually, let's just use the absolute path in the test
    fs.writeFileSync(path.join(originalCwd, "server", "primary.ts"), "const old = true;\nexport { old };");
    fs.writeFileSync(path.join(originalCwd, "server", "secondary.ts"), "import { old } from './primary';\nconsole.log(old);");
    
    // Clear require cache so it re-evaluates process.cwd()
    vi.resetModules();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(path.join(originalCwd, "server", "primary.ts"), { force: true });
    fs.rmSync(path.join(originalCwd, "server", "secondary.ts"), { force: true });
    fs.rmSync(path.join(originalCwd, "workspace", ".andromeda_proposals.json"), { force: true });
    vi.clearAllMocks();
  });

  it("should find related files using importGraph", async () => {
    const { findRelatedFiles } = await import("./multiFileProposalPlanner");
    
    const related = await findRelatedFiles("primary.ts");
    expect(related).toContain("secondary.ts");
  });

  it("should return null if primary file does not exist", async () => {
    const { planMultiFileImprovement } = await import("./multiFileProposalPlanner");
    
    const plan = await planMultiFileImprovement("missing.ts", ["secondary.ts"]);
    expect(plan).toBeNull();
  });

  it("should generate a multi-file proposal plan", async () => {
    const { planMultiFileImprovement } = await import("./multiFileProposalPlanner");
    
    const plan = await planMultiFileImprovement("primary.ts", ["secondary.ts"]);
    
    expect(plan).not.toBeNull();
    expect(plan?.title).toBe("Test multi-file plan");
    expect(plan?.primaryOriginalSnippet).toBe("const old = true;");
    expect(plan?.secondaryChanges.length).toBe(1);
    expect(plan?.secondaryChanges[0].targetFile).toBe("secondary.ts");
  });

  it("should submit a multi-file proposal to the store", async () => {
    const { submitMultiFileProposal } = await import("./multiFileProposalPlanner");
    
    const plan = {
      title: "Test multi-file plan",
      rationale: "Improves code",
      category: "readability" as const,
      impact: "high" as const,
      confidence: 0.9,
      primaryFile: "primary.ts",
      primaryOriginalSnippet: "const old = true;",
      primaryProposedSnippet: "const newVar = true;",
      secondaryChanges: [
        {
          targetFile: "secondary.ts",
          originalSnippet: "import { old } from './primary';",
          proposedSnippet: "import { newVar } from './primary';",
          reason: "Update import"
        }
      ]
    };
    
    const proposalId = await submitMultiFileProposal(plan);
    expect(proposalId).not.toBeNull();
    expect(proposalId).toContain("prop_multi_");
    
    // Verify it was written to the store
    // v10.3: process.cwd() is tmpDir (changed in beforeEach), so the store is written there
    const storePath = path.join(tmpDir, "workspace", ".andromeda_proposals.json");
    expect(fs.existsSync(storePath)).toBe(true);
    
    const store = JSON.parse(fs.readFileSync(storePath, "utf-8"));
    expect(store.proposals.length).toBe(1);
    expect(store.proposals[0].id).toBe(proposalId);
    expect(store.proposals[0]._multiFile).toBe(true);
    expect(store.proposals[0].secondaryChanges.length).toBe(1);
  });
});
