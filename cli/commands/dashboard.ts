/**
 * cli/commands/dashboard.ts — v2.0.0
 * `andromeda dashboard` — live Ink terminal dashboard showing RSI state,
 * health metrics, recent cycles, and log stream in real time.
 */
import { Command } from "commander";
import React, { useState, useEffect, useCallback } from "react";
import { render, Box, Text, useInput, useApp, Newline } from "ink";
import Spinner from "ink-spinner";
import chalk from "chalk";

// ── Types ─────────────────────────────────────────────────────────────────────
interface RsiCycle {
  id: string;
  phase: string;
  proposalsGenerated: number;
  proposalsApplied: number;
  evalScoreBefore?: number;
  evalScoreAfter?: number;
  startedAt: number;
  completedAt?: number;
}

interface HealthData {
  status: string;
  uptime?: number;
  version?: string;
  rsi?: {
    enabled: boolean;
    phase: string;
    cycleCount: number;
    lastCycleAt?: number;
    costStats?: { totalSpentUsd: number; sessionSpentUsd: number };
  };
  memory?: { heapUsedMb: number; heapTotalMb: number };
}

interface DashboardState {
  health: HealthData | null;
  cycles: RsiCycle[];
  logs: string[];
  connected: boolean;
  loading: boolean;
  tab: "overview" | "cycles" | "logs";
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function scoreBar(score: number, width = 20): string {
  const filled = Math.round(score * width);
  const bar = "█".repeat(filled) + "░".repeat(width - filled);
  const pct = Math.round(score * 100);
  const color = score >= 0.8 ? "green" : score >= 0.5 ? "yellow" : "red";
  return chalk[color](bar) + chalk.dim(` ${pct}%`);
}

// ── Dashboard App ─────────────────────────────────────────────────────────────
const DashboardApp: React.FC<{ port: number }> = ({ port }) => {
  const { exit } = useApp();
  const [state, setState] = useState<DashboardState>({
    health: null,
    cycles: [],
    logs: [],
    connected: false,
    loading: true,
    tab: "overview",
  });

  const fetchData = useCallback(async () => {
    try {
      const [healthRes, cyclesRes] = await Promise.allSettled([
        fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(2000) }),
        fetch(`http://localhost:${port}/api/rsi/cycles?limit=8`, { signal: AbortSignal.timeout(2000) }),
      ]);

      const health = healthRes.status === "fulfilled" && healthRes.value.ok
        ? (await healthRes.value.json()) as HealthData
        : null;

      const cycles = cyclesRes.status === "fulfilled" && cyclesRes.value.ok
        ? ((await cyclesRes.value.json()) as { cycles?: RsiCycle[] }).cycles ?? []
        : [];

      setState(prev => ({
        ...prev,
        health,
        cycles,
        connected: !!health,
        loading: false,
      }));
    } catch {
      setState(prev => ({ ...prev, connected: false, loading: false }));
    }
  }, [port]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 3000);
    return () => clearInterval(interval);
  }, [fetchData]);

  useInput((input, key) => {
    if (input === "q" || key.escape) exit();
    if (input === "1") setState(prev => ({ ...prev, tab: "overview" }));
    if (input === "2") setState(prev => ({ ...prev, tab: "cycles" }));
    if (input === "3") setState(prev => ({ ...prev, tab: "logs" }));
  });

  const { health, cycles, connected, loading, tab } = state;

  return (
    React.createElement(Box, { flexDirection: "column", padding: 1 },
      // Header
      React.createElement(Box, { marginBottom: 1 },
        React.createElement(Text, { bold: true, color: "magenta" }, "⬡ ANDROMEDA "),
        React.createElement(Text, { color: "cyan" }, `v${health?.version ?? "..."} `),
        connected
          ? React.createElement(Text, { color: "green" }, "● ONLINE")
          : loading
          ? React.createElement(Box, null,
              React.createElement(Spinner, { type: "dots" }),
              React.createElement(Text, { color: "yellow" }, " Connecting…")
            )
          : React.createElement(Text, { color: "red" }, "● OFFLINE"),
        React.createElement(Text, { dimColor: true }, "  [1] Overview  [2] Cycles  [3] Logs  [q] Quit")
      ),

      // Tab: Overview
      tab === "overview" && React.createElement(Box, { flexDirection: "column" },
        React.createElement(Box, { marginBottom: 1 },
          React.createElement(Text, { bold: true, color: "cyan" }, "── System Health "),
        ),
        health ? React.createElement(Box, { flexDirection: "column" },
          React.createElement(Text, null,
            React.createElement(Text, { dimColor: true }, "  Uptime:     "),
            React.createElement(Text, { color: "cyan" }, health.uptime ? formatUptime(health.uptime) : "—")
          ),
          React.createElement(Text, null,
            React.createElement(Text, { dimColor: true }, "  Heap:       "),
            React.createElement(Text, { color: "cyan" },
              health.memory ? `${health.memory.heapUsedMb.toFixed(1)} / ${health.memory.heapTotalMb.toFixed(1)} MB` : "—"
            )
          ),
          React.createElement(Newline),
          React.createElement(Text, { bold: true, color: "cyan" }, "── RSI Daemon "),
          React.createElement(Text, null,
            React.createElement(Text, { dimColor: true }, "  Status:     "),
            health.rsi?.enabled
              ? React.createElement(Text, { color: "green" }, `● Running (${health.rsi.phase})`)
              : React.createElement(Text, { color: "yellow" }, "● Paused")
          ),
          React.createElement(Text, null,
            React.createElement(Text, { dimColor: true }, "  Cycles:     "),
            React.createElement(Text, { color: "cyan" }, String(health.rsi?.cycleCount ?? 0))
          ),
          React.createElement(Text, null,
            React.createElement(Text, { dimColor: true }, "  Spent:      "),
            React.createElement(Text, { color: "cyan" },
              health.rsi?.costStats ? `$${health.rsi.costStats.sessionSpentUsd.toFixed(4)} session / $${health.rsi.costStats.totalSpentUsd.toFixed(2)} total` : "—"
            )
          ),
        ) : React.createElement(Text, { color: "red" }, "  No data — is Andromeda running?")
      ),

      // Tab: Cycles
      tab === "cycles" && React.createElement(Box, { flexDirection: "column" },
        React.createElement(Text, { bold: true, color: "cyan" }, "── Recent RSI Cycles "),
        React.createElement(Newline),
        cycles.length === 0
          ? React.createElement(Text, { dimColor: true }, "  No cycles yet.")
          : cycles.slice(0, 8).map((c, i) =>
              React.createElement(Box, { key: c.id, marginBottom: 0 },
                React.createElement(Text, { dimColor: true }, `  ${i + 1}. `),
                React.createElement(Text, { color: c.completedAt ? "green" : "yellow" },
                  c.completedAt ? "✓" : "…"
                ),
                React.createElement(Text, null, ` ${c.phase.padEnd(20)} `),
                React.createElement(Text, { color: "cyan" }, `+${c.proposalsApplied}/${c.proposalsGenerated} applied`),
                c.evalScoreAfter !== undefined && React.createElement(Text, { dimColor: true },
                  `  score: ${c.evalScoreAfter.toFixed(3)}`
                )
              )
            )
      ),

      // Tab: Logs
      tab === "logs" && React.createElement(Box, { flexDirection: "column" },
        React.createElement(Text, { bold: true, color: "cyan" }, "── Live Logs "),
        React.createElement(Text, { dimColor: true }, "  (streaming from /api/logs)"),
        React.createElement(Newline),
        state.logs.slice(-15).map((line, i) =>
          React.createElement(Text, { key: i, dimColor: true }, `  ${line}`)
        )
      ),

      // Footer
      React.createElement(Box, { marginTop: 1 },
        React.createElement(Text, { dimColor: true }, `  Port: ${port}  ·  Refresh: 3s  ·  `)
      )
    )
  );
};

// ── Command ───────────────────────────────────────────────────────────────────
export function dashboardCommand(): Command {
  const cmd = new Command("dashboard");
  cmd
    .alias("dash")
    .description("Open the live terminal dashboard")
    .option("-p, --port <port>", "Port to connect to", "3000")
    .action((opts) => {
      const port = parseInt(opts.port, 10);
      const { unmount } = render(
        React.createElement(DashboardApp, { port })
      );
      process.on("SIGINT", () => { unmount(); process.exit(0); });
    });

  return cmd;
}
