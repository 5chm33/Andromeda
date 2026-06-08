/**
 * RsiDashboard.tsx — v9.10.0
 *
 * Andromeda RSI Dashboard — real-time monitoring of the recursive self-improvement engine.
 * Shows:
 *   - RSI engine status + trigger controls
 *   - Proposal review panel (diff viewer + approve/reject)
 *   - Eval score trend chart
 *   - Capability growth chart
 *   - RSI cycle history table
 *   - Git commit log feed (live autonomous commits)
 *   - Vector memory stats (neural vs TF-IDF)
 *   - Model routing info (which LLM analyzed what)
 */
import { useEffect, useState } from "react";
import { ProposalReviewPanel } from "@/components/rsi/ProposalReviewPanel";
import { EvalTrendChart } from "@/components/rsi/EvalTrendChart";
import { CapabilityGrowthChart } from "@/components/rsi/CapabilityGrowthChart";
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

interface GitCommit {
  hash: string;
  subject: string;
  author: string;
  date: string;
}

interface VectorStats {
  entryCount: number;
  dimension: number;
  model: string;
  sizeBytes: number;
}

interface MemoryStats {
  total: number;
  byType: Record<string, number>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTs(ts: number): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function formatDuration(start: number, end?: number): string {
  if (!end) return "running…";
  const s = Math.round((end - start) / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function phaseBadgeColor(phase: string): string {
  if (phase === "idle") return "bg-slate-700 text-slate-300";
  if (phase === "error") return "bg-red-900/60 text-red-300";
  if (phase === "complete" || phase === "applied") return "bg-emerald-900/60 text-emerald-300";
  if (phase === "analyzing" || phase === "generating") return "bg-blue-900/60 text-blue-300";
  if (phase === "applying") return "bg-violet-900/60 text-violet-300";
  return "bg-slate-700 text-slate-300";
}

function deltaBadge(before?: number, after?: number): JSX.Element {
  if (before == null || after == null) return <span className="text-slate-400">—</span>;
  const delta = (after - before) * 100;
  if (delta > 0) return <span className="text-emerald-400">+{delta.toFixed(1)}%</span>;
  if (delta < 0) return <span className="text-red-400">{delta.toFixed(1)}%</span>;
  return <span className="text-slate-400">0%</span>;
}

function isRSICommit(subject: string): boolean {
  return /andromeda self-improvement|rsi|autonomous|self-improv/i.test(subject);
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
      } catch { /* non-fatal */ }
      finally { setLoading(false); }
    };
    load();
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center h-32 text-slate-400 text-sm">Loading cycle history…</div>
  );
  if (cycles.length === 0) return (
    <div className="flex items-center justify-center h-32 text-slate-500 text-sm">No RSI cycles recorded yet.</div>
  );

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
              <TableCell className="text-slate-300 text-xs font-mono">{formatTs(cycle.startedAt)}</TableCell>
              <TableCell className="text-slate-400 text-xs">{formatDuration(cycle.startedAt, cycle.completedAt)}</TableCell>
              <TableCell>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${phaseBadgeColor(cycle.phase)}`}>
                  {cycle.phase}
                </span>
              </TableCell>
              <TableCell className="text-slate-300 text-xs text-right">{cycle.proposalsGenerated ?? "—"}</TableCell>
              <TableCell className="text-slate-300 text-xs text-right">{cycle.proposalsApplied ?? "—"}</TableCell>
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

// ─── Git Commit Log Feed ──────────────────────────────────────────────────────

function GitCommitFeed() {
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch("/api/git/log?limit=30");
        if (r.ok) {
          const data = await r.json();
          setCommits(data.commits ?? []);
        }
      } catch { /* non-fatal */ }
      finally { setLoading(false); }
    };
    load();
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center h-32 text-slate-400 text-sm">Loading commit log…</div>
  );
  if (commits.length === 0) return (
    <div className="flex items-center justify-center h-32 text-slate-500 text-sm">No commits found.</div>
  );

  return (
    <div className="overflow-y-auto max-h-72 divide-y divide-slate-800">
      {commits.map((c) => (
        <div key={c.hash} className="flex items-start gap-3 px-4 py-2.5 hover:bg-slate-800/40 transition-colors">
          <div className="flex-shrink-0 mt-0.5">
            {isRSICommit(c.subject) ? (
              <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-violet-900/60 text-violet-300 text-[9px] font-bold">AI</span>
            ) : (
              <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-slate-700 text-slate-400 text-[9px] font-bold">GIT</span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className={`text-xs truncate ${isRSICommit(c.subject) ? "text-violet-200 font-medium" : "text-slate-300"}`}>
              {c.subject}
            </p>
            <p className="text-[10px] text-slate-500 mt-0.5 font-mono">
              {c.hash} · {c.date ? new Date(c.date).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Vector Memory Stats ──────────────────────────────────────────────────────

function VectorMemoryStats() {
  const [stats, setStats] = useState<{ vector: VectorStats | null; memory: MemoryStats | null; neuralActive: boolean } | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch("/api/memory/vector-stats");
        if (r.ok) setStats(await r.json());
      } catch { /* non-fatal */ }
    };
    load();
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, []);

  if (!stats) return (
    <div className="flex items-center justify-center h-20 text-slate-400 text-sm">Loading memory stats…</div>
  );

  const { vector, memory, neuralActive } = stats;

  return (
    <div className="px-4 py-3 space-y-3">
      {/* Neural vs TF-IDF indicator */}
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${neuralActive ? "bg-emerald-400" : "bg-amber-400"}`} />
        <span className="text-xs text-slate-300 font-medium">
          {neuralActive ? "Neural embeddings active" : "TF-IDF fallback active"}
        </span>
        {vector && (
          <span className="text-xs text-slate-500 font-mono ml-1">({vector.model})</span>
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-slate-800/60 rounded-lg p-3">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Vector Index</p>
          <p className="text-xl font-bold text-slate-100">{vector?.entryCount ?? 0}</p>
          <p className="text-[10px] text-slate-500">
            {vector ? `${vector.dimension}d · ${(vector.sizeBytes / 1024).toFixed(0)} KB` : "not initialized"}
          </p>
        </div>
        <div className="bg-slate-800/60 rounded-lg p-3">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Memory Store</p>
          <p className="text-xl font-bold text-slate-100">{memory?.total ?? 0}</p>
          <p className="text-[10px] text-slate-500">
            {memory ? Object.entries(memory.byType).map(([k, v]) => `${v} ${k}`).join(" · ") : "empty"}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── RSI Status Banner ────────────────────────────────────────────────────────

function RsiStatusBanner() {
  const [status, setStatus] = useState<RsiStatus | null>(null);
  const [health, setHealth] = useState<any>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [sr, hr] = await Promise.allSettled([
          fetch("/api/rsi/status").then(r => r.ok ? r.json() : null),
          fetch("/api/rsi/health").then(r => r.ok ? r.json() : null),
        ]);
        if (sr.status === "fulfilled" && sr.value) setStatus(sr.value);
        if (hr.status === "fulfilled" && hr.value) setHealth(hr.value);
      } catch { /* non-fatal */ }
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
    } catch { /* non-fatal */ }
  };

  const proposals = health?.proposals?.byStatus ?? {};
  const pending = proposals.pending ?? 0;
  const applied = proposals.applied ?? 0;
  const rejected = proposals.rejected ?? 0;

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3 rounded-lg bg-slate-800/60 border border-slate-700 mb-6">
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${
          status?.phase === "idle" ? "bg-slate-500" :
          status?.phase === "error" ? "bg-red-500" :
          "bg-emerald-400 animate-pulse"
        }`} />
        <span className="text-sm font-medium text-slate-200">RSI Engine</span>
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

      {/* Proposal summary pills */}
      {(pending + applied + rejected) > 0 && (
        <div className="flex items-center gap-1.5">
          {pending > 0 && <Badge variant="outline" className="text-[10px] border-amber-700 text-amber-300 px-1.5 py-0">{pending} pending</Badge>}
          {applied > 0 && <Badge variant="outline" className="text-[10px] border-emerald-700 text-emerald-300 px-1.5 py-0">{applied} applied</Badge>}
          {rejected > 0 && <Badge variant="outline" className="text-[10px] border-slate-600 text-slate-400 px-1.5 py-0">{rejected} rejected</Badge>}
        </div>
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
              Andromeda v9.10.0 — Real-time RSI monitoring, proposal review, neural memory, and autonomous commit feed
            </p>
          </div>
          <div className="ml-auto">
            <a href="/" className="text-xs text-slate-400 hover:text-slate-200 transition-colors">
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
          <Card className="bg-slate-900 border-slate-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-200">Eval Score Trend</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <EvalTrendChart />
            </CardContent>
          </Card>

          <Card className="bg-slate-900 border-slate-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-200">Pending Proposals</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ProposalReviewPanel />
            </CardContent>
          </Card>
        </div>

        {/* Second row: Git Commit Feed + Vector Memory Stats */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <Card className="bg-slate-900 border-slate-700">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-slate-200">Autonomous Commit Feed</CardTitle>
                <span className="text-[10px] text-slate-500 font-mono">
                  <span className="inline-flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-violet-400 inline-block" />
                    AI commits
                  </span>
                  <span className="mx-2 text-slate-700">|</span>
                  <span className="inline-flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-500 inline-block" />
                    manual
                  </span>
                </span>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <GitCommitFeed />
            </CardContent>
          </Card>

          <Card className="bg-slate-900 border-slate-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-200">Memory System</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <VectorMemoryStats />
            </CardContent>
          </Card>
        </div>

        {/* Capability Growth Chart */}
        <Card className="bg-slate-900 border-slate-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-200">Capability Growth by Category</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <CapabilityGrowthChart />
          </CardContent>
        </Card>

        {/* Cycle History Table */}
        <Card className="bg-slate-900 border-slate-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-200">Cycle History</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <CycleHistoryTable />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
