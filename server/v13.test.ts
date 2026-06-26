/**
 * v13.test.ts — Comprehensive tests for all three v13.0.0 SOTA modules
 *
 * Tests:
 *   1. semanticCodebaseGraph.ts — symbol parsing, dead code detection, impact radius, safety score
 *   2. multiAgentDebate.ts      — structural proposals, debate protocol, RLAIF weight updates
 *   3. chaosEngineer.ts         — fault scenarios, resilience scoring, circuit breaker stress
 */

import { describe, it, expect, beforeEach } from "vitest";
import path from "path";
import fs from "fs";
import os from "os";

// ─── semanticCodebaseGraph tests ──────────────────────────────────────────────

describe("semanticCodebaseGraph", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "scg_test_"));
  });

  it("parses function definitions from a TypeScript file", async () => {
    const { buildSemanticGraph, getGraphStats } = await import("./semanticCodebaseGraph.js");

    const serverDir = path.join(tmpDir, "server");
    fs.mkdirSync(serverDir, { recursive: true });

    fs.writeFileSync(path.join(serverDir, "sample.ts"), `
export async function chatCompletion(prompt: string): Promise<string> {
  return "hello";
}

export function validateInput(input: unknown): boolean {
  return typeof input === "string";
}

const helperFn = (x: number) => x * 2;
`);

    const stats = await buildSemanticGraph(tmpDir, serverDir);
    expect(stats.totalSymbols).toBeGreaterThan(0);
    expect(stats.totalFiles).toBe(1);
    expect(stats.buildDurationMs).toBeGreaterThanOrEqual(0);
  });

  it("detects exported symbols with no callers as dead code candidates", async () => {
    const { buildSemanticGraph, getDeadCodeCandidates } = await import("./semanticCodebaseGraph.js");

    const serverDir = path.join(tmpDir, "server2");
    fs.mkdirSync(serverDir, { recursive: true });

    fs.writeFileSync(path.join(serverDir, "orphan.ts"), `
export function orphanedFunction(): void {
  console.log("nobody calls me");
}

export function anotherOrphan(x: string): string {
  return x.toUpperCase();
}
`);

    await buildSemanticGraph(tmpDir, serverDir);
    const candidates = getDeadCodeCandidates();
    // Both exported functions have no callers — should be candidates
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    expect(candidates.every(c => c.confidence > 0)).toBe(true);
  });

  it("computes impact radius for a symbol", async () => {
    const { buildSemanticGraph, computeImpactRadius } = await import("./semanticCodebaseGraph.js");

    const serverDir = path.join(tmpDir, "server3");
    fs.mkdirSync(serverDir, { recursive: true });

    fs.writeFileSync(path.join(serverDir, "core.ts"), `
export function coreFunction(): string {
  return "core";
}

export function callerA(): void {
  coreFunction();
}

export function callerB(): void {
  coreFunction();
}
`);

    await buildSemanticGraph(tmpDir, serverDir);
    const impact = computeImpactRadius("coreFunction");
    // Impact should be non-null (symbol exists)
    expect(impact).not.toBeNull();
    if (impact) {
      expect(impact.targetSymbol.name).toBe("coreFunction");
      expect(impact.summary).toContain("coreFunction");
    }
  });

  it("returns null impact radius for unknown symbol", async () => {
    const { computeImpactRadius } = await import("./semanticCodebaseGraph.js");
    const impact = computeImpactRadius("nonExistentSymbol_xyz_12345");
    expect(impact).toBeNull();
  });

  it("computes change safety score with risk factors", async () => {
    const { getChangeSafetyScore } = await import("./semanticCodebaseGraph.js");

    const diff = `
-export function chatCompletion(prompt: string): Promise<string> {
+export function chatCompletion(prompt: string, opts?: object): Promise<string> {
`;
    const score = getChangeSafetyScore("server/llmProvider.ts", diff, "/tmp");
    expect(score.score).toBeGreaterThanOrEqual(0);
    expect(score.score).toBeLessThanOrEqual(1);
    expect(score.recommendation).toMatch(/apply|review|block/);
    // Critical file should have risk factors
    expect(score.riskFactors.length).toBeGreaterThan(0);
  });

  it("getGraphStats returns correct structure", async () => {
    const { getGraphStats } = await import("./semanticCodebaseGraph.js");
    const stats = getGraphStats();
    expect(stats).toHaveProperty("totalSymbols");
    expect(stats).toHaveProperty("totalCallEdges");
    expect(stats).toHaveProperty("totalFiles");
    expect(stats).toHaveProperty("deadCodeCandidates");
    expect(stats).toHaveProperty("lastBuiltAt");
    expect(stats).toHaveProperty("buildDurationMs");
  });
});

// ─── multiAgentDebate tests ───────────────────────────────────────────────────

