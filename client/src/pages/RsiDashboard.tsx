/**
 * RsiDashboard.tsx — v6.33
 *
 * Dedicated RSI Dashboard page at /rsi.
 * Embeds:
 *   - ProposalReviewPanel (diff viewer + approve/reject)
 *   - EvalTrendChart (score deltas over time)
 *   - RSI Cycle History table
 *   - Scheduler status + controls
 */

import { useEffect, useState } from "react";
import { ProposalReviewPanel } from "@/components/rsi/ProposalReviewPanel";
import { EvalTrendChart } from "@/components/rsi/EvalTrendChart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RsiCycle {
  id: string;
  startedAt: number;
  completedAt?: number;
  phase: string;
  proposalsGenerated: number;
  proposalsApplied: number;
  evalScoreBefore?: number;
  evalScoreAfter?: number;
  error?: string;
}

interface RsiStatus {
  phase: string;
  enabled: boolean;
  cycleCount: number;
  lastCycleAt?: number;
  nextCycleAt?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTs(ts?: number): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

function formatDuration(start: number, end?: number): string {
  if (!end) return "running…";
  const ms = end - start;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function phaseBadgeColor(phase: string): string {
  if (phase === "idle") return "bg-slate-700 text-slate-300";
  if (phase === "generating") return "bg-blue-700 text-blue-100";
  if (phase === "applying") return "bg-amber-700 text-amber-100";
  if (phase === "evaluating") return "bg-purple-700 text-purple-100";
  if (phase === "complete") return "bg-emerald-700 text-emerald-100";
  if (phase === "error") return "bg-red-700 text-red-100";
  return "bg-slate-700 text-slate-300";
}

function deltaBadge(before?: number, after?: number): React.ReactNode {
  if (before == null || after == null) return <span className="text-slate-500">—</span>;
  const delta = after - before;
  const pct = (delta * 100).toFixed(1);
  if (delta > 0) return <span className="text-emerald-400">+{pct}%</span>;
  if (delta < 0) return <span className="text-red-400">{pct}%</span>;
  return <span className="text-slate-400">0%</span>;
}

// ─── Cycle History Table ──────────────────────────────────────────────────────

function CycleHistoryTable() {
  const [cycles, setCycles] = useState<RsiCycle[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch("/api/rsi/history");
        if (r.ok) {
          const data = await r.json();
          setCycles(Array.isArray(data) ? data : data.cycles ?? []);
        }
      } catch {
        // non-fatal
      } finally {
        setLoading(false);
      }
    };
    load();
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32 text-slate-400 text-sm">
        Loading cycle history…
      </div>
    );
  }

  if (cycles.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-slate-500 text-sm">
        No RSI cycles recorded yet. Trigger a cycle to begin.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="border-slate-700">
            <TableHead className="text-slate-400 text-xs">Started</TableHead>
            <TableHead className="text-slate-400 text-xs">Duration</TableHead>
            <TableHead className="text-slate-400 text-xs">Phase</TableHead>
            <TableHead className="text-slate-400 text-xs text-right">Generated</TableHead>
            <TableHead className="text-slate-400 text-xs text-right">Applied</TableHead>
            <TableHead className="text-slate-400 text-xs text-right">Score Before</TableHead>
            <TableHead className="text-slate-400 text-xs text-right">Score After</TableHead>
            <TableHead className="text-slate-400 text-xs text-right">Delta</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {cycles.slice().reverse().slice(0, 50).map((cycle) => (
            <TableRow key={cycle.id} className="border-slate-800 hover:bg-slate-800/40">
              <TableCell className="text-slate-300 text-xs font-mono">
                {formatTs(cycle.startedAt)}
              </TableCell>
              <TableCell className="text-slate-400 text-xs">
                {formatDuration(cycle.startedAt, cycle.completedAt)}
              </TableCell>
              <TableCell>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${phaseBadgeColor(cycle.phase)}`}>
                  {cycle.phase}
                </span>
              </TableCell>
              <TableCell className="text-slate-300 text-xs text-right">
                {cycle.proposalsGenerated ?? "—"}
              </TableCell>
              <TableCell className="text-slate-300 text-xs text-right">
                {cycle.proposalsApplied ?? "—"}
              </TableCell>
              <TableCell className="text-slate-400 text-xs text-right font-mono">
                {cycle.evalScoreBefore != null ? `${(cycle.evalScoreBefore * 100).toFixed(1)}%` : "—"}
              </TableCell>
              <TableCell className="text-slate-400 text-xs text-right font-mono">
                {cycle.evalScoreAfter != null ? `${(cycle.evalScoreAfter * 100).toFixed(1)}%` : "—"}
              </TableCell>
              <TableCell className="text-xs text-right font-mono">
                {deltaBadge(cycle.evalScoreBefore, cycle.evalScoreAfter)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ─── RSI Status Banner ────────────────────────────────────────────────────────

function RsiStatusBanner() {
  const [status, setStatus] = useState<RsiStatus | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch("/api/rsi/status");
        if (r.ok) setStatus(await r.json());
      } catch {
        // non-fatal
      }
    };
    load();
    const interval = setInterval(load, 15_000);
    return () => clearInterval(interval);
  }, []);

  const handleTrigger = async () => {
    try {
      await fetch("/api/rsi/trigger", { method: "POST" });
      setTimeout(async () => {
        const r = await fetch("/api/rsi/status");
        if (r.ok) setStatus(await r.json());
      }, 1000);
    } catch {
      // non-fatal
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3 rounded-lg bg-slate-800/60 border border-slate-700 mb-6">
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${
          status?.phase === "idle" ? "bg-slate-500" :
          status?.phase === "error" ? "bg-red-500" :
          "bg-emerald-400 animate-pulse"
        }`} />
        <span className="text-sm font-medium text-slate-200">
          RSI Engine
        </span>
        {status && (
          <span className={`text-xs px-2 py-0.5 rounded-full ${phaseBadgeColor(status.phase)}`}>
            {status.phase}
          </span>
        )}
      </div>

      {status && (
        <>
          <div className="text-xs text-slate-400">
            <span className="text-slate-300 font-medium">{status.cycleCount}</span> cycles
          </div>
          {status.lastCycleAt && (
            <div className="text-xs text-slate-400">
              Last: <span className="text-slate-300">{formatTs(status.lastCycleAt)}</span>
            </div>
          )}
          {status.nextCycleAt && (
            <div className="text-xs text-slate-400">
              Next: <span className="text-slate-300">{formatTs(status.nextCycleAt)}</span>
            </div>
          )}
        </>
      )}

      <div className="ml-auto">
        <Button
          size="sm"
          variant="outline"
          onClick={handleTrigger}
          className="text-xs border-slate-600 text-slate-300 hover:bg-slate-700"
        >
          Trigger Now
        </Button>
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function RsiDashboard() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Header */}
      <div className="border-b border-slate-800 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center text-white text-sm font-bold">
            RSI
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-100">
              Recursive Self-Improvement Dashboard
            </h1>
            <p className="text-xs text-slate-400">
              Andromeda v6.33 — Real-time RSI monitoring, proposal review, and performance tracking
            </p>
          </div>
          <div className="ml-auto">
            <a
              href="/"
              className="text-xs text-slate-400 hover:text-slate-200 transition-colors"
            >
              ← Back to Home
            </a>
          </div>
        </div>
      </div>

      <div className="px-6 py-6 space-y-6 max-w-screen-2xl mx-auto">
        {/* Status Banner */}
        <RsiStatusBanner />

        {/* Top row: Eval Chart + Proposal Review */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Eval Trend Chart */}
          <Card className="bg-slate-900 border-slate-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-200">
                Eval Score Trend
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <EvalTrendChart />
            </CardContent>
          </Card>

          {/* Proposal Review */}
          <Card className="bg-slate-900 border-slate-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-200">
                Pending Proposals
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ProposalReviewPanel />
            </CardContent>
          </Card>
        </div>

        {/* Cycle History Table */}
        <Card className="bg-slate-900 border-slate-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-200">
              Cycle History
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <CycleHistoryTable />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
