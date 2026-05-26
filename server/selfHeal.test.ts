/**
 * Andromeda v6.12 — Self-Heal Subsystem Tests
 *
 * Tests for the self-healing pipeline:
 *  - Configuration management (getHealStatus, setHealConfig)
 *  - Heal loop lifecycle (start/stop)
 *  - Circuit breaker behavior
 *  - Health metric tracking
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  getHealStatus,
  setHealConfig,
  startHealLoop,
  stopHealLoop,
  type SelfHealConfig,
} from "./selfHeal.js";

describe("selfHeal", () => {
  beforeEach(() => {
    // Ensure heal loop is stopped before each test
    stopHealLoop();
  });

  describe("getHealStatus", () => {
    it("returns a valid status object", () => {
      const status = getHealStatus();
      expect(status).toHaveProperty("running");
      expect(status).toHaveProperty("config");
      expect(status).toHaveProperty("activeEvents");
      expect(status).toHaveProperty("recentAttempts");
      expect(status).toHaveProperty("consecutiveFailures");
      expect(status).toHaveProperty("circuitBreakerOpen");
      expect(typeof status.running).toBe("boolean");
      expect(typeof status.consecutiveFailures).toBe("number");
      expect(typeof status.circuitBreakerOpen).toBe("boolean");
      expect(Array.isArray(status.activeEvents)).toBe(true);
      expect(Array.isArray(status.recentAttempts)).toBe(true);
    });

    it("returns default config values", () => {
      const status = getHealStatus();
      expect(status.config.enabled).toBe(true);
      expect(status.config.checkIntervalMs).toBe(60_000);
      expect(status.config.maxHealAttemptsPerIssue).toBe(3);
      expect(status.config.cooldownAfterHealMs).toBe(120_000);
      expect(status.config.autoApplyConfidence).toBe(0.8);
      expect(status.config.circuitBreakerThreshold).toBe(5);
      expect(status.config.enableLLMDiagnosis).toBe(true);
      expect(status.config.enableAutoFix).toBe(true);
    });

    it("reports not running initially", () => {
      const status = getHealStatus();
      expect(status.running).toBe(false);
    });
  });

  describe("setHealConfig", () => {
    it("updates partial config and returns merged result", () => {
      const updated = setHealConfig({ checkIntervalMs: 30_000 });
      expect(updated.checkIntervalMs).toBe(30_000);
      // Other fields should remain at defaults
      expect(updated.enabled).toBe(true);
      expect(updated.maxHealAttemptsPerIssue).toBe(3);
    });

    it("updates multiple fields at once", () => {
      const updated = setHealConfig({
        enabled: false,
        enableLLMDiagnosis: false,
        circuitBreakerThreshold: 10,
      });
      expect(updated.enabled).toBe(false);
      expect(updated.enableLLMDiagnosis).toBe(false);
      expect(updated.circuitBreakerThreshold).toBe(10);
    });

    it("persists config changes across getHealStatus calls", () => {
      setHealConfig({ autoApplyConfidence: 0.95 });
      const status = getHealStatus();
      expect(status.config.autoApplyConfidence).toBe(0.95);
    });
  });

  describe("startHealLoop / stopHealLoop", () => {
    it("starts the heal loop successfully", () => {
      const result = startHealLoop();
      expect(result.success).toBe(true);
      expect(result.message).toBeTruthy();
      const status = getHealStatus();
      expect(status.running).toBe(true);
      // Clean up
      stopHealLoop();
    });

    it("stops the heal loop successfully", () => {
      startHealLoop();
      const result = stopHealLoop();
      expect(result.success).toBe(true);
      const status = getHealStatus();
      expect(status.running).toBe(false);
    });

    it("handles double-start gracefully", () => {
      startHealLoop();
      const result = startHealLoop();
      // Should either succeed or return a meaningful message
      expect(typeof result.success).toBe("boolean");
      expect(typeof result.message).toBe("string");
      stopHealLoop();
    });

    it("handles double-stop gracefully", () => {
      const result = stopHealLoop();
      expect(typeof result.success).toBe("boolean");
      expect(typeof result.message).toBe("string");
    });
  });

  describe("circuit breaker", () => {
    it("reports circuit breaker as closed initially", () => {
      const status = getHealStatus();
      expect(status.circuitBreakerOpen).toBe(false);
      expect(status.consecutiveFailures).toBe(0);
    });
  });
});
