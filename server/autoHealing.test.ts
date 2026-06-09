import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import os from "os";

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(os.tmpdir(), `autohealing-test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  process.env.ANDROMEDA_WORKSPACE = tmpDir;
});

afterEach(async () => {
  const { resetAutoHealer } = await import("./autoHealing.js");
  resetAutoHealer();
  vi.resetModules();
  delete process.env.ANDROMEDA_WORKSPACE;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("autoHealing", () => {
  describe("checkMemoryHealth", () => {
    it("returns a HealthCheck with a valid status", async () => {
      const { checkMemoryHealth } = await import("./autoHealing.js");
      const check = checkMemoryHealth();

      expect(check.name).toBe("memory");
      expect(["healthy", "degraded", "critical"]).toContain(check.status);
      expect(check.message).toBeTruthy();
      // In a normal test environment, memory should be healthy or degraded (not critical)
      expect(check.status).not.toBe("critical");
    });

    it("includes autoHealable flag", async () => {
      const { checkMemoryHealth } = await import("./autoHealing.js");
      const check = checkMemoryHealth();
      expect(typeof check.autoHealable).toBe("boolean");
    });
  });

  describe("checkDatabaseHealth", () => {
    it("returns a HealthCheck with a valid status", async () => {
      const { checkDatabaseHealth } = await import("./autoHealing.js");
      const check = checkDatabaseHealth();

      expect(check.name).toBe("database");
      expect(["healthy", "degraded", "critical"]).toContain(check.status);
      expect(check.message).toBeTruthy();
    });

    it("returns degraded or healthy when DB file does not exist", async () => {
      const { checkDatabaseHealth } = await import("./autoHealing.js");
      const check = checkDatabaseHealth();
      // In test environment, DB may not exist — should be degraded, not critical
      expect(["healthy", "degraded"]).toContain(check.status);
    });
  });

  describe("checkConfigHealth", () => {
    it("returns a HealthCheck with a valid status", async () => {
      const { checkConfigHealth } = await import("./autoHealing.js");
      const check = checkConfigHealth();

      expect(check.name).toBe("config");
      expect(["healthy", "degraded", "critical"]).toContain(check.status);
    });
  });

  describe("checkTmpFilesHealth", () => {
    it("returns a HealthCheck with a valid status", async () => {
      const { checkTmpFilesHealth } = await import("./autoHealing.js");
      const check = checkTmpFilesHealth();

      expect(check.name).toBe("tmp_files");
      expect(["healthy", "degraded", "critical"]).toContain(check.status);
    });
  });

  describe("executeHealingAction", () => {
    it("executes gc_trigger action and returns a HealingEvent", async () => {
      const { executeHealingAction } = await import("./autoHealing.js");
      const event = executeHealingAction("gc_trigger", "Test GC trigger");

      expect(event.action).toBe("gc_trigger");
      expect(event.trigger).toBe("Test GC trigger");
      expect(["success", "failed", "skipped"]).toContain(event.status);
      expect(event.timestamp).toBeGreaterThan(0);
      expect(event.completedAt).toBeGreaterThan(0);
    });

    it("executes clear_tmp_files action", async () => {
      const { executeHealingAction } = await import("./autoHealing.js");
      const event = executeHealingAction("clear_tmp_files", "Test cleanup");

      expect(event.action).toBe("clear_tmp_files");
      expect(event.trigger).toBe("Test cleanup");
      expect(["success", "failed", "skipped"]).toContain(event.status);
    });

    it("skips reinstall_dependency when no package is provided", async () => {
      const { executeHealingAction } = await import("./autoHealing.js");
      const event = executeHealingAction("reinstall_dependency", "Missing package");

      expect(event.action).toBe("reinstall_dependency");
      expect(event.trigger).toBe("Missing package");
      expect(event.status).toBe("skipped");
    });

    it("persists healing event to healing_log.jsonl", async () => {
      const { executeHealingAction } = await import("./autoHealing.js");
      mkdirSync(join(tmpDir, "data"), { recursive: true });
      executeHealingAction("gc_trigger", "Test persistence");

      expect(existsSync(join(tmpDir, "data", "healing_log.jsonl"))).toBe(true);
    });
  });

  describe("AutoHealer", () => {
    it("starts and stops correctly", async () => {
      const { AutoHealer } = await import("./autoHealing.js");
      const healer = new AutoHealer(60_000);

      expect(healer.isActive()).toBe(false);
      healer.start();
      expect(healer.isActive()).toBe(true);
      healer.stop();
      expect(healer.isActive()).toBe(false);
    });

    it("does not start twice", async () => {
      const { AutoHealer } = await import("./autoHealing.js");
      const healer = new AutoHealer(60_000);

      healer.start();
      healer.start(); // Second call should be a no-op
      expect(healer.isActive()).toBe(true);
      healer.stop();
    });

    it("emits started event on start", async () => {
      const { AutoHealer } = await import("./autoHealing.js");
      const healer = new AutoHealer(60_000);

      const events: unknown[] = [];
      healer.on("started", () => events.push("started"));

      healer.start();
      healer.stop();

      expect(events).toContain("started");
    });

    it("emits stopped event on stop", async () => {
      const { AutoHealer } = await import("./autoHealing.js");
      const healer = new AutoHealer(60_000);

      const events: unknown[] = [];
      healer.on("stopped", () => events.push("stopped"));

      healer.start();
      healer.stop();

      expect(events).toContain("stopped");
    });

    it("runHealthChecks returns a SystemHealth object", async () => {
      const { AutoHealer } = await import("./autoHealing.js");
      const healer = new AutoHealer(60_000);

      const health = await healer.runHealthChecks();

      expect(["healthy", "degraded", "critical"]).toContain(health.overall);
      expect(Array.isArray(health.checks)).toBe(true);
      expect(health.checks.length).toBeGreaterThan(0);
      expect(health.lastCheckedAt).toBeGreaterThan(0);
    });

    it("emits health event during runHealthChecks", async () => {
      const { AutoHealer } = await import("./autoHealing.js");
      const healer = new AutoHealer(60_000);

      const healthEvents: unknown[] = [];
      healer.on("health", (h) => healthEvents.push(h));

      await healer.runHealthChecks();

      expect(healthEvents).toHaveLength(1);
    });

    it("getHealingHistory returns an array", async () => {
      const { AutoHealer } = await import("./autoHealing.js");
      const healer = new AutoHealer(60_000);

      expect(Array.isArray(healer.getHealingHistory())).toBe(true);
    });
  });

  describe("getAutoHealer singleton", () => {
    it("returns the same instance on multiple calls", async () => {
      const { getAutoHealer } = await import("./autoHealing.js");
      const h1 = getAutoHealer();
      const h2 = getAutoHealer();
      expect(h1).toBe(h2);
    });

    it("resetAutoHealer clears the singleton", async () => {
      const { getAutoHealer, resetAutoHealer } = await import("./autoHealing.js");
      const h1 = getAutoHealer();
      resetAutoHealer();
      const h2 = getAutoHealer();
      expect(h1).not.toBe(h2);
    });
  });

  describe("loadHealingLog", () => {
    it("returns empty array when no log exists", async () => {
      const { loadHealingLog } = await import("./autoHealing.js");
      expect(loadHealingLog()).toEqual([]);
    });

    it("returns logged events after executeHealingAction", async () => {
      const { executeHealingAction, loadHealingLog } = await import("./autoHealing.js");
      mkdirSync(join(tmpDir, "data"), { recursive: true });
      executeHealingAction("gc_trigger", "Test log read");

      const log = loadHealingLog();
      expect(log.length).toBeGreaterThan(0);
      expect(log[0].action).toBe("gc_trigger");
      expect(log[0].trigger).toBe("Test log read");
    });
  });
});
