/**
 * privilegeSeparation.test.ts
 *
 * Tests for the PrivilegeSeparationManager — RSI staging daemon with
 * kernel privilege separation.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  PrivilegeSeparationManager,
  resetPrivilegeSeparationManager,
  getPrivilegeSeparationManager,
  type StagingContext,
  type StagedChange,
} from "./privilegeSeparation.js";

// ── Test Helpers ──────────────────────────────────────────────────────────────

function makeTempDir(): string {
  const dir = join(tmpdir(), `priv-sep-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeManager(overrides: Record<string, unknown> = {}): { manager: PrivilegeSeparationManager; tmpDir: string } {
  const tmpDir = makeTempDir();
  const manager = new PrivilegeSeparationManager({
    stagingBaseDir: join(tmpDir, "staging"),
    auditLogPath: join(tmpDir, "audit.jsonl"),
    defaultContextTtlMs: 60_000,
    useNamespaceIsolation: false, // Disable for CI
    maxStagingContexts: 5,
    ...overrides,
  });
  return { manager, tmpDir };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("PrivilegeSeparationManager", () => {
  afterEach(() => {
    resetPrivilegeSeparationManager();
  });

  // ── Context Creation ─────────────────────────────────────────────────────────

  describe("createContext", () => {
    it("creates a context with correct defaults", () => {
      const { manager, tmpDir } = makeManager();
      const ctx = manager.createContext([tmpDir]);

      expect(ctx.id).toMatch(/^ctx-\d+-[a-z0-9]+$/);
      expect(ctx.stagingDir).toContain("staging");
      expect(ctx.privilegeLevel).toBe("sandboxed");
      expect(ctx.allowedPaths).toContain(tmpDir);
      expect(ctx.networkAccess).toBe(false);
      expect(ctx.maxMemoryMb).toBe(512);
      expect(ctx.maxCpuPercent).toBe(50);
      expect(ctx.createdAt).toBeLessThanOrEqual(Date.now());
      expect(ctx.expiresAt).toBeGreaterThan(Date.now());
    });

    it("creates staging directory on disk", () => {
      const { manager, tmpDir } = makeManager();
      const ctx = manager.createContext([tmpDir]);
      expect(existsSync(ctx.stagingDir)).toBe(true);
    });

    it("respects custom privilege level", () => {
      const { manager, tmpDir } = makeManager();
      const ctx = manager.createContext([tmpDir], { privilegeLevel: "restricted" });
      expect(ctx.privilegeLevel).toBe("restricted");
    });

    it("respects custom memory and CPU limits", () => {
      const { manager, tmpDir } = makeManager();
      const ctx = manager.createContext([tmpDir], { maxMemoryMb: 256, maxCpuPercent: 25 });
      expect(ctx.maxMemoryMb).toBe(256);
      expect(ctx.maxCpuPercent).toBe(25);
    });

    it("creates audit log entry for context creation", () => {
      const { manager, tmpDir } = makeManager();
      manager.createContext([tmpDir]);
      const log = manager.getAuditLog();
      expect(log.length).toBeGreaterThanOrEqual(1);
      expect(log[0].action).toBe("create_context");
    });

    it("enforces max contexts limit by expiring oldest", () => {
      const { manager, tmpDir } = makeManager({ maxStagingContexts: 3 });
      const ctx1 = manager.createContext([tmpDir]);
      const ctx2 = manager.createContext([tmpDir]);
      const ctx3 = manager.createContext([tmpDir]);
      const ctx4 = manager.createContext([tmpDir]); // Should evict ctx1

      const contexts = manager.getContexts();
      expect(contexts.length).toBe(3);
      expect(contexts.find(c => c.id === ctx1.id)).toBeUndefined();
      expect(contexts.find(c => c.id === ctx4.id)).toBeDefined();
    });
  });

  // ── Stage Changes ─────────────────────────────────────────────────────────────

  describe("stageChange", () => {
    it("stages a new file to the staging directory", () => {
      const { manager, tmpDir } = makeManager();
      const ctx = manager.createContext([tmpDir]);
      const filePath = join(tmpDir, "test.ts");

      const change = manager.stageChange(ctx.id, filePath, "export const x = 1;");

      expect(change.status).toBe("staged");
      expect(change.filePath).toBe(filePath);
      expect(change.stagedContent).toBe("export const x = 1;");
      expect(change.originalContent).toBe(""); // File didn't exist
    });

    it("reads original content when file exists", () => {
      const { manager, tmpDir } = makeManager();
      const ctx = manager.createContext([tmpDir]);
      const filePath = join(tmpDir, "existing.ts");
      writeFileSync(filePath, "export const original = true;", "utf-8");

      const change = manager.stageChange(ctx.id, filePath, "export const modified = true;");

      expect(change.originalContent).toBe("export const original = true;");
      expect(change.stagedContent).toBe("export const modified = true;");
    });

    it("writes staged content to staging directory (not original path)", () => {
      const { manager, tmpDir } = makeManager();
      const ctx = manager.createContext([tmpDir]);
      const filePath = join(tmpDir, "test.ts");

      manager.stageChange(ctx.id, filePath, "staged content");

      // Original file should NOT be modified
      expect(existsSync(filePath)).toBe(false);

      // Staging dir should have the file
      const stagingFiles = existsSync(ctx.stagingDir);
      expect(stagingFiles).toBe(true);
    });

    it("throws for paths not in allowedPaths", () => {
      const { manager, tmpDir } = makeManager();
      const ctx = manager.createContext([tmpDir]);

      expect(() => {
        manager.stageChange(ctx.id, "/etc/passwd", "malicious");
      }).toThrow(/not allowed/);
    });

    it("throws for denied paths even if in allowedPaths", () => {
      const { manager } = makeManager();
      const ctx = manager.createContext(["/etc"]);

      expect(() => {
        manager.stageChange(ctx.id, "/etc/shadow", "malicious");
      }).toThrow(/not allowed/);
    });

    it("throws for expired context", () => {
      const { manager, tmpDir } = makeManager({ defaultContextTtlMs: 1 });
      const ctx = manager.createContext([tmpDir]);

      // Wait for expiry
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(() => {
            manager.stageChange(ctx.id, join(tmpDir, "test.ts"), "content");
          }).toThrow(/expired/);
          resolve();
        }, 10);
      });
    });

    it("throws for unknown context ID", () => {
      const { manager, tmpDir } = makeManager();

      expect(() => {
        manager.stageChange("nonexistent-ctx", join(tmpDir, "test.ts"), "content");
      }).toThrow(/not found/);
    });

    it("counts diff lines correctly", () => {
      const { manager, tmpDir } = makeManager();
      const ctx = manager.createContext([tmpDir]);
      const filePath = join(tmpDir, "diff.ts");
      writeFileSync(filePath, "line1\nline2\nline3", "utf-8");

      const change = manager.stageChange(ctx.id, filePath, "line1\nline2\nline3\nline4\nline5");

      expect(change.diffLines).toBe(2); // line4 and line5 are new
    });

    it("retrieves staged changes for a context", () => {
      const { manager, tmpDir } = makeManager();
      const ctx = manager.createContext([tmpDir]);

      manager.stageChange(ctx.id, join(tmpDir, "a.ts"), "content a");
      manager.stageChange(ctx.id, join(tmpDir, "b.ts"), "content b");

      const changes = manager.getStagedChanges(ctx.id);
      expect(changes.length).toBe(2);
    });
  });

  // ── Validation ────────────────────────────────────────────────────────────────

  describe("validateContext", () => {
    it("validates a context with safe content", async () => {
      const { manager, tmpDir } = makeManager();
      const ctx = manager.createContext([tmpDir]);
      manager.stageChange(ctx.id, join(tmpDir, "safe.ts"), "export const safe = true;");

      const result = await manager.validateContext(ctx.id);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("rejects content with dangerous eval pattern", async () => {
      const { manager, tmpDir } = makeManager();
      const ctx = manager.createContext([tmpDir]);
      manager.stageChange(ctx.id, join(tmpDir, "danger.ts"), "eval('malicious code')");

      const result = await manager.validateContext(ctx.id);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("Dangerous pattern"))).toBe(true);
    });

    it("rejects content with DROP TABLE pattern", async () => {
      const { manager, tmpDir } = makeManager();
      const ctx = manager.createContext([tmpDir]);
      manager.stageChange(ctx.id, join(tmpDir, "sql.ts"), "DROP TABLE users;");

      const result = await manager.validateContext(ctx.id);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("Dangerous pattern"))).toBe(true);
    });

    it("marks changes as validated on success", async () => {
      const { manager, tmpDir } = makeManager();
      const ctx = manager.createContext([tmpDir]);
      manager.stageChange(ctx.id, join(tmpDir, "ok.ts"), "export const x = 42;");

      await manager.validateContext(ctx.id);

      const changes = manager.getStagedChanges(ctx.id);
      expect(changes[0].status).toBe("validated");
      expect(changes[0].validatedAt).toBeDefined();
    });

    it("throws for unknown context", async () => {
      const { manager } = makeManager();
      await expect(manager.validateContext("bad-id")).rejects.toThrow(/not found/);
    });
  });

  // ── Promotion ─────────────────────────────────────────────────────────────────

  describe("promoteContext", () => {
    it("promotes validated changes to production paths", async () => {
      const { manager, tmpDir } = makeManager();
      const ctx = manager.createContext([tmpDir]);
      const filePath = join(tmpDir, "promote.ts");

      manager.stageChange(ctx.id, filePath, "export const promoted = true;");
      await manager.validateContext(ctx.id);
      const result = manager.promoteContext(ctx.id);

      expect(result.promoted).toBe(1);
      expect(result.skipped).toBe(0);
      expect(existsSync(filePath)).toBe(true);
      expect(readFileSync(filePath, "utf-8")).toBe("export const promoted = true;");
    });

    it("skips non-validated changes", async () => {
      const { manager, tmpDir } = makeManager();
      const ctx = manager.createContext([tmpDir]);
      const filePath = join(tmpDir, "skip.ts");

      // Stage but don't validate
      manager.stageChange(ctx.id, filePath, "content");
      const result = manager.promoteContext(ctx.id);

      expect(result.promoted).toBe(0);
      expect(result.skipped).toBe(1);
      expect(existsSync(filePath)).toBe(false);
    });

    it("marks promoted changes with promotedAt timestamp", async () => {
      const { manager, tmpDir } = makeManager();
      const ctx = manager.createContext([tmpDir]);

      manager.stageChange(ctx.id, join(tmpDir, "ts.ts"), "export const x = 1;");
      await manager.validateContext(ctx.id);
      manager.promoteContext(ctx.id);

      const changes = manager.getStagedChanges(ctx.id);
      expect(changes[0].status).toBe("promoted");
      expect(changes[0].promotedAt).toBeDefined();
    });

    it("throws for unknown context", () => {
      const { manager } = makeManager();
      expect(() => manager.promoteContext("bad-id")).toThrow(/not found/);
    });
  });

  // ── Rejection ─────────────────────────────────────────────────────────────────

  describe("rejectContext", () => {
    it("marks all changes as rejected", () => {
      const { manager, tmpDir } = makeManager();
      const ctx = manager.createContext([tmpDir]);
      manager.stageChange(ctx.id, join(tmpDir, "a.ts"), "content");
      manager.stageChange(ctx.id, join(tmpDir, "b.ts"), "content");

      manager.rejectContext(ctx.id, "test rejection");

      // Context should be removed
      expect(manager.getContexts().find(c => c.id === ctx.id)).toBeUndefined();
    });

    it("creates audit entry for rejection", () => {
      const { manager, tmpDir } = makeManager();
      const ctx = manager.createContext([tmpDir]);
      manager.rejectContext(ctx.id, "security violation");

      const log = manager.getAuditLog();
      const rejectEntry = log.find(e => e.action === "reject");
      expect(rejectEntry).toBeDefined();
      expect(rejectEntry?.details.reason).toBe("security violation");
    });

    it("is idempotent for unknown context IDs", () => {
      const { manager } = makeManager();
      expect(() => manager.rejectContext("nonexistent", "reason")).not.toThrow();
    });
  });

  // ── Audit Log ─────────────────────────────────────────────────────────────────

  describe("audit log", () => {
    it("persists audit entries to disk", () => {
      const { manager, tmpDir } = makeManager();
      const auditPath = join(tmpDir, "audit.jsonl");
      const ctx = manager.createContext([tmpDir]);
      manager.stageChange(ctx.id, join(tmpDir, "x.ts"), "content");

      expect(existsSync(auditPath)).toBe(true);
      const lines = readFileSync(auditPath, "utf-8").trim().split("\n");
      expect(lines.length).toBeGreaterThanOrEqual(2);

      const firstEntry = JSON.parse(lines[0]);
      expect(firstEntry.action).toBe("create_context");
      expect(firstEntry.contextId).toBe(ctx.id);
    });

    it("includes timestamp and privilege level in entries", () => {
      const { manager, tmpDir } = makeManager();
      manager.createContext([tmpDir]);

      const log = manager.getAuditLog();
      expect(log[0].timestamp).toBeLessThanOrEqual(Date.now());
      expect(log[0].privilegeLevel).toBeDefined();
    });
  });

  // ── Singleton ─────────────────────────────────────────────────────────────────

  describe("singleton", () => {
    it("returns the same instance on multiple calls", () => {
      const tmpDir = makeTempDir();
      const m1 = getPrivilegeSeparationManager({
        stagingBaseDir: join(tmpDir, "staging"),
        auditLogPath: join(tmpDir, "audit.jsonl"),
      });
      const m2 = getPrivilegeSeparationManager();
      expect(m1).toBe(m2);
    });

    it("creates a new instance after reset", () => {
      const tmpDir = makeTempDir();
      const m1 = getPrivilegeSeparationManager({
        stagingBaseDir: join(tmpDir, "staging"),
        auditLogPath: join(tmpDir, "audit.jsonl"),
      });
      resetPrivilegeSeparationManager();
      const m2 = getPrivilegeSeparationManager({
        stagingBaseDir: join(tmpDir, "staging2"),
        auditLogPath: join(tmpDir, "audit2.jsonl"),
      });
      expect(m1).not.toBe(m2);
    });
  });
});
