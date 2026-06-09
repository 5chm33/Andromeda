/**
 * crossModalSelfImprovement.test.ts
 *
 * Tests for the CrossModalSelfImprovementManager — unified LoRA + TLA+ +
 * prompt RSI loop with UCB1 bandit modality selection.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  CrossModalSelfImprovementManager,
  getCrossModalManager,
  resetCrossModalManager,
  type ImprovementModality,
  type CrossModalCycle,
} from "./crossModalSelfImprovement.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTempDir(): string {
  const dir = join(tmpdir(), `cross-modal-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeManager(overrides: Record<string, unknown> = {}): CrossModalSelfImprovementManager {
  const tmpDir = makeTempDir();
  return new CrossModalSelfImprovementManager({
    dataDir: tmpDir,
    minCycleIntervalMs: 0,     // No delay in tests
    maxCyclesPerSession: 20,
    scoreImprovementThreshold: 0.01,
    enabledModalities: [
      "code_rsi",
      "lora_training",
      "formal_verification",
      "prompt_engineering",
      "knowledge_consolidation",
    ],
    ...overrides,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("CrossModalSelfImprovementManager", () => {
  afterEach(() => {
    resetCrossModalManager();
    vi.restoreAllMocks();
  });

  // ── Initialization ────────────────────────────────────────────────────────────

  describe("initialization", () => {
    it("initializes with all 5 modalities", () => {
      const manager = makeManager();
      const scores = manager.getModalityScores();
      const modalities = scores.map(s => s.modality);

      expect(modalities).toContain("code_rsi");
      expect(modalities).toContain("lora_training");
      expect(modalities).toContain("formal_verification");
      expect(modalities).toContain("prompt_engineering");
      expect(modalities).toContain("knowledge_consolidation");
    });

    it("starts with overall score of 0.5", () => {
      const manager = makeManager();
      expect(manager.getOverallScore()).toBe(0.5);
    });

    it("initializes with zero cycles", () => {
      const manager = makeManager();
      const state = manager.getState();
      expect(state.totalCycles).toBe(0);
      expect(state.cycles).toHaveLength(0);
    });

    it("loads persisted state from disk", () => {
      const tmpDir = makeTempDir();
      const m1 = new CrossModalSelfImprovementManager({
        dataDir: tmpDir,
        minCycleIntervalMs: 0,
        maxCyclesPerSession: 5,
      });

      // Run a cycle to create state
      // We'll manually update the state by checking it loads
      const state1 = m1.getState();
      expect(state1.totalCycles).toBe(0);

      // Create a second manager from same dir
      const m2 = new CrossModalSelfImprovementManager({
        dataDir: tmpDir,
        minCycleIntervalMs: 0,
        maxCyclesPerSession: 5,
      });
      const state2 = m2.getState();
      expect(state2.totalCycles).toBe(0); // Same initial state
    });
  });

  // ── Modality Selection ────────────────────────────────────────────────────────

  describe("selectNextModality", () => {
    it("returns a valid modality", () => {
      const manager = makeManager();
      const { modality } = manager.selectNextModality();
      const validModalities: ImprovementModality[] = [
        "code_rsi", "lora_training", "formal_verification",
        "prompt_engineering", "knowledge_consolidation",
      ];
      expect(validModalities).toContain(modality);
    });

    it("returns a reason string", () => {
      const manager = makeManager();
      const { reason } = manager.selectNextModality();
      expect(typeof reason).toBe("string");
      expect(reason.length).toBeGreaterThan(0);
    });

    it("respects enabled modalities restriction", () => {
      const manager = makeManager({
        enabledModalities: ["formal_verification", "prompt_engineering"],
      });

      // Run selection many times — should only pick from enabled set
      for (let i = 0; i < 10; i++) {
        const { modality } = manager.selectNextModality();
        expect(["formal_verification", "prompt_engineering"]).toContain(modality);
      }
    });

    it("explores unrun modalities first (UCB1 exploration bonus)", () => {
      const manager = makeManager({
        enabledModalities: ["code_rsi", "lora_training"],
      });

      // First selection should pick one of the two (both have cycleCount=0)
      const { modality } = manager.selectNextModality();
      expect(["code_rsi", "lora_training"]).toContain(modality);
    });
  });

  // ── Cycle Execution ───────────────────────────────────────────────────────────

  describe("runCycle", () => {
    it("runs a cycle and returns a CrossModalCycle", async () => {
      const manager = makeManager();

      // Mock all dynamic imports to avoid real external calls
      vi.mock("./rsiEngine.js", () => ({ triggerRSICycleNow: vi.fn(async () => ({ proposalId: "p1" })) }));
      vi.mock("./loraBackendDetector.js", () => ({
        routeLoraTraining: vi.fn(async () => ({ success: true, simulationMode: true, adapterPath: "/tmp/adapter" })),
      }));
      vi.mock("./formalVerification.js", () => ({
        generateTlaSpec: vi.fn(async () => "---- MODULE Test ----\n===="),
      }));
      vi.mock("./llmProvider.js", () => ({
        invokeLlm: vi.fn(async () => "You are Andromeda, an improved AI agent."),
      }));
      vi.mock("./knowledgeBaseConsolidation.js", () => ({
        consolidateKnowledgeBase: vi.fn(async () => undefined),
      }));

      const cycle = await manager.runCycle("formal_verification");

      expect(cycle.id).toMatch(/^cycle-\d+-[a-z0-9]+$/);
      expect(cycle.selectedModality).toBe("formal_verification");
      expect(cycle.startedAt).toBeLessThanOrEqual(Date.now());
      expect(cycle.completedAt).toBeDefined();
      expect(typeof cycle.beforeScore).toBe("number");
    }, 15_000);

    it("increments totalCycles after each cycle", async () => {
      const manager = makeManager({ enabledModalities: ["formal_verification"] });

      vi.mock("./formalVerification.js", () => ({
        generateTlaSpec: vi.fn(async () => "---- MODULE Test ----\n===="),
      }));

      await manager.runCycle("formal_verification");
      expect(manager.getState().totalCycles).toBe(1);

      await manager.runCycle("formal_verification");
      expect(manager.getState().totalCycles).toBe(2);
    }, 15_000);

    it("updates modality score after cycle", async () => {
      const manager = makeManager();

      vi.mock("./formalVerification.js", () => ({
        generateTlaSpec: vi.fn(async () => "---- MODULE Test ----\n===="),
      }));

      const scoresBefore = manager.getModalityScores()
        .find(s => s.modality === "formal_verification")?.currentScore ?? 0.5;

      await manager.runCycle("formal_verification");

      const scoresAfter = manager.getModalityScores()
        .find(s => s.modality === "formal_verification")?.currentScore ?? 0.5;

      // Score should have been updated (EMA applied)
      expect(typeof scoresAfter).toBe("number");
      expect(scoresAfter).toBeGreaterThan(0);
      expect(scoresAfter).toBeLessThanOrEqual(1);
    }, 15_000);

    it("records cycle in state", async () => {
      const manager = makeManager();

      vi.mock("./formalVerification.js", () => ({
        generateTlaSpec: vi.fn(async () => "---- MODULE Test ----\n===="),
      }));

      await manager.runCycle("formal_verification");

      const state = manager.getState();
      expect(state.cycles.length).toBe(1);
      expect(state.cycles[0].selectedModality).toBe("formal_verification");
    }, 15_000);

    it("handles cycle failure gracefully", async () => {
      const manager = makeManager();

      // The code_rsi modality will fail if rsiEngine module is unavailable
      // We verify the cycle completes (doesn't throw) and records success/failure
      const cycle = await manager.runCycle("code_rsi");

      // Cycle should complete without throwing regardless of success/failure
      expect(cycle.id).toMatch(/^cycle-\d+-[a-z0-9]+$/);
      expect(cycle.selectedModality).toBe("code_rsi");
      expect(cycle.completedAt).toBeDefined();
      expect(typeof cycle.success).toBe("boolean");
    }, 15_000);

    it("persists state to disk after cycle", async () => {
      const tmpDir = makeTempDir();
      const manager = new CrossModalSelfImprovementManager({
        dataDir: tmpDir,
        minCycleIntervalMs: 0,
      });

      vi.mock("./formalVerification.js", () => ({
        generateTlaSpec: vi.fn(async () => "---- MODULE Test ----\n===="),
      }));

      await manager.runCycle("formal_verification");

      const statePath = join(tmpDir, "cross_modal_state.json");
      expect(existsSync(statePath)).toBe(true);

      const saved = JSON.parse(readFileSync(statePath, "utf-8"));
      expect(saved.totalCycles).toBe(1);
    }, 15_000);
  });

  // ── Recent Cycles ─────────────────────────────────────────────────────────────

  describe("getRecentCycles", () => {
    it("returns last N cycles", async () => {
      const manager = makeManager();

      vi.mock("./formalVerification.js", () => ({
        generateTlaSpec: vi.fn(async () => "---- MODULE Test ----\n===="),
      }));

      await manager.runCycle("formal_verification");
      await manager.runCycle("formal_verification");
      await manager.runCycle("formal_verification");

      const recent = manager.getRecentCycles(2);
      expect(recent.length).toBe(2);
    }, 30_000);

    it("returns all cycles when N > total", async () => {
      const manager = makeManager();

      vi.mock("./formalVerification.js", () => ({
        generateTlaSpec: vi.fn(async () => "---- MODULE Test ----\n===="),
      }));

      await manager.runCycle("formal_verification");

      const recent = manager.getRecentCycles(100);
      expect(recent.length).toBe(1);
    }, 15_000);
  });

  // ── Session Execution ─────────────────────────────────────────────────────────

  describe("runSession", () => {
    it("runs multiple cycles in a session", async () => {
      const manager = makeManager({
        maxCyclesPerSession: 3,
        enabledModalities: ["formal_verification"],
      });

      vi.mock("./formalVerification.js", () => ({
        generateTlaSpec: vi.fn(async () => "---- MODULE Test ----\n===="),
      }));

      const cycles = await manager.runSession(3);
      expect(cycles.length).toBe(3);
    }, 30_000);

    it("respects maxCyclesPerSession limit", async () => {
      const manager = makeManager({
        maxCyclesPerSession: 2,
        enabledModalities: ["formal_verification"],
      });

      vi.mock("./formalVerification.js", () => ({
        generateTlaSpec: vi.fn(async () => "---- MODULE Test ----\n===="),
      }));

      const cycles = await manager.runSession(10); // Request 10 but max is 2
      expect(cycles.length).toBe(2);
    }, 20_000);
  });

  // ── Singleton ─────────────────────────────────────────────────────────────────

  describe("singleton", () => {
    it("returns the same instance", () => {
      const tmpDir = makeTempDir();
      const m1 = getCrossModalManager({ dataDir: tmpDir });
      const m2 = getCrossModalManager();
      expect(m1).toBe(m2);
    });

    it("creates a new instance after reset", () => {
      const tmpDir = makeTempDir();
      const m1 = getCrossModalManager({ dataDir: tmpDir });
      resetCrossModalManager();
      const m2 = getCrossModalManager({ dataDir: makeTempDir() });
      expect(m1).not.toBe(m2);
    });
  });
});