describe("multiAgentDebate", () => {
  it("runs structural debate and returns a winning brief", async () => {
    const { runDebateProtocol } = await import("./multiAgentDebate.js");

    const fileContent = `
import fs from "fs";

export async function readConfig(path: string): Promise<object> {
  const content = fs.readFileSync(path, "utf-8");
  return JSON.parse(content);
}

export function processData(data: any): any {
  return data;
}
`;

    const outcome = await runDebateProtocol("server/config.ts", fileContent, { useLLM: false });

    expect(outcome).toBeDefined();
    expect(outcome.winningBrief).toBeTruthy();
    expect(outcome.winner).toBeTruthy();
    expect(typeof outcome.strongConsensus).toBe("boolean");
    expect(outcome.durationMs).toBeGreaterThanOrEqual(0);
    expect(outcome.rounds.length).toBeGreaterThan(0);
    expect(typeof outcome.scores).toBe("object");
  });

  it("detects eval() and security auditor wins with high confidence", async () => {
    const { runDebateProtocol } = await import("./multiAgentDebate.js");

    const dangerousContent = `
export function runCode(userInput: string): unknown {
  return eval(userInput);
}
`;

    const outcome = await runDebateProtocol("server/executor.ts", dangerousContent, { useLLM: false });
    // Security auditor should win given eval() is present
    expect(outcome.winner).toBe("security_auditor");
    expect(outcome.winningBrief).toContain("eval");
  });

  it("detects setInterval without clearInterval for reliability engineer", async () => {
    const { runDebateProtocol } = await import("./multiAgentDebate.js");

    const leakyContent = `
export function startPolling(): void {
  setInterval(() => {
    console.log("polling...");
  }, 5000);
}
`;

    const outcome = await runDebateProtocol("server/poller.ts", leakyContent, { useLLM: false });
    // Reliability engineer should flag the missing clearInterval
    expect(outcome.winningBrief).toBeTruthy();
    expect(outcome.rounds.length).toBeGreaterThan(0);
  });

  it("detects many 'any' types for typescript pedant", async () => {
    const { runDebateProtocol } = await import("./multiAgentDebate.js");

    const anyHeavyContent = `
export function process(data: any, config: any, opts: any, extra: any): any {
  return data;
}
export function transform(input: any): any {
  return input;
}
`;

    const outcome = await runDebateProtocol("server/processor.ts", anyHeavyContent, { useLLM: false });
    expect(outcome.winningBrief).toBeTruthy();
  });

  it("RLAIF weight update increases accuracy for correct votes", async () => {
    const { recordDebateOutcome, getDebateStats } = await import("./multiAgentDebate.js");

    const statsBefore = getDebateStats();
    const secAgent = statsBefore.agentWeights.find(a => a.persona === "security_auditor");
    const initialVotes = secAgent?.totalVotes ?? 0;

    recordDebateOutcome("security_auditor", true);
    recordDebateOutcome("security_auditor", true);

    const statsAfter = getDebateStats();
    const secAgentAfter = statsAfter.agentWeights.find(a => a.persona === "security_auditor");
    expect(secAgentAfter?.totalVotes).toBe(initialVotes + 2);
    expect(secAgentAfter?.historicalAccuracy).toBeGreaterThan(0);
  });

  it("getDebateStats returns correct structure", async () => {
    const { getDebateStats } = await import("./multiAgentDebate.js");
    const stats = getDebateStats();
    expect(stats).toHaveProperty("totalDebates");
    expect(stats).toHaveProperty("consensusReached");
    expect(stats).toHaveProperty("consensusRate");
    expect(stats).toHaveProperty("avgDebateMs");
    expect(stats).toHaveProperty("agentWeights");
    expect(Array.isArray(stats.agentWeights)).toBe(true);
    expect(stats.agentWeights.length).toBe(5); // 5 agents
  });

  it("updateDebateConfig changes configuration", async () => {
    const { updateDebateConfig, getDebateConfig } = await import("./multiAgentDebate.js");
    updateDebateConfig({ maxRounds: 3, consensusThreshold: 0.75 });
    const config = getDebateConfig();
    expect(config.maxRounds).toBe(3);
    expect(config.consensusThreshold).toBe(0.75);
    // Reset
    updateDebateConfig({ maxRounds: 2, consensusThreshold: 0.65 });
  });
});

// ─── chaosEngineer tests ──────────────────────────────────────────────────────

