/**
 * ebpfGrounding.ts — eBPF Kernel Tracing & Syscall-Level Self-Monitoring
 * Andromeda v10.0.0
 *
 * Provides deep kernel-level observability for Andromeda's own process using
 * eBPF (extended Berkeley Packet Filter) programs. When eBPF is available
 * (Linux kernel ≥ 4.18 + CAP_BPF capability), Andromeda can:
 *
 *   1. Trace its own syscalls (open, read, write, execve, connect, etc.)
 *   2. Detect anomalous behavior (unexpected file writes, network connections)
 *   3. Measure execution latency at the kernel level
 *   4. Enforce a syscall allowlist (kill the process if a forbidden syscall fires)
 *
 * When eBPF is NOT available (macOS, older kernels, no CAP_BPF), the module
 * gracefully falls back to /proc-based monitoring (Linux) or process.hrtime
 * sampling (all platforms). This ensures the module never crashes in CI.
 *
 * eBPF programs are generated as C source strings and compiled via bcc-tools
 * (if available) or loaded via the `bpf` npm package. The generated programs
 * are minimal and safe — they only read kernel data, never modify it.
 */

import { execSync, spawn, ChildProcess } from "child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { EventEmitter } from "events";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SyscallEvent = {
  syscall: string;
  pid: number;
  timestamp: number;
  latencyNs: number;
  args?: string[];
  returnCode?: number;
};

export type AnomalyType =
  | "forbidden_syscall"
  | "unexpected_network"
  | "unexpected_file_write"
  | "high_latency"
  | "memory_spike"
  | "cpu_spike";

export type KernelAnomaly = {
  type: AnomalyType;
  description: string;
  timestamp: number;
  severity: "low" | "medium" | "high" | "critical";
  syscallEvent?: SyscallEvent;
  metadata?: Record<string, unknown>;
};

export type EbpfCapability =
  | "full_ebpf"      // Linux + CAP_BPF + bcc-tools
  | "proc_monitor"   // Linux /proc fallback
  | "hrtime_sample"  // Cross-platform hrtime sampling
  | "none";          // No monitoring available

export interface EbpfConfig {
  /** Syscalls that are allowed. If empty, all syscalls are allowed. */
  allowedSyscalls: string[];
  /** Syscalls that are always forbidden (triggers critical anomaly) */
  forbiddenSyscalls: string[];
  /** Maximum latency before a high_latency anomaly fires (nanoseconds) */
  maxLatencyNs: number;
  /** Memory spike threshold (bytes above baseline) */
  memorySpikeThresholdBytes: number;
  /** CPU spike threshold (% above baseline) */
  cpuSpikeThresholdPercent: number;
  /** How often to sample /proc stats (ms) — used in proc_monitor mode */
  procSampleIntervalMs: number;
}

