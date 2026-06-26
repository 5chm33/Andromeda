/**
 * v22.test.ts — Comprehensive test suite for all v22.0.0 modules.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ── metaRsiAgent.ts ───────────────────────────────────────────────────────────
import { initMetaRsi, recordMetaVelocity, getMetaVelocity, runMetaRsiPass } from "./metaRsiAgent.js";

describe("metaRsiAgent", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-test-"));
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
  });

  it("initMetaRsi creates velocity file", () => {
    initMetaRsi();
    expect(fs.existsSync(path.join(tmpDir, ".meta_velocity.json"))).toBe(true);
    expect(getMetaVelocity()).toBe(1.0);
  });

  it("recordMetaVelocity updates velocity", () => {
    initMetaRsi();
    recordMetaVelocity(1.05);
    expect(getMetaVelocity()).toBe(1.05);
  });

  it("runMetaRsiPass runs and updates velocity (mocked)", async () => {
    initMetaRsi();
    vi.spyOn(await import("./aiTokens.js"), "getApiKey").mockReturnValue(null);
    
    // Create mock target files
    fs.mkdirSync(path.join(tmpDir, "server"));
    fs.writeFileSync(path.join(tmpDir, "server", "selfImprove.ts"), "const a = 1;");
    fs.writeFileSync(path.join(tmpDir, "server", "rsiEngine.ts"), "const a = 1;");
    fs.writeFileSync(path.join(tmpDir, "server", "proposalGen.ts"), "const a = 1;");

    const result = await runMetaRsiPass();
    expect(result).toBe(true);
    expect(getMetaVelocity()).toBe(1.05);
  });
});

// ── causalWorldModel.ts ───────────────────────────────────────────────────────
import { initCausalModel, recordCausalObservation, evaluateIntervention } from "./causalWorldModel.js";

describe("causalWorldModel", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "causal-test-"));
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
  });

  it("initCausalModel creates DAG file", () => {
    initCausalModel();
    expect(fs.existsSync(path.join(tmpDir, ".causal_model.json"))).toBe(true);
  });

  it("recordCausalObservation builds DAG and updates probabilities", () => {
    initCausalModel();
    recordCausalObservation("changeA", "outcomeB", true);
    
    const dag = JSON.parse(fs.readFileSync(path.join(tmpDir, ".causal_model.json"), "utf-8"));
    expect(dag.nodes["changeA"]).toBeDefined();
    expect(dag.nodes["outcomeB"]).toBeDefined();
    expect(dag.nodes["outcomeB"].parents).toContain("changeA");
    
    // Probability should increase from 0.5
    expect(dag.nodes["outcomeB"].probability).toBeGreaterThan(0.5);
  });

  it("evaluateIntervention returns learned probability", () => {
    initCausalModel();
    recordCausalObservation("changeA", "outcomeB", true);
    recordCausalObservation("changeA", "outcomeB", true);
    
    const prob = evaluateIntervention("changeA", "outcomeB");
    expect(prob).toBeGreaterThan(0.5);
    
    const unknownProb = evaluateIntervention("changeX", "outcomeY");
    expect(unknownProb).toBe(0.5);
  });
});

// ── peerReviewNetwork.ts ──────────────────────────────────────────────────────
import { broadcastForPeerReview, hasNetworkConsensus } from "./peerReviewNetwork.js";

describe("peerReviewNetwork", () => {
  it("broadcastForPeerReview returns mock approvals without API key", async () => {
    vi.spyOn(await import("./aiTokens.js"), "getApiKey").mockReturnValue(null);
    const votes = await broadcastForPeerReview({
      id: "prop1",
      authorInstanceId: "local",
      codeDiff: "test",
      rationale: "test"
    });
    
    expect(votes.length).toBe(3);
    expect(votes.every(v => v.vote === "APPROVE")).toBe(true);
  });

  it("hasNetworkConsensus requires >50% approval", () => {
    expect(hasNetworkConsensus([])).toBe(false);
    expect(hasNetworkConsensus([{ proposalId: "1", reviewerId: "A", vote: "APPROVE", confidence: 1 }])).toBe(true);
    expect(hasNetworkConsensus([
      { proposalId: "1", reviewerId: "A", vote: "APPROVE", confidence: 1 },
      { proposalId: "1", reviewerId: "B", vote: "REJECT", confidence: 1 }
    ])).toBe(false); // 50% is not >50%
  });
});

// ── ntdlMemory.ts ─────────────────────────────────────────────────────────────
import { initNtdlMemory, hashState, updateTdLambda, predictStateValue } from "./ntdlMemory.js";

describe("ntdlMemory", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ntdl-test-"));
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
  });

  it("initNtdlMemory creates file", () => {
    initNtdlMemory();
    expect(fs.existsSync(path.join(tmpDir, ".ntdl_values.json"))).toBe(true);
  });

  it("hashState generates consistent hashes", () => {
    const h1 = hashState("const a = 1;");
    const h2 = hashState("const a = 1;");
    const h3 = hashState("const b = 2;");
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
  });

  it("updateTdLambda updates values and predictStateValue returns them", () => {
    initNtdlMemory();
    const s1 = hashState("state1");
    const s2 = hashState("state2");
    
    expect(predictStateValue(s1)).toBe(0);
    
    // Reward of 1
    updateTdLambda(s1, s2, 1);
    
    expect(predictStateValue(s1)).toBeGreaterThan(0);
  });
});

// ── benchmarkSynthesizer.ts ───────────────────────────────────────────────────
import { initBenchmarkSynthesizer, synthesizeBenchmark } from "./benchmarkSynthesizer.js";

describe("benchmarkSynthesizer", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bench-test-"));
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
  });

  it("initBenchmarkSynthesizer creates directory", () => {
    initBenchmarkSynthesizer();
    expect(fs.existsSync(path.join(tmpDir, "synthetic_benchmarks"))).toBe(true);
  });

  it("synthesizeBenchmark returns null without API key", async () => {
    initBenchmarkSynthesizer();
    vi.spyOn(await import("./aiTokens.js"), "getApiKey").mockReturnValue(null);
    const result = await synthesizeBenchmark("logic");
    expect(result).toBeNull();
  });
});

// ── constitutionalAI.ts ───────────────────────────────────────────────────────
import { initConstitutionalAI, getConstitution, evaluateConstitutionality } from "./constitutionalAI.js";

describe("constitutionalAI", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "const-test-"));
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
  });

  it("initConstitutionalAI creates constitution file", () => {
    initConstitutionalAI();
    expect(fs.existsSync(path.join(tmpDir, "CONSTITUTION.md"))).toBe(true);
    expect(getConstitution()).toContain("Never modify security-critical code");
  });

  it("evaluateConstitutionality returns true by default (mocked)", async () => {
    initConstitutionalAI();
    vi.spyOn(await import("./aiTokens.js"), "getApiKey").mockReturnValue(null);
    const result = await evaluateConstitutionality("test.ts", "const a = 1;");
    expect(result).toBe(true);
  });
});
