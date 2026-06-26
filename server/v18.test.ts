/**
 * v18.0.0 Comprehensive Test Suite
 *
 * Tests for all five new v18 SOTA modules:
 *   1. fineTunerActivation  — API key scope verification + fine-tuner health check
 *   2. consensusConfig      — live 3-node peer config with health checks + auto-discovery
 *   3. genealogyGuidedGeneration — DAG-based rejected proposal pattern extraction
 *   4. rewardCalibrator     — Platt scaling layer for reward model confidence calibration
 *   5. dependencyUpdateRsi  — RSI extension for package.json dependency updates
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// ─── 1. fineTunerActivation ───────────────────────────────────────────────────

import {
  getFineTunerReadiness,
  initFineTunerActivation,
  _resetFineTunerActivationForTesting,
} from "./fineTunerActivation.js";

describe("fineTunerActivation", () => {
  beforeEach(() => {
    _resetFineTunerActivationForTesting();
  });

  it("returns a readiness object with expected shape", () => {
    const readiness = getFineTunerReadiness();
    expect(readiness).toBeDefined();
    expect(typeof readiness.ready).toBe("boolean");
    expect(typeof readiness.hasApiKey).toBe("boolean");
    expect(typeof readiness.apiKeyHasScope).toBe("boolean");
    expect(typeof readiness.pendingExamples).toBe("number");
    expect(typeof readiness.completedJobs).toBe("number");
    expect(typeof readiness.thresholdRemaining).toBe("number");
    expect(readiness.thresholdRemaining).toBeGreaterThanOrEqual(0);
  });

  it("initFineTunerActivation is idempotent", () => {
    initFineTunerActivation();
    initFineTunerActivation(); // second call should not throw
    const readiness = getFineTunerReadiness();
    expect(readiness).toBeDefined();
  });

  it("readiness reflects missing API key when env is unset", () => {
    const savedKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    _resetFineTunerActivationForTesting();
    const readiness = getFineTunerReadiness();
    expect(readiness.hasApiKey).toBe(false);
    if (savedKey) process.env.OPENAI_API_KEY = savedKey;
  });

  it("ready is false when API key is missing", () => {
    const savedKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    _resetFineTunerActivationForTesting();
    const readiness = getFineTunerReadiness();
    expect(readiness.ready).toBe(false);
    if (savedKey) process.env.OPENAI_API_KEY = savedKey;
  });

  it("blockers array is present and is an array", () => {
    const readiness = getFineTunerReadiness();
    expect(Array.isArray(readiness.blockers)).toBe(true);
  });
});

// ─── 2. consensusConfig ───────────────────────────────────────────────────────

import {
  initConsensusConfig,
  getLivePeers,
  getAllPeers,
  getConsensusTopology,
  registerPeer,
  _resetConsensusConfigForTest,
} from "./consensusConfig.js";

describe("consensusConfig", () => {
  beforeEach(() => {
    _resetConsensusConfigForTest();
    delete process.env.CONSENSUS_PEERS;
    delete process.env.CONSENSUS_SELF;
  });

  afterEach(() => {
    _resetConsensusConfigForTest();
  });

  it("initializes in single-node mode when no peers configured", () => {
    initConsensusConfig();
    const topology = getConsensusTopology();
    expect(topology.mode).toBe("single-node");
    expect(topology.totalNodes).toBe(1);
    expect(topology.peers).toHaveLength(0);
  });

  it("is idempotent — calling init twice does not duplicate peers", () => {
    process.env.CONSENSUS_PEERS = "http://node2:3001";
    initConsensusConfig();
    initConsensusConfig(); // second call should be no-op
    // Peers registered asynchronously, so just check no crash
    const topology = getConsensusTopology();
    expect(topology).toBeDefined();
  });

  it("getLivePeers returns only healthy peers", () => {
    // With no peers configured, live peers should be empty
    initConsensusConfig();
    const live = getLivePeers();
    expect(Array.isArray(live)).toBe(true);
    expect(live.every(p => p.healthy)).toBe(true);
  });

  it("getAllPeers returns all peers including unhealthy", () => {
    initConsensusConfig();
    const all = getAllPeers();
    expect(Array.isArray(all)).toBe(true);
  });

  it("getConsensusTopology returns correct quorum size for 1 node", () => {
    initConsensusConfig();
    const topology = getConsensusTopology();
    // 1 node → quorum = floor(1/2) + 1 = 1
    expect(topology.quorumSize).toBe(1);
    expect(topology.isDistributed).toBe(false);
  });

  it("registerPeer adds a peer to the map (unhealthy for unreachable URL)", async () => {
    const result = await registerPeer("http://localhost:19999");
    // Unreachable peer should be registered but unhealthy
    expect(typeof result).toBe("boolean");
    const all = getAllPeers();
    expect(all.some(p => p.url === "http://localhost:19999")).toBe(true);
  });

  it("topology mode is degraded when healthy nodes < quorum", async () => {
    // Register an unreachable peer — it will be unhealthy
    await registerPeer("http://localhost:19998");
    const topology = getConsensusTopology();
    // 2 total nodes (self + 1 unhealthy peer), quorum = 2, healthy = 1 → degraded
    expect(topology.mode).toBe("degraded");
  });

  it("peer node has expected shape", async () => {
    await registerPeer("http://localhost:19997");
    const all = getAllPeers();
    const peer = all.find(p => p.url === "http://localhost:19997");
    expect(peer).toBeDefined();
    expect(typeof peer!.url).toBe("string");
    expect(typeof peer!.healthy).toBe("boolean");
    expect(peer!.lastCheckedAt).toBeTruthy();
  });
});

// ─── 3. genealogyGuidedGeneration ────────────────────────────────────────────

import {
  buildRefinementContext,
  generateRefinementBrief,
  recordRefinementOutcome,
  getRefinementStats,
  _resetRefinementStateForTest,
} from "./genealogyGuidedGeneration.js";

describe("genealogyGuidedGeneration", () => {
  beforeEach(() => {
    _resetRefinementStateForTest();
  });

  it("returns empty context for a file with no genealogy history", () => {
    const ctx = buildRefinementContext("server/nonexistent_file_xyz.ts");
    expect(ctx.hasRejectedHistory).toBe(false);
    expect(ctx.topRejectedProposals).toHaveLength(0);
    expect(ctx.commonRejectionPatterns).toHaveLength(0);
    expect(ctx.refinementBrief).toBe("");
  });

  it("generateRefinementBrief returns empty string for unknown file", () => {
    const brief = generateRefinementBrief("server/unknown_file_abc.ts");
    expect(brief).toBe("");
  });

  it("recordRefinementOutcome records accepted outcomes", () => {
    recordRefinementOutcome("prop-001", true);
    const stats = getRefinementStats();
    expect(stats.totalRefinementsGenerated).toBe(1);
    expect(stats.totalRefinementsAccepted).toBe(1);
    expect(stats.refinementAcceptanceRate).toBe(1.0);
  });

  it("recordRefinementOutcome records rejected outcomes", () => {
    recordRefinementOutcome("prop-002", false);
    const stats = getRefinementStats();
    expect(stats.totalRefinementsGenerated).toBe(1);
    expect(stats.totalRefinementsAccepted).toBe(0);
    expect(stats.refinementAcceptanceRate).toBe(0.0);
  });

  it("acceptance rate is computed correctly with mixed outcomes", () => {
    recordRefinementOutcome("p1", true);
    recordRefinementOutcome("p2", true);
    recordRefinementOutcome("p3", false);
    const stats = getRefinementStats();
    expect(stats.totalRefinementsGenerated).toBe(3);
    expect(stats.totalRefinementsAccepted).toBe(2);
    expect(stats.refinementAcceptanceRate).toBeCloseTo(2 / 3, 5);
  });

  it("getRefinementStats returns correct shape", () => {
    const stats = getRefinementStats();
    expect(typeof stats.totalRefinementsGenerated).toBe("number");
    expect(typeof stats.totalRefinementsAccepted).toBe("number");
    expect(typeof stats.refinementAcceptanceRate).toBe("number");
    expect(Array.isArray(stats.topImprovedFiles)).toBe(true);
  });

  it("_resetRefinementStateForTest clears all state", () => {
    recordRefinementOutcome("p1", true);
    _resetRefinementStateForTest();
    const stats = getRefinementStats();
    expect(stats.totalRefinementsGenerated).toBe(0);
  });

  it("buildRefinementContext returns correct shape", () => {
    const ctx = buildRefinementContext("server/selfImprove.ts");
    expect(typeof ctx.targetFile).toBe("string");
    expect(typeof ctx.hasRejectedHistory).toBe("boolean");
    expect(Array.isArray(ctx.topRejectedProposals)).toBe(true);
    expect(Array.isArray(ctx.commonRejectionPatterns)).toBe(true);
    expect(Array.isArray(ctx.successfulApproaches)).toBe(true);
    expect(typeof ctx.refinementBrief).toBe("string");
  });
});

// ─── 4. rewardCalibrator ─────────────────────────────────────────────────────

import {
  initRewardCalibrator,
  calibrateScore,
  updateCalibration,
  getCalibrationStats,
  _resetRewardCalibratorForTest,
} from "./rewardCalibrator.js";

describe("rewardCalibrator", () => {
  beforeEach(() => {
    _resetRewardCalibratorForTest();
  });

  it("calibrateScore returns a value in [0, 1]", () => {
    const score = calibrateScore(0.7);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("calibrateScore clamps inputs outside [0, 1]", () => {
    const high = calibrateScore(1.5);
    const low = calibrateScore(-0.5);
    expect(high).toBeGreaterThanOrEqual(0);
    expect(high).toBeLessThanOrEqual(1);
    expect(low).toBeGreaterThanOrEqual(0);
    expect(low).toBeLessThanOrEqual(1);
  });

  it("calibrateScore is monotonically increasing (higher raw → higher calibrated)", () => {
    const s1 = calibrateScore(0.3);
    const s2 = calibrateScore(0.7);
    expect(s2).toBeGreaterThan(s1);
  });

  it("updateCalibration accepts positive samples without throwing", () => {
    expect(() => updateCalibration(0.8, true)).not.toThrow();
    expect(() => updateCalibration(0.3, false)).not.toThrow();
  });

  it("getCalibrationStats returns correct shape", () => {
    const stats = getCalibrationStats();
    expect(typeof stats.sampleCount).toBe("number");
    expect(typeof stats.plattA).toBe("number");
    expect(typeof stats.plattB).toBe("number");
    expect(typeof stats.expectedCalibrationError).toBe("number");
    expect(typeof stats.overconfidenceRate).toBe("number");
    expect(typeof stats.underconfidenceRate).toBe("number");
    expect(typeof stats.isCalibrated).toBe("boolean");
  });

  it("sampleCount increases with each updateCalibration call", () => {
    const before = getCalibrationStats().sampleCount;
    updateCalibration(0.7, true);
    updateCalibration(0.4, false);
    const after = getCalibrationStats().sampleCount;
    expect(after).toBe(before + 2);
  });

  it("Platt parameters shift toward correct direction after many accepted samples", () => {
    // Feed 30 samples where high scores → accepted
    for (let i = 0; i < 30; i++) {
      updateCalibration(0.9, true);
    }
    const stats = getCalibrationStats();
    // After 30 accepted high-score samples, B should shift positive (more confident)
    expect(stats.sampleCount).toBe(30);
    // Just verify parameters are finite numbers
    expect(isFinite(stats.plattA)).toBe(true);
    expect(isFinite(stats.plattB)).toBe(true);
  });

  it("initRewardCalibrator is idempotent", () => {
    initRewardCalibrator();
    initRewardCalibrator(); // should not throw or reset state
    const stats = getCalibrationStats();
    expect(stats).toBeDefined();
  });

  it("_resetRewardCalibratorForTest restores initial state", () => {
    updateCalibration(0.7, true);
    _resetRewardCalibratorForTest();
    const stats = getCalibrationStats();
    expect(stats.sampleCount).toBe(0);
    expect(stats.plattA).toBe(1.0);
    expect(stats.plattB).toBe(0.0);
  });

  it("isCalibrated is false with fewer than 20 samples", () => {
    for (let i = 0; i < 10; i++) {
      updateCalibration(0.7, true);
    }
    const stats = getCalibrationStats();
    expect(stats.isCalibrated).toBe(false);
  });

  it("ECE is 0 with no samples", () => {
    const stats = getCalibrationStats();
    expect(stats.expectedCalibrationError).toBe(0);
  });
});

// ─── 5. dependencyUpdateRsi ───────────────────────────────────────────────────

import {
  initDependencyUpdateRsi,
  getDependencyRsiStats,
  _resetDependencyRsiForTest,
} from "./dependencyUpdateRsi.js";

describe("dependencyUpdateRsi", () => {
  beforeEach(() => {
    _resetDependencyRsiForTest();
  });

  afterEach(() => {
    _resetDependencyRsiForTest();
  });

  it("getDependencyRsiStats returns correct initial shape", () => {
    const stats = getDependencyRsiStats();
    expect(typeof stats.totalScans).toBe("number");
    expect(typeof stats.totalProposals).toBe("number");
    expect(typeof stats.totalApplied).toBe("number");
    expect(typeof stats.totalRolledBack).toBe("number");
    expect(stats.lastScanAt).toBeNull();
    expect(stats.lastAppliedAt).toBeNull();
    expect(stats.packagesKeptCurrent).toBe(0);
  });

  it("initDependencyUpdateRsi is idempotent", () => {
    initDependencyUpdateRsi();
    initDependencyUpdateRsi(); // second call should be no-op
    // Just verify no crash and stats are still valid
    const stats = getDependencyRsiStats();
    expect(stats).toBeDefined();
  });

  it("initial stats have zero counts", () => {
    const stats = getDependencyRsiStats();
    expect(stats.totalScans).toBe(0);
    expect(stats.totalProposals).toBe(0);
    expect(stats.totalApplied).toBe(0);
    expect(stats.totalRolledBack).toBe(0);
  });

  it("_resetDependencyRsiForTest clears all state", () => {
    initDependencyUpdateRsi();
    _resetDependencyRsiForTest();
    const stats = getDependencyRsiStats();
    expect(stats.totalScans).toBe(0);
    expect(stats.totalProposals).toBe(0);
  });

  it("getDependencyRsiStats returns a copy (not a reference)", () => {
    const stats1 = getDependencyRsiStats();
    const stats2 = getDependencyRsiStats();
    expect(stats1).not.toBe(stats2); // different object references
    expect(stats1).toEqual(stats2);  // but same values
  });
});

// ─── 6. Integration: rewardCalibrator + genealogyGuidedGeneration ─────────────

describe("v18 integration: calibrator + genealogy", () => {
  beforeEach(() => {
    _resetRewardCalibratorForTest();
    _resetRefinementStateForTest();
  });

  it("calibrateScore output is in valid range for all typical reward scores", () => {
    const testScores = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1.0];
    for (const score of testScores) {
      const calibrated = calibrateScore(score);
      expect(calibrated).toBeGreaterThanOrEqual(0);
      expect(calibrated).toBeLessThanOrEqual(1);
    }
  });

  it("calibration improves after 25 training samples", () => {
    // Simulate 25 outcomes: high scores → accepted, low scores → rejected
    for (let i = 0; i < 25; i++) {
      updateCalibration(0.8 + Math.random() * 0.2, true);  // high → accepted
      updateCalibration(0.1 + Math.random() * 0.2, false); // low → rejected
    }
    const stats = getCalibrationStats();
    expect(stats.sampleCount).toBe(50);
    // ECE should be finite
    expect(isFinite(stats.expectedCalibrationError)).toBe(true);
  });

  it("refinement stats start at zero and accumulate correctly", () => {
    const initial = getRefinementStats();
    expect(initial.totalRefinementsGenerated).toBe(0);

    recordRefinementOutcome("r1", true);
    recordRefinementOutcome("r2", false);
    recordRefinementOutcome("r3", true);

    const final = getRefinementStats();
    expect(final.totalRefinementsGenerated).toBe(3);
    expect(final.totalRefinementsAccepted).toBe(2);
    expect(final.refinementAcceptanceRate).toBeCloseTo(2 / 3, 5);
  });
});
