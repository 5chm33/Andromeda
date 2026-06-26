import { describe, it, expect, vi, beforeEach } from "vitest";

// v30 new modules
import {
  globalSemanticVersionControl,
  commitImprovement,
  runEvolutionarySearch,
  getVersionDAG,
  findOptimalEvolutionPath,
  initSemanticVersionControl,
} from "./semanticVersionControl";

import {
  globalStakeholderReporting,
  generateWeeklyReport,
  dispatchReport,
  initStakeholderReporting,
} from "./stakeholderReporting";

// v30 deepened modules
import {
  deployBlueGreen,
  deployCanary,
  monitorPostDeployMetrics,
  rollbackDeployment,
  runHealthChecks,
  exportPrometheusMetrics,
  registerPrometheusMetric,
  getDeploymentHistory,
  getActiveSlot,
  initDeploymentDaemon,
} from "./autonomousDeployment";

import {
  CognitiveLoadBalancer,
  globalLoadBalancer,
  getLoadMetrics,
  initCognitiveLoadBalancer,
} from "./cognitiveLoadBalancer";

vi.mock("child_process", () => ({
  execSync: vi.fn().mockReturnValue(Buffer.from("")),
}));

describe("v30 Omega Point Enhancements", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Semantic Version Control ───────────────────────────────────────────────
  describe("Semantic Version Control", () => {
    it("should initialize without errors", () => {
      expect(() => initSemanticVersionControl()).not.toThrow();
    });

    it("should commit an improvement and return a node", () => {
      const node = commitImprovement("Test improvement", [
        { dimension: "accuracy", delta: 0.001, confidence: 0.95 },
      ]);
      expect(node.id).toBeTruthy();
      expect(node.capabilityTags).toHaveLength(1);
      expect(node.branchName).toBe("main");
    });

    it("should create branches and track them", () => {
      globalSemanticVersionControl.createBranch("evo-accuracy-gen0", "accuracy");
      const branches = globalSemanticVersionControl.getBranches();
      expect(branches.some(b => b.name === "evo-accuracy-gen0")).toBe(true);
    });

    it("should run evolutionary search and return a merged node", async () => {
      const result = await runEvolutionarySearch(["accuracy", "speed"], 2);
      expect(result).toBeTruthy();
      expect(result.isCheckpoint).toBe(true);
    });

    it("should return a valid DAG with nodes and edges", () => {
      const dag = getVersionDAG();
      expect(dag.nodes.length).toBeGreaterThan(0);
      expect(Array.isArray(dag.edges)).toBe(true);
    });

    it("should find optimal path for a target dimension", () => {
      const path = findOptimalEvolutionPath("accuracy");
      expect(Array.isArray(path)).toBe(true);
      expect(path.length).toBeGreaterThan(0);
    });

    it("should track node count correctly", () => {
      const before = globalSemanticVersionControl.getNodeCount();
      commitImprovement("Another improvement", [
        { dimension: "safety", delta: 0.0001, confidence: 0.99 },
      ]);
      expect(globalSemanticVersionControl.getNodeCount()).toBeGreaterThan(before);
    });
  });

  // ─── Stakeholder Reporting ──────────────────────────────────────────────────
  describe("Stakeholder Reporting", () => {
    it("should initialize without errors", () => {
      expect(() => initStakeholderReporting()).not.toThrow();
    });

    it("should generate a weekly report with all required fields", () => {
      const report = generateWeeklyReport();
      expect(report.id).toBeTruthy();
      expect(report.headline).toBeTruthy();
      expect(report.executiveSummary).toBeTruthy();
      expect(report.keyMetrics).toBeTruthy();
      expect(report.trends).toBeInstanceOf(Array);
      expect(report.recommendations).toBeInstanceOf(Array);
      expect(report.rawMarkdown).toContain("# Andromeda Weekly Executive Report");
    });

    it("should record metrics and include them in the next report", () => {
      globalStakeholderReporting.recordMetric({
        totalImprovements: 42,
        acceptanceRate: 0.9999999,
        llmCallsPerCycle: 2.0,
      });
      const report = generateWeeklyReport();
      expect(report.keyMetrics.totalImprovements).toBeGreaterThanOrEqual(42);
    });

    it("should maintain report history", () => {
      generateWeeklyReport();
      const history = globalStakeholderReporting.getReportHistory();
      expect(history.length).toBeGreaterThan(0);
    });

    it("should dispatch report to file channel without crashing", async () => {
      const report = generateWeeklyReport();
      await expect(dispatchReport(report)).resolves.not.toThrow();
    });

    it("should return latest report", () => {
      generateWeeklyReport();
      const latest = globalStakeholderReporting.getLatestReport();
      expect(latest).not.toBeNull();
      expect(latest!.rawMarkdown).toContain("Andromeda");
    });
  });

  // ─── Autonomous Deployment (Deepened) ───────────────────────────────────────
  describe("Autonomous Deployment (Deepened)", () => {
    it("should run health checks and return results", () => {
      const results = runHealthChecks("30.0.0");
      expect(results).toBeInstanceOf(Array);
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(typeof r.passed).toBe("boolean");
        expect(typeof r.latencyMs).toBe("number");
      }
    });

    it("should deploy blue-green with health checks", () => {
      const result = deployBlueGreen("30.0.0");
      expect(typeof result).toBe("boolean");
    });

    it("should run canary deployment", async () => {
      const result = await deployCanary("30.0.0-canary", {
        trafficPercent: 10,
        durationMs: 50,
        successThreshold: 0.999,
      });
      expect(typeof result).toBe("boolean");
    });

    it("should export Prometheus metrics in text format", () => {
      initDeploymentDaemon();
      const metrics = exportPrometheusMetrics();
      expect(metrics).toContain("# HELP");
      expect(metrics).toContain("# TYPE");
      expect(metrics).toContain("andromeda_");
    });

    it("should register custom Prometheus metrics", () => {
      registerPrometheusMetric({
        name: "andromeda_test_counter",
        help: "Test counter",
        type: "counter",
        value: 42,
        labels: { env: "test" },
      });
      const exported = exportPrometheusMetrics();
      expect(exported).toContain("andromeda_test_counter");
      expect(exported).toContain('env="test"');
    });

    it("should track deployment history", () => {
      deployBlueGreen("30.0.0");
      const history = getDeploymentHistory();
      expect(history.length).toBeGreaterThan(0);
    });

    it("should rollback and switch active slot", () => {
      const slotBefore = getActiveSlot();
      rollbackDeployment();
      const slotAfter = getActiveSlot();
      expect(slotAfter).not.toBe(slotBefore);
    });
  });

  // ─── Cognitive Load Balancer (Deepened) ─────────────────────────────────────
  describe("Cognitive Load Balancer (Deepened)", () => {
    it("should initialize pool without errors", async () => {
      const balancer = new CognitiveLoadBalancer(4);
      await expect(balancer.initPool()).resolves.not.toThrow();
    });

    it("should distribute workload and return results", async () => {
      const files = ["a.ts", "b.ts", "c.ts", "d.ts"];
      const results = await globalLoadBalancer.distributeWorkload(files);
      expect(results).toHaveLength(4);
      for (const r of results) {
        expect(typeof r.success).toBe("boolean");
        expect(typeof r.durationMs).toBe("number");
      }
    });

    it("should submit high-priority items first", async () => {
      const balancer = new CognitiveLoadBalancer(2);
      await balancer.initPool();
      const highPriority = await balancer.submit({
        id: "hp-1",
        filePath: "critical.ts",
        priority: 10,
        operation: "validate",
      });
      expect(highPriority.success).toBe(true);
    });

    it("should return load metrics", () => {
      const metrics = getLoadMetrics();
      expect(typeof metrics.totalWorkers).toBe("number");
      expect(typeof metrics.completedItems).toBe("number");
      expect(typeof metrics.avgLatencyMs).toBe("number");
      expect(typeof metrics.throughputPerSec).toBe("number");
    });

    it("should calculate adaptive batch size", () => {
      const batchSize = globalLoadBalancer.getAdaptiveBatchSize(100);
      expect(batchSize).toBeGreaterThan(0);
      expect(batchSize).toBeLessThanOrEqual(100);
    });

    it("should initialize via initCognitiveLoadBalancer", () => {
      expect(() => initCognitiveLoadBalancer()).not.toThrow();
    });
  });
});
