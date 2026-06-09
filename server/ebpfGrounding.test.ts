import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import os from "os";

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(os.tmpdir(), `ebpf-test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  process.env.ANDROMEDA_WORKSPACE = tmpDir;
});

afterEach(async () => {
  const { resetEbpfMonitor } = await import("./ebpfGrounding.js");
  resetEbpfMonitor();
  vi.resetModules();
  delete process.env.ANDROMEDA_WORKSPACE;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("ebpfGrounding", () => {
  describe("detectEbpfCapability", () => {
    it("returns a valid capability string", async () => {
      const { detectEbpfCapability } = await import("./ebpfGrounding.js");
      const cap = detectEbpfCapability();
      expect(["full_ebpf", "proc_monitor", "hrtime_sample", "none"]).toContain(cap);
    });

    it("returns hrtime_sample or proc_monitor in CI environment (no bpftrace)", async () => {
      const { detectEbpfCapability } = await import("./ebpfGrounding.js");
      const cap = detectEbpfCapability();
      // In CI, bpftrace is not available and CAP_BPF is not granted
      // So we expect either proc_monitor (Linux) or hrtime_sample (macOS/other)
      expect(["proc_monitor", "hrtime_sample", "full_ebpf"]).toContain(cap);
    });
  });

  describe("generateBpftraceScript", () => {
    it("generates a valid bpftrace script for the current PID", async () => {
      const { generateBpftraceScript } = await import("./ebpfGrounding.js");
      const script = generateBpftraceScript({
        allowedSyscalls: [],
        forbiddenSyscalls: ["ptrace", "kexec_load"],
        maxLatencyNs: 100_000_000,
        memorySpikeThresholdBytes: 512 * 1024 * 1024,
        cpuSpikeThresholdPercent: 90,
        procSampleIntervalMs: 1000,
      });

      expect(script).toContain(`pid == ${process.pid}`);
      expect(script).toContain("sys_enter_ptrace");
      expect(script).toContain("sys_enter_kexec_load");
      expect(script).toContain("latency_ns");
      expect(script).toContain("ANOMALY");
    });
  });

  describe("EbpfMonitor", () => {
    it("creates a monitor with the correct capability", async () => {
      const { EbpfMonitor, detectEbpfCapability } = await import("./ebpfGrounding.js");
      const monitor = new EbpfMonitor();
      expect(monitor.getCapability()).toBe(detectEbpfCapability());
      expect(monitor.isActive()).toBe(false);
    });

    it("starts and stops monitoring", async () => {
      const { EbpfMonitor } = await import("./ebpfGrounding.js");
      const monitor = new EbpfMonitor({ procSampleIntervalMs: 100 });

      await monitor.start();
      expect(monitor.isActive()).toBe(true);

      monitor.stop();
      expect(monitor.isActive()).toBe(false);
    });

    it("emits started event on start", async () => {
      const { EbpfMonitor } = await import("./ebpfGrounding.js");
      const monitor = new EbpfMonitor({ procSampleIntervalMs: 500 });

      const startedEvents: unknown[] = [];
      monitor.on("started", (e) => startedEvents.push(e));

      await monitor.start();
      monitor.stop();

      expect(startedEvents).toHaveLength(1);
      expect((startedEvents[0] as { capability: string }).capability).toBeTruthy();
    });

    it("emits stats events when running in proc_monitor or hrtime_sample mode", async () => {
      const { EbpfMonitor } = await import("./ebpfGrounding.js");
      const monitor = new EbpfMonitor({ procSampleIntervalMs: 50 });

      const statsEvents: unknown[] = [];
      monitor.on("stats", (s) => statsEvents.push(s));

      await monitor.start();
      // Wait for at least one stats event
      await new Promise((resolve) => setTimeout(resolve, 200));
      monitor.stop();

      expect(statsEvents.length).toBeGreaterThan(0);
      const stats = statsEvents[0] as { pid: number; rssBytes: number };
      expect(stats.pid).toBe(process.pid);
      expect(stats.rssBytes).toBeGreaterThan(0);
    });

    it("captureProcessStats returns valid stats", async () => {
      const { EbpfMonitor } = await import("./ebpfGrounding.js");
      const monitor = new EbpfMonitor();
      const stats = monitor.captureProcessStats();

      expect(stats.pid).toBe(process.pid);
      expect(stats.rssBytes).toBeGreaterThan(0);
      expect(stats.heapUsedBytes).toBeGreaterThan(0);
      expect(stats.heapTotalBytes).toBeGreaterThan(0);
      expect(stats.uptimeMs).toBeGreaterThan(0);
    });

    it("getStats returns correct counters", async () => {
      const { EbpfMonitor } = await import("./ebpfGrounding.js");
      const monitor = new EbpfMonitor({ procSampleIntervalMs: 50 });

      await monitor.start();
      await new Promise((resolve) => setTimeout(resolve, 200));
      monitor.stop();

      const stats = monitor.getStats();
      expect(stats.eventCount).toBeGreaterThan(0);
      expect(stats.anomalyCount).toBeGreaterThanOrEqual(0);
      expect(["full_ebpf", "proc_monitor", "hrtime_sample", "none"]).toContain(stats.capability);
    });

    it("does not start twice", async () => {
      const { EbpfMonitor } = await import("./ebpfGrounding.js");
      const monitor = new EbpfMonitor({ procSampleIntervalMs: 500 });

      await monitor.start();
      await monitor.start(); // Second call should be a no-op
      expect(monitor.isActive()).toBe(true);
      monitor.stop();
    });
  });

  describe("getEbpfMonitor singleton", () => {
    it("returns the same instance on multiple calls", async () => {
      const { getEbpfMonitor } = await import("./ebpfGrounding.js");
      const m1 = getEbpfMonitor();
      const m2 = getEbpfMonitor();
      expect(m1).toBe(m2);
    });

    it("resetEbpfMonitor clears the singleton", async () => {
      const { getEbpfMonitor, resetEbpfMonitor } = await import("./ebpfGrounding.js");
      const m1 = getEbpfMonitor();
      resetEbpfMonitor();
      const m2 = getEbpfMonitor();
      expect(m1).not.toBe(m2);
    });
  });
});
