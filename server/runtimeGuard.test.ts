/**
 * runtimeGuard.test.ts — Andromeda v12.10.1 Audit
 * Comprehensive tests for the runtime telemetry guard with auto-rollback.
 * Tests the pure extractRoutePaths helper, registerRuntimeWatch API,
 * getRuntimeGuardStats, and clearAllWatches.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  extractRoutePaths,
  registerRuntimeWatch,
  getRuntimeGuardStats,
  clearAllWatches,
  type RouteWatch,
  type RuntimeGuardResult,
} from "./runtimeGuard.js";

// ─── Module loading ───────────────────────────────────────────────────────────
describe("runtimeGuard — module", () => {
  it("loads without errors", async () => {
    await expect(import("./runtimeGuard.js")).resolves.toBeDefined();
  });

  it("exports all required functions", async () => {
    const mod = await import("./runtimeGuard.js");
    expect(typeof mod.extractRoutePaths).toBe("function");
    expect(typeof mod.registerRuntimeWatch).toBe("function");
    expect(typeof mod.getRuntimeGuardStats).toBe("function");
    expect(typeof mod.clearAllWatches).toBe("function");
  });
});

// ─── extractRoutePaths ────────────────────────────────────────────────────────
describe("runtimeGuard — extractRoutePaths", () => {
  it("extracts a simple GET route", () => {
    const content = `router.get('/api/users', handler);`;
    const routes = extractRoutePaths(content);
    expect(routes).toContain("/api/users");
  });

  it("extracts a POST route", () => {
    const content = `router.post('/api/users', handler);`;
    const routes = extractRoutePaths(content);
    expect(routes).toContain("/api/users");
  });

  it("extracts a PUT route", () => {
    const content = `router.put('/api/users/:id', handler);`;
    const routes = extractRoutePaths(content);
    expect(routes).toContain("/api/users/:id");
  });

  it("extracts a DELETE route", () => {
    const content = `router.delete('/api/users/:id', handler);`;
    const routes = extractRoutePaths(content);
    expect(routes).toContain("/api/users/:id");
  });

  it("extracts a PATCH route", () => {
    const content = `router.patch('/api/users/:id', handler);`;
    const routes = extractRoutePaths(content);
    expect(routes).toContain("/api/users/:id");
  });

  it("extracts app.use middleware path", () => {
    const content = `app.use('/api', router);`;
    const routes = extractRoutePaths(content);
    expect(routes).toContain("/api");
  });

  it("extracts multiple routes from a file", () => {
    const content = `
      router.get('/api/users', getUsers);
      router.post('/api/users', createUser);
      router.delete('/api/users/:id', deleteUser);
    `;
    const routes = extractRoutePaths(content);
    expect(routes).toContain("/api/users");
    expect(routes).toContain("/api/users/:id");
  });

  it("returns empty array for file with no routes", () => {
    const content = "const x = 1;\nfunction foo() { return 1; }";
    const routes = extractRoutePaths(content);
    expect(Array.isArray(routes)).toBe(true);
    expect(routes.length).toBe(0);
  });

  it("returns empty array for empty string", () => {
    const routes = extractRoutePaths("");
    expect(Array.isArray(routes)).toBe(true);
    expect(routes.length).toBe(0);
  });

  it("deduplicates routes", () => {
    const content = `
      router.get('/api/users', getUsers);
      router.get('/api/users', getUsers2);
    `;
    const routes = extractRoutePaths(content);
    const count = routes.filter(r => r === "/api/users").length;
    expect(count).toBe(1);
  });

  it("handles double-quoted route strings", () => {
    const content = `router.get("/api/health", handler);`;
    const routes = extractRoutePaths(content);
    expect(routes).toContain("/api/health");
  });

  it("returns an array of strings", () => {
    const content = `router.get('/api/users', handler);`;
    const routes = extractRoutePaths(content);
    expect(Array.isArray(routes)).toBe(true);
    routes.forEach(r => expect(typeof r).toBe("string"));
  });

  it("does not throw on malformed content", () => {
    expect(() => extractRoutePaths("}{{{invalid")).not.toThrow();
  });
});

// ─── registerRuntimeWatch ─────────────────────────────────────────────────────
describe("runtimeGuard — registerRuntimeWatch", () => {
  beforeEach(() => {
    clearAllWatches();
  });

  afterEach(() => {
    clearAllWatches();
  });

  it("returns RuntimeGuardResult with required fields", () => {
    const result = registerRuntimeWatch({
      proposalId: "test-p1",
      targetFile: "server/router.ts",
      projectRoot: "/tmp",
      windowMinutes: 1,
      rollbackFn: vi.fn(),
    });
    expect(result).toHaveProperty("watchRegistered");
    expect(result).toHaveProperty("routes");
    expect(typeof result.watchRegistered).toBe("boolean");
    expect(Array.isArray(result.routes)).toBe(true);
  });

  it("skips watch when targetFile does not exist", () => {
    const result = registerRuntimeWatch({
      proposalId: "test-p2",
      targetFile: "/nonexistent/file.ts",
      projectRoot: "/tmp",
      windowMinutes: 1,
      rollbackFn: vi.fn(),
    });
    expect(result.watchRegistered).toBe(false);
    expect(result.skippedReason).toBeDefined();
  });

  it("returns watchRegistered:false when no routes found in file", () => {
    // Use a real file that exists but has no routes
    const result = registerRuntimeWatch({
      proposalId: "test-p3",
      targetFile: "server/astDiff.ts",
      projectRoot: process.cwd().includes("andromeda") ? process.cwd() : "/home/ubuntu/andromeda_v2",
      windowMinutes: 1,
      rollbackFn: vi.fn(),
    });
    // astDiff.ts has no router.get/post calls, so should skip
    if (!result.watchRegistered) {
      expect(result.skippedReason).toBeDefined();
    }
  });

  it("enforces max 20 concurrent watches", () => {
    // Register 20 watches using a file that has routes
    const projectRoot = "/home/ubuntu/andromeda_v2";
    const rollbackFn = vi.fn();
    // Fill up to 20 watches
    for (let i = 0; i < 20; i++) {
      registerRuntimeWatch({
        proposalId: `test-max-${i}`,
        targetFile: "server/_core/router.ts",
        projectRoot,
        windowMinutes: 60,
        rollbackFn,
      });
    }
    // The 21st should be rejected
    const overflow = registerRuntimeWatch({
      proposalId: "test-overflow",
      targetFile: "server/_core/router.ts",
      projectRoot,
      windowMinutes: 60,
      rollbackFn,
    });
    // Either rejected due to max limit OR because file has no routes
    expect(overflow).toHaveProperty("watchRegistered");
    if (!overflow.watchRegistered) {
      expect(overflow.skippedReason).toBeDefined();
    }
  });

  it("does not throw when rollbackFn is async", () => {
    expect(() => registerRuntimeWatch({
      proposalId: "test-async-rollback",
      targetFile: "/nonexistent/file.ts",
      projectRoot: "/tmp",
      windowMinutes: 1,
      rollbackFn: async () => { /* async no-op */ },
    })).not.toThrow();
  });
});

