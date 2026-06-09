import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import os from "os";

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(os.tmpdir(), `swarm-test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  process.env.ANDROMEDA_WORKSPACE = tmpDir;
  vi.resetModules();
});

afterEach(async () => {
  delete process.env.ANDROMEDA_WORKSPACE;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("swarmOrchestrator", () => {
  describe("peer registry", () => {
    it("starts with an empty peer list", async () => {
      const { loadPeers } = await import("./swarmOrchestrator.js");
      expect(loadPeers()).toEqual([]);
    });

    it("registers a peer and persists it", async () => {
      const { registerPeer, loadPeers } = await import("./swarmOrchestrator.js");
      registerPeer({
        instanceId: "peer-abc",
        url: "http://192.168.1.10:3000",
        trustScore: 0.8,
        capabilities: ["eval", "judge"],
      });
      const peers = loadPeers();
      expect(peers).toHaveLength(1);
      expect(peers[0].instanceId).toBe("peer-abc");
      expect(peers[0].url).toBe("http://192.168.1.10:3000");
      expect(peers[0].isOnline).toBe(true);
      expect(peers[0].lastSeen).toBeGreaterThan(0);
    });

    it("updates an existing peer on re-registration", async () => {
      const { registerPeer, loadPeers } = await import("./swarmOrchestrator.js");
      registerPeer({ instanceId: "peer-xyz", url: "http://old-url:3000", trustScore: 0.5, capabilities: [] });
      registerPeer({ instanceId: "peer-xyz", url: "http://new-url:3000", trustScore: 0.9, capabilities: ["eval"] });
      const peers = loadPeers();
      expect(peers).toHaveLength(1);
      expect(peers[0].url).toBe("http://new-url:3000");
    });
  });

  describe("getEligiblePeers", () => {
    it("returns no peers when trust registry is empty", async () => {
      const { registerPeer, getEligiblePeers } = await import("./swarmOrchestrator.js");
      registerPeer({ instanceId: "peer-1", url: "http://peer1:3000", trustScore: 0.8, capabilities: ["eval"] });
      // Peer is registered but not in trust registry — should be excluded
      const eligible = getEligiblePeers();
      expect(eligible).toHaveLength(0);
    });

    it("returns eligible peers when they are trusted and recently seen", async () => {
      const { registerPeer, getEligiblePeers } = await import("./swarmOrchestrator.js");
      const { registerTrustedPeer } = await import("./zkProofSigning.js");

      registerPeer({ instanceId: "peer-trusted", url: "http://peer-trusted:3000", trustScore: 0.9, capabilities: ["eval"] });
      registerTrustedPeer("peer-trusted", "a".repeat(64), 0.9);

      const eligible = getEligiblePeers();
      expect(eligible).toHaveLength(1);
      expect(eligible[0].instanceId).toBe("peer-trusted");
    });

    it("filters out peers with insufficient trust score", async () => {
      const { registerPeer, getEligiblePeers } = await import("./swarmOrchestrator.js");
      const { registerTrustedPeer } = await import("./zkProofSigning.js");

      registerPeer({ instanceId: "peer-low-trust", url: "http://peer-low:3000", trustScore: 0.1, capabilities: [] });
      registerTrustedPeer("peer-low-trust", "b".repeat(64), 0.1); // Below 0.3 default threshold

      const eligible = getEligiblePeers({
        minTrustScore: 0.3,
        maxParallelPeers: 5,
        peerTimeoutMs: 5000,
        localFallback: true,
      });
      expect(eligible).toHaveLength(0);
    });

    it("filters by required capability", async () => {
      const { registerPeer, getEligiblePeers } = await import("./swarmOrchestrator.js");
      const { registerTrustedPeer } = await import("./zkProofSigning.js");

      registerPeer({ instanceId: "peer-eval", url: "http://peer-eval:3000", trustScore: 0.9, capabilities: ["eval"] });
      registerPeer({ instanceId: "peer-judge", url: "http://peer-judge:3000", trustScore: 0.9, capabilities: ["judge"] });
      registerTrustedPeer("peer-eval", "a".repeat(64), 0.9);
      registerTrustedPeer("peer-judge", "b".repeat(64), 0.9);

      const evalPeers = getEligiblePeers(undefined, "eval");
      expect(evalPeers).toHaveLength(1);
      expect(evalPeers[0].instanceId).toBe("peer-eval");
    });
  });

  describe("task store", () => {
    it("creates and persists a task", async () => {
      const { createTask, loadTasks } = await import("./swarmOrchestrator.js");
      const task = createTask("eval", { prompt: "test prompt" }, "instance-001");

      expect(task.id).toMatch(/^task-/);
      expect(task.type).toBe("eval");
      expect(task.status).toBe("pending");
      expect(task.originInstanceId).toBe("instance-001");
      expect(task.commitmentHash).toHaveLength(64);

      const tasks = loadTasks();
      expect(tasks.some((t) => t.id === task.id)).toBe(true);
    });

    it("saveTask updates an existing task", async () => {
      const { createTask, saveTask, loadTasks } = await import("./swarmOrchestrator.js");
      const task = createTask("eval", { input: "hello" }, "local");
      const updated = { ...task, status: "completed" as const };
      saveTask(updated);

      const tasks = loadTasks();
      const found = tasks.find((t) => t.id === task.id);
      expect(found?.status).toBe("completed");
    });
  });

  describe("dispatchTask", () => {
    it("uses local fallback when no eligible peers exist", async () => {
      const { createTask, dispatchTask } = await import("./swarmOrchestrator.js");
      const task = createTask("eval", { input: "hello" }, "local-instance");

      const localExecutor = vi.fn().mockResolvedValue({ result: "world" });
      const result = await dispatchTask(task, localExecutor, {
        maxParallelPeers: 5,
        peerTimeoutMs: 5000,
        minTrustScore: 0.3,
        localFallback: true,
      });

      expect(localExecutor).toHaveBeenCalledWith({ input: "hello" });
      expect(result.taskId).toBe(task.id);
      expect(result.peerCount).toBe(1);
      expect(result.failureCount).toBe(0);
      expect(result.aggregated).toEqual({ result: "world" });
      expect(result.results[0].instanceId).toBe("local");
    });

    it("returns empty results when no peers and local fallback is disabled", async () => {
      const { createTask, dispatchTask } = await import("./swarmOrchestrator.js");
      const task = createTask("eval", { input: "hello" }, "local-instance");

      const localExecutor = vi.fn();
      const result = await dispatchTask(task, localExecutor, {
        maxParallelPeers: 5,
        peerTimeoutMs: 5000,
        minTrustScore: 0.3,
        localFallback: false,
      });

      expect(localExecutor).not.toHaveBeenCalled();
      expect(result.results).toHaveLength(0);
      expect(result.peerCount).toBe(0);
    });
  });

  describe("getSwarmHealth", () => {
    it("returns correct health metrics for empty swarm", async () => {
      const { getSwarmHealth } = await import("./swarmOrchestrator.js");
      const health = getSwarmHealth();

      expect(health.totalPeers).toBe(0);
      expect(health.onlinePeers).toBe(0);
      expect(health.averageTrustScore).toBe(0);
      expect(health.pendingTasks).toBe(0);
      expect(health.successRate).toBe(1.0);
    });

    it("reflects registered peers in health metrics", async () => {
      const { registerPeer, getSwarmHealth } = await import("./swarmOrchestrator.js");
      registerPeer({ instanceId: "p1", url: "http://p1:3000", trustScore: 0.8, capabilities: [] });
      registerPeer({ instanceId: "p2", url: "http://p2:3000", trustScore: 0.6, capabilities: [] });

      const health = getSwarmHealth();
      expect(health.totalPeers).toBe(2);
      expect(health.onlinePeers).toBe(2);
    });
  });
});