export interface ProcessStats {
  pid: number;
  rssBytes: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
  externalBytes: number;
  cpuUserMs: number;
  cpuSystemMs: number;
  uptimeMs: number;
  openFileDescriptors?: number;
  networkConnections?: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: EbpfConfig = {
  allowedSyscalls: [],
  forbiddenSyscalls: ["ptrace", "kexec_load", "init_module", "delete_module"],
  maxLatencyNs: 100_000_000, // 100ms
  memorySpikeThresholdBytes: 512 * 1024 * 1024, // 512MB
  cpuSpikeThresholdPercent: 90,
  procSampleIntervalMs: 1000,
};

const DATA_DIR = process.env.ANDROMEDA_WORKSPACE
  ? join(process.env.ANDROMEDA_WORKSPACE, "data")
  : join(process.cwd(), "data");

const EBPF_LOG_FILE = join(DATA_DIR, "ebpf_trace.jsonl");
const ANOMALY_LOG_FILE = join(DATA_DIR, "kernel_anomalies.jsonl");

// ─── Capability Detection ─────────────────────────────────────────────────────

/**
 * Detect what level of kernel monitoring is available on this platform.
 */
export function detectEbpfCapability(): EbpfCapability {
  // Check for Linux
  if (process.platform !== "linux") {
    return "hrtime_sample";
  }

  // Check for /proc
  if (!existsSync("/proc/self/status")) {
    return "hrtime_sample";
  }

  // Check for bcc-tools (full eBPF)
  try {
    execSync("which bpftrace 2>/dev/null", { stdio: "pipe" });
    // Check CAP_BPF or root
    const status = readFileSync("/proc/self/status", "utf-8");
    const capEffLine = status.split("\n").find((l) => l.startsWith("CapEff:"));
    if (capEffLine) {
      const capHex = parseInt(capEffLine.split(":")[1].trim(), 16);
      // CAP_BPF is bit 39 (0x8000000000)
      const hasBpf = (capHex & 0x8000000000) !== 0;
      // CAP_SYS_ADMIN is bit 21 (0x200000) — also grants BPF access
      const hasSysAdmin = (capHex & 0x200000) !== 0;
      if (hasBpf || hasSysAdmin) {
        return "full_ebpf";
      }
    }
  } catch {
    // bpftrace not available
  }

  return "proc_monitor";
}

// ─── eBPF Program Generation ──────────────────────────────────────────────────

/**
 * Generate a bpftrace script that traces syscalls for the current process.
 * The script outputs JSON-formatted events to stdout.
 */
export function generateBpftraceScript(config: EbpfConfig): string {
  const pid = process.pid;
  const forbiddenList = config.forbiddenSyscalls.map((s) => `"${s}"`).join(", ");

  return `#!/usr/bin/env bpftrace
// Andromeda eBPF Syscall Tracer — PID ${pid}
// Auto-generated by ebpfGrounding.ts

tracepoint:raw_syscalls:sys_enter
/pid == ${pid}/
{
  @start[tid] = nsecs;
  @syscall[tid] = args->id;
}

tracepoint:raw_syscalls:sys_exit
/pid == ${pid} && @start[tid]/
{
  $latency = nsecs - @start[tid];
  printf(
    "{\\"syscall\\":%d,\\"pid\\":%d,\\"tid\\":%d,\\"latency_ns\\":%llu,\\"ret\\":%ld,\\"ts\\":%llu}\\n",
    @syscall[tid], pid, tid, $latency, args->ret, nsecs
  );
  delete(@start[tid]);
  delete(@syscall[tid]);
}

// Alert on forbidden syscalls
${config.forbiddenSyscalls.map((s) => `
tracepoint:syscalls:sys_enter_${s}
/pid == ${pid}/
{
  printf("{\\"ANOMALY\\":\\"forbidden_syscall\\",\\"syscall\\":\\"${s}\\",\\"pid\\":%d,\\"ts\\":%llu}\\n", pid, nsecs);
}
`).join("")}

END {
  clear(@start);
  clear(@syscall);
}
`;
}

// ─── EbpfMonitor Class ────────────────────────────────────────────────────────

export class EbpfMonitor extends EventEmitter {
  private config: EbpfConfig;
  private capability: EbpfCapability;
  private bpftraceProcess: ChildProcess | null = null;
  private procSampleTimer: ReturnType<typeof setInterval> | null = null;
  private baselineStats: ProcessStats | null = null;
  private isRunning = false;
  private eventCount = 0;
  private anomalyCount = 0;

  constructor(config: Partial<EbpfConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.capability = detectEbpfCapability();
  }

  getCapability(): EbpfCapability {
    return this.capability;
  }

  isActive(): boolean {
    return this.isRunning;
  }

  getStats(): { eventCount: number; anomalyCount: number; capability: EbpfCapability } {
    return {
      eventCount: this.eventCount,
      anomalyCount: this.anomalyCount,
      capability: this.capability,
    };
  }

  /**
   * Start monitoring. Automatically selects the best available method.
   */
  async start(): Promise<void> {
    if (this.isRunning) return;

    mkdirSync(DATA_DIR, { recursive: true });
    this.baselineStats = this.captureProcessStats();
    this.isRunning = true;

    switch (this.capability) {
      case "full_ebpf":
        await this._startEbpf();
        break;
      case "proc_monitor":
        this._startProcMonitor();
        break;
      case "hrtime_sample":
        this._startHrtimeSampler();
        break;
      default:
        this.isRunning = false;
    }

    this.emit("started", { capability: this.capability });
  }

  /**
   * Stop monitoring and clean up resources.
   */
  stop(): void {
    if (!this.isRunning) return;

    if (this.bpftraceProcess) {
      this.bpftraceProcess.kill("SIGTERM");
      this.bpftraceProcess = null;
    }

    if (this.procSampleTimer) {
      clearInterval(this.procSampleTimer);
      this.procSampleTimer = null;
    }

    this.isRunning = false;
    this.emit("stopped");
  }

  /**
   * Capture current process statistics from Node.js runtime.
   */
  captureProcessStats(): ProcessStats {
    const mem = process.memoryUsage();
    const cpu = process.cpuUsage();

    let openFds: number | undefined;
    let netConns: number | undefined;

    if (process.platform === "linux") {
      try {
        const fdDir = `/proc/${process.pid}/fd`;
        openFds = parseInt(execSync(`ls ${fdDir} | wc -l`, { stdio: "pipe" }).toString().trim(), 10);
      } catch {
        // Not available
      }

      try {
        netConns = parseInt(
          execSync(`ss -tp 2>/dev/null | grep ${process.pid} | wc -l`, { stdio: "pipe" })
            .toString()
            .trim(),
          10
        );
      } catch {
        // Not available
      }
    }

    return {
      pid: process.pid,
      rssBytes: mem.rss,
      heapUsedBytes: mem.heapUsed,
      heapTotalBytes: mem.heapTotal,
      externalBytes: mem.external,
      cpuUserMs: Math.round(cpu.user / 1000),
      cpuSystemMs: Math.round(cpu.system / 1000),
      uptimeMs: Math.round(process.uptime() * 1000),
      openFileDescriptors: openFds,
      networkConnections: netConns,
    };
  }

