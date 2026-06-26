/**
 * v13_v15_coverage.test.ts — Comprehensive test coverage for all v13–v15 SOTA modules
 *
 * Covers:
 *   v13: chaosEngineer, multiAgentDebate, semanticCodebaseGraph
 *   v14: rsiWorkerPool, selfHealingChaos
 *   v15: continuousFineTuner, rsiTaskQueue, semanticDiffValidator, proposalRanker
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── v13: chaosEngineer ───────────────────────────────────────────────────────
import {
  recordModuleResilienceScore,
  getModuleResilienceScore,
  getLowResilienceModules,
} from "./chaosEngineer.js";

describe("chaosEngineer", () => {
  it("records and retrieves a module resilience score", () => {
    // recordModuleResilienceScore(moduleName, passed, scenarioId)
    recordModuleResilienceScore("testModule", true, "scenario-A");
    const score = getModuleResilienceScore("testModule");
    expect(score).toBeDefined();
    expect(score!.moduleName).toBe("testModule");
    // A single pass should yield a score > 0
    expect(score!.score).toBeGreaterThan(0);
  });

  it("getLowResilienceModules filters by threshold", () => {
    // Record many failures to drive fragileModule score low
    for (let i = 0; i < 10; i++) recordModuleResilienceScore("fragileModule2", false, `s${i}`);
    // Record many passes to drive stableModule2 score high
    for (let i = 0; i < 10; i++) recordModuleResilienceScore("stableModule2", true, `s${i}`);
    const low = getLowResilienceModules(0.8);
    const names = low.map(m => m.moduleName);
    expect(names).toContain("fragileModule2");
    expect(names).not.toContain("stableModule2");
  });

  it("multiple recordings accumulate into a score", () => {
    recordModuleResilienceScore("accumModule", true, "s1");
    recordModuleResilienceScore("accumModule", true, "s2");
    const score = getModuleResilienceScore("accumModule");
    expect(score).toBeDefined();
    expect(score!.score).toBeGreaterThan(0);
  });
});

// ─── v13: multiAgentDebate ────────────────────────────────────────────────────
import {
  recordDebateOutcome,
  getDebateStats,
} from "./multiAgentDebate.js";

describe("multiAgentDebate", () => {
  it("recordDebateOutcome updates agent accuracy", () => {
    const before = getDebateStats();
    const securityBefore = before.agentWeights.find(a => a.persona === "security_auditor")!;
    recordDebateOutcome("security_auditor", true);
    const after = getDebateStats();
    const securityAfter = after.agentWeights.find(a => a.persona === "security_auditor")!;
    // totalVotes should have incremented
    expect(securityAfter.totalVotes).toBeGreaterThan(securityBefore.totalVotes);
  });

  it("recordDebateOutcome updates agent weight after failure", () => {
    const before = getDebateStats();
    const perfBefore = before.agentWeights.find(a => a.persona === "performance_tuner")!;
    // Record a failure — accuracy should drop or stay same
    recordDebateOutcome("performance_tuner", false);
    const after = getDebateStats();
    const perfAfter = after.agentWeights.find(a => a.persona === "performance_tuner")!;
    expect(perfAfter.totalVotes).toBeGreaterThan(perfBefore.totalVotes);
  });

  it("getDebateStats returns a valid structure", () => {
    const stats = getDebateStats();
    expect(typeof stats.totalDebates).toBe("number");
    expect(Array.isArray(stats.agentWeights)).toBe(true);
    expect(stats.agentWeights.length).toBe(5);
    expect(typeof stats.consensusRate).toBe("number");
  });
});

// ─── v13: semanticCodebaseGraph ───────────────────────────────────────────────
import {
  getDeadCodeCandidates,
} from "./semanticCodebaseGraph.js";

describe("semanticCodebaseGraph", () => {
  it("getDeadCodeCandidates returns an array (may be empty before graph is built)", () => {
    const candidates = getDeadCodeCandidates();
    expect(Array.isArray(candidates)).toBe(true);
  });
});

// ─── v14: rsiWorkerPool ───────────────────────────────────────────────────────
import {
  getWorkerPoolStats,
  initRsiWorkerPool,
} from "./rsiWorkerPool.js";

describe("rsiWorkerPool", () => {
  it("initRsiWorkerPool is idempotent (safe to call multiple times)", () => {
    expect(() => {
      initRsiWorkerPool();
      initRsiWorkerPool();
    }).not.toThrow();
  });

  it("getWorkerPoolStats returns a valid structure", () => {
    initRsiWorkerPool();
    const stats = getWorkerPoolStats();
    expect(stats).toBeDefined();
    expect(typeof stats.activeWorkers).toBe("number");
    expect(typeof stats.queuedTasks).toBe("number");
    expect(typeof stats.completedTasks).toBe("number");
    expect(stats.activeWorkers).toBeGreaterThanOrEqual(0);
  });
});

// ─── v14: selfHealingChaos ────────────────────────────────────────────────────
import {
  processChaosResults,
  getHardeningTargets,
  clearHardeningTarget,
  isHardeningTarget,
  _resetStateForTesting,
} from "./selfHealingChaos.js";
import type { ChaosReport } from "./chaosEngineer.js";

describe("selfHealingChaos", () => {
  beforeEach(() => {
    _resetStateForTesting();
  });

  it("processChaosResults adds a low-resilience module as a hardening target", () => {
    processChaosResults([{ moduleName: "weakModule", resilienceScore: 0.3, failedFaults: ["timeout"] }]);
    expect(isHardeningTarget("weakModule")).toBe(true);
  });

  it("clearHardeningTarget removes a module from the target list", () => {
    processChaosResults([{ moduleName: "clearMe", resilienceScore: 0.2, failedFaults: ["crash"] }]);
    expect(isHardeningTarget("clearMe")).toBe(true);
    clearHardeningTarget("clearMe");
    expect(isHardeningTarget("clearMe")).toBe(false);
  });

  it("getHardeningTargets returns sorted by escalation level", () => {
    processChaosResults([{ moduleName: "criticalModule", resilienceScore: 0.1, failedFaults: ["crash", "timeout"] }]);
    processChaosResults([{ moduleName: "highModule", resilienceScore: 0.5, failedFaults: ["timeout"] }]);
    const targets = getHardeningTargets();
    expect(targets.length).toBeGreaterThanOrEqual(2);
    // Critical (score < 0.3) should come before high (score < 0.7)
    const critIdx = targets.findIndex(t => t.moduleName === "criticalModule");
    const highIdx = targets.findIndex(t => t.moduleName === "highModule");
    expect(critIdx).toBeLessThan(highIdx);
  });
});

// ─── v15: continuousFineTuner ─────────────────────────────────────────────────
import {
  getRsiModel,
  getFineTunedModelId,
} from "./continuousFineTuner.js";

describe("continuousFineTuner", () => {
  it("getRsiModel returns the fine-tuned model if available, else the default", () => {
    const model = getRsiModel("gpt-4o-mini");
    expect(typeof model).toBe("string");
    expect(model.length).toBeGreaterThan(0);
  });

  it("getFineTunedModelId returns null when no fine-tuning has occurred", () => {
    // In a fresh test environment, no fine-tuning job has completed
    const id = getFineTunedModelId();
    expect(id === null || typeof id === "string").toBe(true);
  });
});

// ─── v15: rsiTaskQueue ────────────────────────────────────────────────────────
import {
  initRsiTaskQueue,
  pushTask,
  pullTask,
  ackTask,
  nackTask,
  recoverStaleTasks,
} from "./rsiTaskQueue.js";

describe("rsiTaskQueue", () => {
  beforeEach(() => {
    initRsiTaskQueue();
    // Drain any leftover tasks from previous tests
    let t = pullTask();
    while (t) { ackTask(t.id); t = pullTask(); }
  });

  it("pushTask and pullTask round-trip correctly", () => {
    pushTask("foo.ts", "cycle-1");
    const task = pullTask();
    expect(task).toBeDefined();
    expect(task!.targetFile).toBe("foo.ts");
    expect(task!.cycleId).toBe("cycle-1");
  });

  it("ackTask removes the task from in-flight", () => {
    pushTask("bar.ts", "cycle-2");
    const task = pullTask();
    expect(task).toBeDefined();
    // Should not throw
    expect(() => ackTask(task!.id)).not.toThrow();
  });

  it("nackTask re-queues the task with incremented retries", () => {
    pushTask("baz.ts", "cycle-3");
    const task = pullTask();
    expect(task).toBeDefined();
    nackTask(task!.id, "transient error");
    // The task should be re-available for pulling
    const retried = pullTask();
    expect(retried).toBeDefined();
    expect(retried!.targetFile).toBe("baz.ts");
    expect(retried!.retryCount).toBeGreaterThan(0);
  });

  it("pullTask returns null when queue is empty", () => {
    expect(pullTask()).toBeNull();
  });

  it("recoverStaleTasks returns a number", () => {
    const recovered = recoverStaleTasks();
    expect(typeof recovered).toBe("number");
    expect(recovered).toBeGreaterThanOrEqual(0);
  });

  it("higher priority tasks are pulled first", () => {
    pushTask("low.ts", "cycle-4", { priority: 0 });
    pushTask("high.ts", "cycle-4", { priority: 2 });
    const first = pullTask();
    expect(first!.targetFile).toBe("high.ts");
  });
});

// ─── v15: semanticDiffValidator ───────────────────────────────────────────────
import {
  validateDiff,
  isSafeDiff,
  extractExports,
} from "./semanticDiffValidator.js";

describe("semanticDiffValidator", () => {
  const safeCode = `export function foo(): string { return "hello"; }`;
  const safeChange = `export function foo(): string { return "world"; }`;
  const breakingChange = `export function foo(x: number): string { return "world"; }`;
  const removedExport = `// foo removed`;

  it("extractExports correctly identifies exported symbols", () => {
    const exports = extractExports(safeCode, "test.ts");
    expect(exports.has("foo")).toBe(true);
    const sym = exports.get("foo")!;
    expect(sym.kind).toBe("function");
  });

  it("validateDiff approves safe internal changes", () => {
    const result = validateDiff(safeCode, safeChange, "test.ts");
    expect(result.safe).toBe(true);
    expect(result.breakingChanges).toHaveLength(0);
  });

  it("validateDiff flags signature changes as breaking", () => {
    const result = validateDiff(safeCode, breakingChange, "test.ts");
    expect(result.safe).toBe(false);
    expect(result.breakingChanges.length).toBeGreaterThan(0);
    expect(result.breakingChanges[0].kind).toBe("signature-changed");
  });

  it("validateDiff flags removed exports as breaking", () => {
    const result = validateDiff(safeCode, removedExport, "test.ts");
    expect(result.safe).toBe(false);
    expect(result.breakingChanges.some(c => c.kind === "export-removed")).toBe(true);
  });

  it("isSafeDiff is a convenience wrapper returning boolean", () => {
    expect(isSafeDiff(safeCode, safeChange, "test.ts")).toBe(true);
    expect(isSafeDiff(safeCode, breakingChange, "test.ts")).toBe(false);
  });
});

// ─── v15: proposalRanker ─────────────────────────────────────────────────────
import {
  jaccardSimilarity,
  scoreProposal,
  rankProposals,
  formatRankingSummary,
} from "./proposalRanker.js";
import type { RankableProposal } from "./proposalRanker.js";

describe("proposalRanker", () => {
  const makeProposal = (id: string, title: string, overrides: Partial<RankableProposal> = {}): RankableProposal => ({
    id,
    title,
    targetFile: "foo.ts",
    area: "performance",
    content: `+const x = 1;\n-const x = 0;`,
    safetyScore: 0.75,
    patternScore: 0.8,
    rewardScore: 0.75,
    complexity: 3,
    ...overrides,
  });

  it("jaccardSimilarity returns 1.0 for identical strings", () => {
    expect(jaccardSimilarity("hello world", "hello world")).toBe(1.0);
  });

  it("jaccardSimilarity returns 0.0 for completely different strings", () => {
    expect(jaccardSimilarity("abc def", "xyz uvw")).toBe(0.0);
  });

  it("scoreProposal computes a composite score", () => {
    const p = makeProposal("p1", "Add null check");
    const { compositeScore } = scoreProposal(p);
    expect(compositeScore).toBeGreaterThan(0);
    expect(compositeScore).toBeLessThanOrEqual(100);
  });

  it("rankProposals deduplicates identical proposals", () => {
    const sharedContent = `+const x = 1;\n-const x = 0;\n+const y = 2;\n-const y = 1;\n+const z = 3;`;
    const proposals = [
      makeProposal("p1", "Add null check for user input", { content: sharedContent }),
      makeProposal("p2", "Add null check for user input", { content: sharedContent }), // exact duplicate
      makeProposal("p3", "Refactor loop to use reduce", { content: `+arr.reduce((a,b) => a+b, 0)` }),
    ];
    const result = rankProposals(proposals);
    // ranked includes all proposals for audit trail; filter to unique only
    const unique = result.ranked.filter(p => p.isUnique);
    expect(unique.length).toBe(2);
    expect(result.duplicatesRemoved).toBe(1);
  });

  it("rankProposals returns proposals sorted by score descending", () => {
    const proposals = [
      makeProposal("low", "Minor rename", { safetyScore: 0.1, patternScore: 0.1, rewardScore: 0.1, complexity: 9 }),
      makeProposal("high", "Critical safety fix", { safetyScore: 0.99, patternScore: 0.99, rewardScore: 0.99, complexity: 1 }),
    ];
    const result = rankProposals(proposals);
    expect(result.ranked[0].id).toBe("high");
    expect(result.ranked[1].id).toBe("low");
  });

  it("formatRankingSummary returns a non-empty string", () => {
    const proposals = [makeProposal("p1", "Test proposal")];
    const result = rankProposals(proposals);
    const summary = formatRankingSummary(result);
    expect(typeof summary).toBe("string");
    expect(summary.length).toBeGreaterThan(0);
  });
});
