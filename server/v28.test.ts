import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { registerSystemdService, initBootstrapper } from "./capabilityBootstrapper";
import { discoverRelatedRepos, runCrossRepoImprovement } from "./crossRepoRsi";
import { collectHumanPreference, trainPreferenceModel, getPreferenceReward } from "./rlhfPipeline";
import { buildDependencyGraph, identifyLoadBearingFiles, detectCircularDeps } from "./depGraphOptimizer";
import { emitDashboardEvent, initStreamingDashboard, getDashboardEmitter } from "./streamingDashboard";
import { generateNewRsiModule, applySrilModule, detectCapabilityGaps } from "./srilEngine";

vi.mock("fs");
vi.mock("child_process", () => ({
  execSync: vi.fn()
}));

describe("v28 SOTA Enhancements", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue(JSON.stringify([]));
  });

  describe("Capability Bootstrapper", () => {
    it("should mock systemd registration on non-linux or without perms", () => {
      // Just verifying it doesn't crash
      expect(() => registerSystemdService("/tmp")).not.toThrow();
    });

    it("should init without crashing", () => {
      expect(() => initBootstrapper({ operatorEmail: "test@test.com", enableSystemd: false, enableAutoUpdate: true })).not.toThrow();
    });
  });

  describe("Cross-Repo RSI", () => {
    it("should discover related repos", async () => {
      const repos = await discoverRelatedRepos({ githubToken: "mock" });
      expect(repos.length).toBeGreaterThan(0);
      expect(repos[0].similarityScore).toBeGreaterThan(0.9);
    });

    it("should run cross-repo improvement", async () => {
      const success = await runCrossRepoImprovement({
        fullName: "test/repo",
        cloneUrl: "https://github.com/test/repo.git",
        language: "TypeScript",
        similarityScore: 0.95
      });
      expect(success).toBe(true);
    });
  });

  describe("RLHF Pipeline", () => {
    it("should collect preferences without crashing", () => {
      expect(() => collectHumanPreference({
        promptId: "123",
        proposalA: "A",
        proposalB: "B",
        preferred: "A",
        timestamp: Date.now()
      })).not.toThrow();
    });

    it("should train model and return loss", () => {
      (fs.readFileSync as any).mockReturnValue(JSON.stringify(Array(15).fill({})));
      const loss = trainPreferenceModel();
      expect(loss).toBeGreaterThan(0);
    });

    it("should return a preference reward", () => {
      (fs.readFileSync as any).mockReturnValue(JSON.stringify({ featureA: 0.5 }));
      const reward = getPreferenceReward({ featureA: 1.0 });
      expect(reward).toBeGreaterThan(0.5);
    });
  });

  describe("Dependency Graph Optimizer", () => {
    it("should build a graph and identify load-bearing files", () => {
      const graph = buildDependencyGraph("/tmp");
      const loadBearing = identifyLoadBearingFiles(graph);
      expect(loadBearing.length).toBeGreaterThan(0);
      expect(loadBearing[0]).toBe("server/selfImprove.ts"); // Fan-in 2
    });

    it("should detect circular dependencies", () => {
      const graph = buildDependencyGraph("/tmp");
      const circular = detectCircularDeps(graph);
      expect(circular.length).toBeGreaterThan(0);
    });
  });

  describe("Streaming Dashboard", () => {
    it("should emit and receive events", () => {
      const emitter = getDashboardEmitter();
      let received = false;
      
      emitter.once("event", (e) => {
        expect(e.type).toBe("proposal_accepted");
        received = true;
      });
      
      emitDashboardEvent("proposal_accepted", { id: "123" });
      expect(received).toBe(true);
    });
  });

  describe("SRIL Engine", () => {
    it("should generate a new module based on a gap", async () => {
      const proposal = await generateNewRsiModule("We need an advanced cache");
      expect(proposal).not.toBeNull();
      expect(proposal?.moduleName).toBe("advancedCache.ts");
    });

    it("should detect capability gaps", () => {
      const gaps = detectCapabilityGaps();
      expect(gaps.length).toBeGreaterThan(0);
    });
    
    it("should apply a SRIL module", async () => {
      const success = await applySrilModule({
        moduleName: "testModule.ts",
        purpose: "test",
        code: "export const test = 1;",
        testCode: "test",
        confidence: 0.99
      }, "/tmp");
      
      expect(success).toBe(true);
    });
  });
});
