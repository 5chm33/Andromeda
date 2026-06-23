/**
 * ProposalReviewPanel.tsx — v7.2.0
 *
 * Phase 6 upgrade: side-by-side diff view, confidence meter bar,
 * improved proposal cards, ambient RSI status integration.
 */

import { useState, useEffect, useCallback } from "react";
import {
  CheckCircle,
  XCircle,
  RefreshCw,
  Clock,
  Zap,
  Pause,
  Play,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  FileCode,
  SplitSquareHorizontal,
  AlignLeft,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Proposal {
  id: string;
  title: string;
  description: string;
  targetFile: string;
  diff?: string;
  confidence: number | null;
  status: "pending" | "applied" | "rejected" | "failed";
  createdAt: number;
  secondaryChanges?: Array<{ file: string; diff: string }>;
}

interface SchedulerStatus {
  taskId: string | null;
  status: string;
  intervalHours: number;
  nextRunAt: string | null;
  runCount: number;
  lastLog: { triggeredAt: number; cycleStarted: boolean; note?: string } | null;
}

// ─── Confidence meter ─────────────────────────────────────────────────────────

function ConfidenceMeter({ value }: { value: number | null }) {
  if (value === null) return (
    <span className="text-[10px] text-zinc-600 italic">No score</span>
  );
  const pct = Math.round(value * 100);
  const color =
    pct >= 90 ? "bg-emerald-500" :
    pct >= 70 ? "bg-amber-500" :
    pct >= 50 ? "bg-orange-500" :
                "bg-red-500";
  const textColor =
    pct >= 90 ? "text-emerald-400" :
    pct >= 70 ? "text-amber-400" :
    pct >= 50 ? "text-orange-400" :
                "text-red-400";
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden" style={{ minWidth: 60 }}>
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`text-[11px] font-semibold tabular-nums ${textColor}`}>{pct}%</span>
    </div>
  );
}

// ─── Diff renderer (unified) ──────────────────────────────────────────────────

function UnifiedDiff({ diff }: { diff: string }) {
  const lines = diff.split("\n");
  return (
    <pre className="text-xs font-mono overflow-x-auto rounded-lg bg-zinc-950 p-3 max-h-64 overflow-y-auto border border-zinc-800/80 leading-5">
      {lines.map((line, i) => {
        let cls = "text-zinc-500";
        let bg = "";
        if (line.startsWith("+") && !line.startsWith("+++")) { cls = "text-emerald-300"; bg = "bg-emerald-950/40"; }
        else if (line.startsWith("-") && !line.startsWith("---")) { cls = "text-red-300"; bg = "bg-red-950/40"; }
        else if (line.startsWith("@@")) cls = "text-sky-400";
        else if (line.startsWith("+++") || line.startsWith("---")) cls = "text-zinc-400";
        return (
          <div key={i} className={`${bg} px-1 rounded-sm`}>
            <span className={cls}>{line || " "}</span>
          </div>
        );
      })}
    </pre>
  );
}

// ─── Side-by-side diff renderer ───────────────────────────────────────────────

