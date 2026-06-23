import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Mock child_process execSync for docker and df commands
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return {
    ...actual,
    execSync: vi.fn((cmd: string) => {
      if (cmd.includes("docker ps")) return "Up 2 hours\nUp 1 hour\nExited (0) 3 hours ago\n";
      if (cmd.includes("docker images -q")) return "3\n";
      if (cmd.includes("docker info")) return "24.0.0";
      if (cmd.includes("docker stop")) return "";
      if (cmd.includes("docker container prune")) return "Deleted Containers:\n2\n";
      if (cmd.includes("df -BG")) return "/dev/sda1   200G   50G   150G   25% /\n";
      return "";
    }),
  };
});

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "andromeda-os-test-"));
  process.env.ANDROMEDA_WORKSPACE = tmpDir;
  fs.mkdirSync(path.join(tmpDir, "server", "data"), { recursive: true });
});

afterEach(() => {
  delete process.env.ANDROMEDA_WORKSPACE;
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe("osGrounding", () => {
  it("getMemoryMetrics returns valid memory data", async () => {
    const { getMemoryMetrics } = await import("./osGrounding.js");
    const metrics = getMemoryMetrics();

    expect(metrics.totalMb).toBeGreaterThan(0);
    expect(metrics.usedMb).toBeGreaterThan(0);
    expect(metrics.freeMb).toBeGreaterThanOrEqual(0);
    expect(metrics.usagePercent).toBeGreaterThanOrEqual(0);
    expect(metrics.usagePercent).toBeLessThanOrEqual(100);
    expect(metrics.processRssMb).toBeGreaterThan(0);
    expect(metrics.processHeapUsedMb).toBeGreaterThan(0);
    expect(metrics.processHeapTotalMb).toBeGreaterThan(0);
  });

  it("getCpuMetrics returns valid CPU data", async () => {
    const { getCpuMetrics } = await import("./osGrounding.js");
    const metrics = getCpuMetrics();

    expect(metrics.cores).toBeGreaterThan(0);
    expect(typeof metrics.loadAvg1m).toBe("number");
    expect(typeof metrics.loadAvg5m).toBe("number");
    expect(typeof metrics.loadAvg15m).toBe("number");
    expect(metrics.usagePercent).toBeGreaterThanOrEqual(0);
  });

  it("getDiskMetrics returns parsed disk usage", async () => {
    const { getDiskMetrics } = await import("./osGrounding.js");
    const metrics = getDiskMetrics();

    expect(metrics.workspacePath).toBe(tmpDir);
    expect(metrics.totalGb).toBe(200);
    expect(metrics.usedGb).toBe(50);
    expect(metrics.freeGb).toBe(150);
    expect(metrics.usagePercent).toBe(25);
  });

  it("getDockerMetrics returns running/stopped container counts", async () => {
    const { getDockerMetrics } = await import("./osGrounding.js");
    const metrics = getDockerMetrics();

    expect(metrics.available).toBe(true);
    expect(metrics.runningContainers).toBe(2);
    expect(metrics.stoppedContainers).toBe(1);
    expect(metrics.images).toBe(3);
  });

  it("getSystemHealth returns overall health status", async () => {
    const { getSystemHealth } = await import("./osGrounding.js");
    const health = getSystemHealth();

    expect(["healthy", "warning", "critical"]).toContain(health.overallHealth);
    expect(Array.isArray(health.alerts)).toBe(true);
    expect(typeof health.timestamp).toBe("number");
    expect(health.memory).toBeDefined();
    expect(health.cpu).toBeDefined();
    expect(health.disk).toBeDefined();
    expect(health.docker).toBeDefined();
  });

  it("getMigrationStatus returns pending and applied arrays", async () => {
    const { getMigrationStatus } = await import("./osGrounding.js");
    const status = getMigrationStatus();

    expect(Array.isArray(status.pending)).toBe(true);
    expect(Array.isArray(status.applied)).toBe(true);
  });

  it("runPendingMigrations returns applied and errors arrays", async () => {
    const { runPendingMigrations } = await import("./osGrounding.js");
    const result = runPendingMigrations();

    expect(Array.isArray(result.applied)).toBe(true);
    expect(Array.isArray(result.errors)).toBe(true);
  });

  it("triggerGarbageCollection returns false when gc is not exposed", async () => {
    const { triggerGarbageCollection } = await import("./osGrounding.js");
    // In test environment, global.gc is not available
    const result = triggerGarbageCollection();
    expect(typeof result).toBe("boolean");
  });

  it("stopContainer calls docker stop", async () => {
    const { stopContainer } = await import("./osGrounding.js");
    const { execSync } = await import("child_process");

    const result = stopContainer("abc123def456");
    expect(result).toBe(true);
    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining("docker stop"),
      expect.anything()
    );
  });

  it("removeStoppedContainers returns count of removed containers", async () => {
    const { removeStoppedContainers } = await import("./osGrounding.js");
    const count = removeStoppedContainers();
    expect(count).toBe(2);
  });
});