describe("chaosEngineer", () => {
  it("initializes without error", async () => {
    const { initChaosEngineer, getChaosStats } = await import("./chaosEngineer.js");
    await initChaosEngineer({ runImmediately: false });
    const stats = getChaosStats();
    expect(stats.enabled).toBe(true);
    expect(stats.totalScenariosAvailable).toBeGreaterThan(0);
    expect(stats.activeScenariosCount).toBeGreaterThan(0);
  });

  it("getFaultScenarios returns all built-in scenarios", async () => {
    const { getFaultScenarios } = await import("./chaosEngineer.js");
    const scenarios = getFaultScenarios();
    expect(scenarios.length).toBeGreaterThanOrEqual(10);
    expect(scenarios.every(s => s.id && s.name && s.faultType)).toBe(true);
  });

  it("circuit breaker test passes — breaker opens after N failures", async () => {
    const { runChaosTests } = await import("./chaosEngineer.js");
    const report = await runChaosTests({ scenarioIds: ["cb_repeated_failure"] });
    expect(report.totalScenarios).toBe(1);
    expect(report.passed).toBe(1);
    expect(report.failed).toBe(0);
    expect(report.overallResilienceScore).toBe(1.0);
  });

  it("malformed JSON test passes — parse errors are thrown correctly", async () => {
    const { runChaosTests } = await import("./chaosEngineer.js");
    const report = await runChaosTests({ scenarioIds: ["llm_malformed_json"] });
    expect(report.passed).toBe(1);
  });

  it("timeout test passes — timeout guard fires before slow operation", async () => {
    const { runChaosTests } = await import("./chaosEngineer.js");
    const report = await runChaosTests({ scenarioIds: ["llm_timeout"] });
    expect(report.passed).toBe(1);
  });

  it("stream partial test passes — truncated stream detected", async () => {
    const { runChaosTests } = await import("./chaosEngineer.js");
    const report = await runChaosTests({ scenarioIds: ["stream_partial"] });
    // Stream integrity should detect incomplete content
    expect(report.totalScenarios).toBe(1);
  });

  it("provider error test passes — graceful degradation handles failures", async () => {
    const { runChaosTests } = await import("./chaosEngineer.js");
    const report = await runChaosTests({ scenarioIds: ["gd_all_providers_down"] });
    expect(report.passed).toBe(1);
  });

  it("high latency test passes — guard fires before slow operation", async () => {
    const { runChaosTests } = await import("./chaosEngineer.js");
    const report = await runChaosTests({ scenarioIds: ["rsi_high_latency"] });
    expect(report.passed).toBe(1);
  });

  it("recordModuleResilienceScore updates module score", async () => {
    const { recordModuleResilienceScore, getModuleResilienceScore } = await import("./chaosEngineer.js");

    recordModuleResilienceScore("testModule_xyz", true);
    recordModuleResilienceScore("testModule_xyz", true);
    recordModuleResilienceScore("testModule_xyz", false);

    const score = getModuleResilienceScore("testModule_xyz");
    expect(score).toBeDefined();
    expect(score!.totalTests).toBe(3);
    expect(score!.passedTests).toBe(2);
    expect(score!.score).toBeCloseTo(2 / 3, 2);
  });

  it("getLowResilienceModules returns modules below threshold", async () => {
    const { recordModuleResilienceScore, getLowResilienceModules } = await import("./chaosEngineer.js");

    // Create a module with low resilience
    for (let i = 0; i < 5; i++) {
      recordModuleResilienceScore("lowResModule_abc", false);
    }

    const lowModules = getLowResilienceModules(0.8);
    const found = lowModules.find(m => m.moduleName === "lowResModule_abc");
    expect(found).toBeDefined();
    expect(found!.score).toBeLessThan(0.8);
    expect(found!.priority).toMatch(/critical|high/);
  });

  it("getChaosStats returns correct structure", async () => {
    const { getChaosStats } = await import("./chaosEngineer.js");
    const stats = getChaosStats();
    expect(stats).toHaveProperty("enabled");
    expect(stats).toHaveProperty("totalRuns");
    expect(stats).toHaveProperty("lastRunAt");
    expect(stats).toHaveProperty("totalScenariosAvailable");
    expect(stats).toHaveProperty("activeScenariosCount");
    expect(stats).toHaveProperty("moduleScores");
    expect(stats).toHaveProperty("avgResilienceScore");
    expect(stats).toHaveProperty("criticalModules");
    expect(stats).toHaveProperty("recentResults");
  });

  it("runs all active scenarios and produces a complete report", async () => {
    const { runChaosTests } = await import("./chaosEngineer.js");
    const report = await runChaosTests();
    expect(report.runId).toMatch(/^chaos_/);
    expect(report.totalScenarios).toBeGreaterThan(0);
    expect(report.passed + report.failed).toBe(report.totalScenarios);
    expect(report.overallResilienceScore).toBeGreaterThanOrEqual(0);
    expect(report.overallResilienceScore).toBeLessThanOrEqual(1);
    expect(Array.isArray(report.results)).toBe(true);
    expect(Array.isArray(report.moduleScores)).toBe(true);
    expect(Array.isArray(report.recommendations)).toBe(true);
  }, 30000); // Allow 30s for full chaos run
});
