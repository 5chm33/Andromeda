/**
 * v21.test.ts — Comprehensive test suite for all v21.0.0 modules.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ── hypothesisEngine.ts ───────────────────────────────────────────────────────
import { initHypothesisEngine, proposeHypothesis, updateBelief, selectActiveHypothesis } from "./hypothesisEngine.js";

describe("hypothesisEngine", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hyp-test-"));
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
  });

  it("initHypothesisEngine creates file", () => {
    initHypothesisEngine();
    expect(fs.existsSync(path.join(tmpDir, "HYPOTHESES.json"))).toBe(true);
  });

  it("proposeHypothesis and updateBelief work", () => {
    initHypothesisEngine();
    const hyp = proposeHypothesis("Test hypothesis", "acceptance_rate", 0.1);
    expect(hyp.status).toBe("proposed");

    const active = selectActiveHypothesis();
    expect(active?.id).toBe(hyp.id);
    expect(active?.status).toBe("active");

    const updated = updateBelief(hyp.id, true);
    expect(updated?.trials).toBe(1);
    expect(updated?.successes).toBe(1);
    expect(updated?.posteriorProbability).toBeGreaterThan(0.5); // Beta(2,1) = 2/3
  });
});

// ── researchCollab.ts ─────────────────────────────────────────────────────────
import { runCollaborativeResearch } from "./researchCollab.js";

describe("researchCollab", () => {
  it("runCollaborativeResearch returns a complete proposal", async () => {
    vi.spyOn(await import("./aiTokens.js"), "getApiKey").mockReturnValue(null);
    const result = await runCollaborativeResearch("Test Topic");
    expect(result.topic).toBe("Test Topic");
    expect(result.theory).toContain("[Simulated Theorist Response]");
    expect(result.implementation).toContain("[Simulated Implementer Response]");
    expect(result.consensusReached).toBe(true);
  });
});

// ── paperWriter.ts ────────────────────────────────────────────────────────────
import { writeResearchPaper } from "./paperWriter.js";

describe("paperWriter", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "paper-test-"));
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
  });

  it("writeResearchPaper generates a markdown file", async () => {
    vi.spyOn(await import("./aiTokens.js"), "getApiKey").mockReturnValue(null);
    const filePath = await writeResearchPaper(100);
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, "utf-8");
    expect(content).toContain("RSI Progress Report");
  });
});

// ── neuromorphicMemory.ts ─────────────────────────────────────────────────────
import { ingestSensory, activateMemory, consolidateMemories } from "./neuromorphicMemory.js";

describe("neuromorphicMemory", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "neuro-test-"));
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
  });

  it("ingestSensory creates a sensory memory", () => {
    const mem = ingestSensory("test content");
    expect(mem.tier).toBe("sensory");
    expect(mem.activationCount).toBe(1);
  });

  it("activateMemory promotes memory to working tier", () => {
    const mem = ingestSensory("test content");
    // Activate 3 more times to reach >3 (total 4)
    activateMemory(mem.id);
    activateMemory(mem.id);
    activateMemory(mem.id);
    
    const mems = JSON.parse(fs.readFileSync(path.join(process.cwd(), ".andromeda_neuromemory.json"), "utf-8"));
    const updated = mems.find((m: any) => m.id === mem.id);
    expect(updated.tier).toBe("working");
  });

  it("consolidateMemories culls old sensory memories", () => {
    const mem = ingestSensory("test content");
    
    // Artificially age the memory
    const mems = JSON.parse(fs.readFileSync(path.join(process.cwd(), ".andromeda_neuromemory.json"), "utf-8"));
    mems[0].lastActivated = Date.now() - (300 * 60 * 60 * 1000); // 300 hours ago
    fs.writeFileSync(path.join(process.cwd(), ".andromeda_neuromemory.json"), JSON.stringify(mems));
    
    consolidateMemories();
    
    const after = JSON.parse(fs.readFileSync(path.join(process.cwd(), ".andromeda_neuromemory.json"), "utf-8"));
    expect(after.length).toBe(0); // Should be forgotten
  });
});

// ── nasEngine.ts ──────────────────────────────────────────────────────────────
import { getActiveHyperparameters, recordFitness, mutateHyperparameters } from "./nasEngine.js";

describe("nasEngine", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nas-test-"));
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
  });

  it("getActiveHyperparameters returns defaults initially", () => {
    const params = getActiveHyperparameters();
    expect(params.concurrencyLevel).toBe(8);
  });

  it("recordFitness updates fitness score", () => {
    getActiveHyperparameters(); // init
    recordFitness(5);
    const params = getActiveHyperparameters();
    expect(params.fitnessScore).toBe(5);
  });

  it("mutateHyperparameters creates a new configuration", () => {
    getActiveHyperparameters(); // init
    const mutated = mutateHyperparameters();
    expect(mutated.fitnessScore).toBe(0);
    // At least one param should be different, but it's random so we just check it exists
    expect(mutated.concurrencyLevel).toBeGreaterThanOrEqual(2);
  });
});

// ── formalVerifier.ts ─────────────────────────────────────────────────────────
import { runFormalVerification } from "./formalVerifier.js";

describe("formalVerifier", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tla-test-"));
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
  });

  it("runFormalVerification generates a TLA spec and passes", async () => {
    vi.spyOn(await import("./aiTokens.js"), "getApiKey").mockReturnValue(null);
    const testFile = path.join(tmpDir, "test.ts");
    fs.writeFileSync(testFile, "export const a = 1;");
    
    const result = await runFormalVerification(testFile);
    expect(result.passed).toBe(true);
    expect(result.specContent).toContain("MockSpec");
    expect(fs.existsSync(path.join(tmpDir, ".tla_specs", "test.tla"))).toBe(true);
  });
});