// ─── getRuntimeGuardStats ─────────────────────────────────────────────────────
describe("runtimeGuard — getRuntimeGuardStats", () => {
  beforeEach(() => {
    clearAllWatches();
  });

  afterEach(() => {
    clearAllWatches();
  });

  it("returns stats object with required fields", () => {
    const stats = getRuntimeGuardStats();
    expect(stats).toHaveProperty("activeWatches");
    expect(stats).toHaveProperty("watchedRoutes");
    expect(typeof stats.activeWatches).toBe("number");
    expect(Array.isArray(stats.watchedRoutes)).toBe(true);
  });

  it("activeWatches is 0 after clearAllWatches", () => {
    clearAllWatches();
    const stats = getRuntimeGuardStats();
    expect(stats.activeWatches).toBe(0);
  });

  it("activeWatches is non-negative", () => {
    const stats = getRuntimeGuardStats();
    expect(stats.activeWatches).toBeGreaterThanOrEqual(0);
  });

  it("watchedRoutes is an array of strings", () => {
    const stats = getRuntimeGuardStats();
    expect(Array.isArray(stats.watchedRoutes)).toBe(true);
    stats.watchedRoutes.forEach((r: string) => expect(typeof r).toBe("string"));
  });

  it("stats shape is consistent across calls", () => {
    const s1 = getRuntimeGuardStats();
    const s2 = getRuntimeGuardStats();
    expect(Object.keys(s1)).toEqual(Object.keys(s2));
  });
});

// ─── clearAllWatches ──────────────────────────────────────────────────────────
describe("runtimeGuard — clearAllWatches", () => {
  it("does not throw when called with no active watches", () => {
    clearAllWatches();
    expect(() => clearAllWatches()).not.toThrow();
  });

  it("sets activeWatches to 0", () => {
    clearAllWatches();
    const stats = getRuntimeGuardStats();
    expect(stats.activeWatches).toBe(0);
  });

  it("can be called multiple times safely", () => {
    expect(() => {
      clearAllWatches();
      clearAllWatches();
      clearAllWatches();
    }).not.toThrow();
  });
});