function SideBySideDiff({ diff }: { diff: string }) {
  const lines = diff.split("\n").filter(l => !l.startsWith("---") && !l.startsWith("+++") && !l.startsWith("@@") && l !== "\\ No newline at end of file");
  const removed = lines.filter(l => l.startsWith("-")).map(l => l.slice(1));
  const added = lines.filter(l => l.startsWith("+")).map(l => l.slice(1));
  const context = lines.filter(l => !l.startsWith("-") && !l.startsWith("+"));

  // Build paired view: show removed on left, added on right
  const maxRows = Math.max(removed.length, added.length, 1);
  const rows = Array.from({ length: maxRows }, (_, i) => ({
    left: removed[i] ?? null,
    right: added[i] ?? null,
  }));

  if (removed.length === 0 && added.length === 0) {
    return (
      <pre className="text-xs font-mono text-zinc-500 bg-zinc-950 p-3 rounded-lg border border-zinc-800/80 max-h-48 overflow-y-auto leading-5">
        {context.slice(0, 20).join("\n")}
      </pre>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-800/80 overflow-hidden text-xs font-mono">
      <div className="grid grid-cols-2 border-b border-zinc-800/80">
        <div className="px-3 py-1.5 bg-red-950/30 text-red-400 text-[10px] font-semibold border-r border-zinc-800/80">Before</div>
        <div className="px-3 py-1.5 bg-emerald-950/30 text-emerald-400 text-[10px] font-semibold">After</div>
      </div>
      <div className="max-h-56 overflow-y-auto">
        {rows.map((row, i) => (
          <div key={i} className="grid grid-cols-2 border-b border-zinc-900/60 last:border-0">
            <div className={`px-3 py-0.5 border-r border-zinc-800/60 leading-5 ${row.left !== null ? "bg-red-950/20 text-red-300" : "text-zinc-800"}`}>
              {row.left ?? ""}
            </div>
            <div className={`px-3 py-0.5 leading-5 ${row.right !== null ? "bg-emerald-950/20 text-emerald-300" : "text-zinc-800"}`}>
              {row.right ?? ""}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Single proposal card ─────────────────────────────────────────────────────

function ProposalCard({
  proposal,
  onApprove,
  onReject,
}: {
  proposal: Proposal;
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [diffMode, setDiffMode] = useState<"unified" | "split">("split");
  const [loading, setLoading] = useState<"approve" | "reject" | null>(null);

  const handleApprove = async () => { setLoading("approve"); await onApprove(proposal.id); setLoading(null); };
  const handleReject = async () => { setLoading("reject"); await onReject(proposal.id); setLoading(null); };

  const statusColor =
    proposal.status === "applied"  ? "text-emerald-400" :
    proposal.status === "rejected" ? "text-red-400" :
    proposal.status === "failed"   ? "text-orange-400" :
                                     "text-zinc-200";

  const statusDot =
    proposal.status === "applied"  ? "bg-emerald-500" :
    proposal.status === "rejected" ? "bg-red-500" :
    proposal.status === "failed"   ? "bg-orange-500" :
                                     "bg-violet-500 animate-pulse";

  const timeAgo = (ts: number) => {
    const diff = Date.now() - ts;
    if (diff < 60_000) return "just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
  };

  return (
    <Card className="bg-zinc-900/50 border-zinc-800/80 hover:border-zinc-700/80 transition-colors">
      <CardHeader className="pb-0 pt-3 px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0 space-y-1.5">
            {/* Title row */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDot}`} />
              <span className={`text-sm font-semibold leading-tight ${statusColor}`}>{proposal.title}</span>
              {proposal.status !== "pending" && (
                <Badge variant="outline" className="text-[10px] capitalize h-4 px-1.5">{proposal.status}</Badge>
              )}
            </div>
            {/* File + time row */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1">
                <FileCode className="w-3 h-3 text-zinc-600 shrink-0" />
                <span className="text-[11px] text-zinc-500 truncate max-w-[200px]">{proposal.targetFile}</span>
              </div>
              <span className="text-[10px] text-zinc-700">{timeAgo(proposal.createdAt)}</span>
            </div>
            {/* Confidence meter */}
            <div className="flex items-center gap-2 pr-6">
              <TrendingUp className="w-3 h-3 text-zinc-600 flex-shrink-0" />
              <ConfidenceMeter value={proposal.confidence} />
            </div>
          </div>
          <button
            onClick={() => setExpanded(v => !v)}
            className="text-zinc-600 hover:text-zinc-300 shrink-0 mt-0.5 p-1 rounded-lg hover:bg-zinc-800 transition-colors"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="px-4 pb-3 pt-3 space-y-3">
          {proposal.description && (
            <p className="text-xs text-zinc-400 leading-relaxed border-l-2 border-zinc-700 pl-3">{proposal.description}</p>
          )}

          {proposal.diff ? (
            <div className="space-y-2">
              {/* Diff mode toggle */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setDiffMode("split")}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] transition-colors ${diffMode === "split" ? "bg-zinc-700 text-zinc-200" : "text-zinc-600 hover:text-zinc-400"}`}
                >
                  <SplitSquareHorizontal className="w-3 h-3" />Side-by-side
                </button>
                <button
                  onClick={() => setDiffMode("unified")}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] transition-colors ${diffMode === "unified" ? "bg-zinc-700 text-zinc-200" : "text-zinc-600 hover:text-zinc-400"}`}
                >
                  <AlignLeft className="w-3 h-3" />Unified
                </button>
              </div>
              {diffMode === "split" ? (
                <SideBySideDiff diff={proposal.diff} />
              ) : (
                <UnifiedDiff diff={proposal.diff} />
              )}
            </div>
          ) : (
            <div className="text-xs text-zinc-600 italic px-3 py-2 rounded-lg bg-zinc-900/60 border border-zinc-800">
              No diff available — full file replacement
            </div>
          )}

          {proposal.secondaryChanges && proposal.secondaryChanges.length > 0 && (
            <div className="space-y-2">
              <div className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider">
                Secondary changes ({proposal.secondaryChanges.length} file{proposal.secondaryChanges.length > 1 ? "s" : ""})
              </div>
              {proposal.secondaryChanges.map((sc, i) => (
                <div key={i} className="space-y-1">
                  <div className="text-[11px] text-zinc-500 flex items-center gap-1">
                    <FileCode className="w-3 h-3" />{sc.file}
                  </div>
                  <UnifiedDiff diff={sc.diff} />
                </div>
              ))}
            </div>
          )}

          {proposal.status === "pending" && (
            <div className="flex gap-2 pt-1">
              <button
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-all disabled:opacity-40"
                onClick={handleApprove}
                disabled={loading !== null}
              >
                {loading === "approve" ? <RefreshCw className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
                Approve & Apply
              </button>
              <button
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-red-950/60 border border-zinc-700 hover:border-red-800 text-zinc-400 hover:text-red-400 text-xs font-medium transition-all disabled:opacity-40"
                onClick={handleReject}
                disabled={loading !== null}
              >
                {loading === "reject" ? <RefreshCw className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
                Reject
              </button>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// ─── Scheduler status bar ─────────────────────────────────────────────────────

function SchedulerBar({ status, onTrigger, onPause, onResume }: {
  status: SchedulerStatus | null;
  onTrigger: () => Promise<void>;
  onPause: () => Promise<void>;
  onResume: () => Promise<void>;
}) {
  const [loading, setLoading] = useState<string | null>(null);
  const wrap = (fn: () => Promise<void>, key: string) => async () => { setLoading(key); await fn(); setLoading(null); };
  if (!status) return null;

  const isPaused = status.status === "paused";
  const nextRun = status.nextRunAt ? new Date(status.nextRunAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";

  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-zinc-900/60 border border-zinc-800/80 text-xs">
      <div className="flex items-center gap-3 flex-wrap min-w-0">
        <div className="flex items-center gap-1.5">
          <div className={`w-1.5 h-1.5 rounded-full ${isPaused ? "bg-yellow-500" : "bg-emerald-500 animate-pulse"}`} />
          <span className={`font-medium ${isPaused ? "text-yellow-400" : "text-emerald-400"}`}>
            {isPaused ? "Paused" : "Active"}
          </span>
        </div>
        <span className="text-zinc-600">every {status.intervalHours}h</span>
        <div className="flex items-center gap-1 text-zinc-600">
          <Clock className="w-3 h-3" />
          <span>Next: {nextRun}</span>
        </div>
        <span className="text-zinc-700 text-[10px]">{status.runCount} cycles run</span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 border border-zinc-700 transition-all disabled:opacity-40"
          onClick={wrap(onTrigger, "trigger")}
          disabled={loading !== null}
        >
          {loading === "trigger" ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
          Run now
        </button>
        {isPaused ? (
          <button
            className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] bg-emerald-950/40 hover:bg-emerald-950/70 text-emerald-400 border border-emerald-800/60 transition-all disabled:opacity-40"
            onClick={wrap(onResume, "resume")}
            disabled={loading !== null}
          >
            <Play className="w-3 h-3" />Resume
          </button>
        ) : (
          <button
            className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] bg-yellow-950/40 hover:bg-yellow-950/70 text-yellow-400 border border-yellow-800/60 transition-all disabled:opacity-40"
            onClick={wrap(onPause, "pause")}
            disabled={loading !== null}
          >
            <Pause className="w-3 h-3" />Pause
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function ProposalReviewPanel() {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [scheduler, setScheduler] = useState<SchedulerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"pending" | "all">("pending");

  const fetchProposals = useCallback(async () => {
    try {
      const url = filter === "pending" ? "/api/self/proposals?status=pending" : "/api/self/proposals";
      const r = await fetch(url);
      const data = await r.json();
      setProposals(data.proposals ?? []);
    } catch { /* ignore */ }
  }, [filter]);

  const fetchScheduler = useCallback(async () => {
    try {
      const r = await fetch("/api/rsi/scheduler");
      if (r.ok) setScheduler(await r.json());
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchProposals(), fetchScheduler()]).finally(() => setLoading(false));
    const interval = setInterval(() => { fetchProposals(); fetchScheduler(); }, 30_000);
    return () => clearInterval(interval);
  }, [fetchProposals, fetchScheduler]);

  const handleApprove = async (id: string) => {
    try {
      const r = await fetch(`/api/self/proposals/${id}/approve`, { method: "POST" });
      const data = await r.json();
      if (data.success || data.applied) { toast.success("Proposal approved and applied ✓"); await fetchProposals(); }
      else toast.error(`Apply failed: ${data.error ?? "Unknown error"}`);
    } catch { toast.error("Network error"); }
  };

  const handleReject = async (id: string) => {
    try {
      await fetch(`/api/self/proposals/${id}/reject`, { method: "POST" });
      toast.info("Proposal rejected");
      await fetchProposals();
    } catch { toast.error("Network error"); }
  };

  const handleTrigger = async () => {
    try {
      const r = await fetch("/api/rsi/scheduler/trigger", { method: "POST" });
      const data = await r.json();
      if (data.started) toast.success("RSI cycle triggered");
      else toast.info(data.note ?? "Could not trigger");
      await fetchScheduler();
    } catch { toast.error("Network error"); }
  };

  const handlePause = async () => { await fetch("/api/rsi/scheduler/pause", { method: "POST" }); toast.info("Scheduler paused"); await fetchScheduler(); };
  const handleResume = async () => { await fetch("/api/rsi/scheduler/resume", { method: "POST" }); toast.success("Scheduler resumed"); await fetchScheduler(); };

  const pending = proposals.filter(p => p.status === "pending");

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-violet-400" />
          <span className="text-sm font-semibold text-zinc-200">RSI Proposals</span>
          {pending.length > 0 && (
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-violet-500/20 text-violet-300 text-[10px] font-bold border border-violet-500/30">
              {pending.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFilter(f => f === "pending" ? "all" : "pending")}
            className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            {filter === "pending" ? "Show all" : "Pending only"}
          </button>
          <button
            className="p-1 rounded-lg text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
            onClick={() => { fetchProposals(); fetchScheduler(); }}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Scheduler bar */}
      <SchedulerBar status={scheduler} onTrigger={handleTrigger} onPause={handlePause} onResume={handleResume} />

      {/* Proposals list */}
      {loading ? (
        <div className="text-xs text-zinc-600 text-center py-6 flex items-center justify-center gap-2">
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />Loading proposals…
        </div>
      ) : proposals.length === 0 ? (
        <div className="text-center py-8 text-zinc-600">
          <AlertTriangle className="w-6 h-6 mx-auto mb-2 opacity-40" />
          <div className="text-sm">No {filter === "pending" ? "pending " : ""}proposals</div>
          <div className="text-xs mt-1 text-zinc-700">Trigger a cycle to generate new proposals</div>
        </div>
      ) : (
        <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
          {proposals.map(p => (
            <ProposalCard key={p.id} proposal={p} onApprove={handleApprove} onReject={handleReject} />
          ))}
        </div>
      )}
    </div>
  );
}