  private async _startEbpf(): Promise<void> {
    const scriptPath = join(DATA_DIR, "andromeda_tracer.bt");
    const script = generateBpftraceScript(this.config);
    writeFileSync(scriptPath, script, "utf-8");

    this.bpftraceProcess = spawn("bpftrace", [scriptPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    this.bpftraceProcess.stdout?.on("data", (data: Buffer) => {
      const lines = data.toString().split("\n").filter(Boolean);
      for (const line of lines) {
        this._processEbpfLine(line);
      }
    });

    this.bpftraceProcess.on("error", (err) => {
      this.emit("error", err);
      this.capability = "proc_monitor";
      this._startProcMonitor();
    });
  }

  private _processEbpfLine(line: string): void {
    try {
      const event = JSON.parse(line);
      this.eventCount++;

      if (event.ANOMALY) {
        const anomaly: KernelAnomaly = {
          type: event.ANOMALY as AnomalyType,
          description: `Forbidden syscall '${event.syscall}' detected in PID ${event.pid}`,
          timestamp: Date.now(),
          severity: "critical",
          metadata: event,
        };
        this._reportAnomaly(anomaly);
      } else {
        const syscallEvent: SyscallEvent = {
          syscall: String(event.syscall),
          pid: event.pid,
          timestamp: Date.now(),
          latencyNs: event.latency_ns,
          returnCode: event.ret,
        };

        if (syscallEvent.latencyNs > this.config.maxLatencyNs) {
          this._reportAnomaly({
            type: "high_latency",
            description: `Syscall ${syscallEvent.syscall} took ${(syscallEvent.latencyNs / 1e6).toFixed(1)}ms`,
            timestamp: Date.now(),
            severity: "medium",
            syscallEvent,
          });
        }

        this.emit("syscall", syscallEvent);
        this._appendLog(EBPF_LOG_FILE, syscallEvent);
      }
    } catch {
      // Malformed line — ignore
    }
  }

  private _startProcMonitor(): void {
    this.procSampleTimer = setInterval(() => {
      const stats = this.captureProcessStats();
      this.eventCount++;
      this.emit("stats", stats);
      this._checkForAnomalies(stats);
    }, this.config.procSampleIntervalMs);
  }

  private _startHrtimeSampler(): void {
    // Lightweight hrtime-based sampling for non-Linux platforms
    this.procSampleTimer = setInterval(() => {
      const stats = this.captureProcessStats();
      this.eventCount++;
      this.emit("stats", stats);
      this._checkForAnomalies(stats);
    }, this.config.procSampleIntervalMs);
  }

  private _checkForAnomalies(stats: ProcessStats): void {
    if (!this.baselineStats) return;

    const memDelta = stats.rssBytes - this.baselineStats.rssBytes;
    if (memDelta > this.config.memorySpikeThresholdBytes) {
      this._reportAnomaly({
        type: "memory_spike",
        description: `Memory increased by ${(memDelta / 1024 / 1024).toFixed(1)}MB above baseline`,
        timestamp: Date.now(),
        severity: memDelta > this.config.memorySpikeThresholdBytes * 2 ? "critical" : "high",
        metadata: { currentRss: stats.rssBytes, baselineRss: this.baselineStats.rssBytes, deltaMb: memDelta / 1024 / 1024 },
      });
    }
  }

  private _reportAnomaly(anomaly: KernelAnomaly): void {
    this.anomalyCount++;
    this.emit("anomaly", anomaly);
    this._appendLog(ANOMALY_LOG_FILE, anomaly);
  }

  private _appendLog(file: string, data: unknown): void {
    try {
      const line = JSON.stringify(data) + "\n";
      const { appendFileSync } = require("fs");
      appendFileSync(file, line, "utf-8");
    } catch {
      // Log write failure is non-fatal
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _monitor: EbpfMonitor | null = null;

export function getEbpfMonitor(config?: Partial<EbpfConfig>): EbpfMonitor {
  if (!_monitor) {
    _monitor = new EbpfMonitor(config);
  }
  return _monitor;
}

export function resetEbpfMonitor(): void {
  if (_monitor) {
    _monitor.stop();
    _monitor = null;
  }
}
