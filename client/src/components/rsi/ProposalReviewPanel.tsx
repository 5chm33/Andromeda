/**
 * ProposalReviewPanel.tsx — v6.32
 *
 * Displays pending RSI improvement proposals with:
 *   - Syntax-highlighted unified diff view
 *   - Confidence badge (colour-coded)
 *   - Approve / Reject buttons
 *   - Scheduler status + manual trigger
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

// ─── Diff renderer ────────────────────────────────────────────────────────────

function DiffView({ diff }: { diff: string }) {
  const lines = diff.split("\n");
  return (
    <pre className="text-xs font-mono overflow-x-auto rounded bg-zinc-950 p-3 max-h-72 overflow-y-auto border border-zinc-800">
      {lines.map((line, i) => {
        let cls = "text-zinc-400";
        if (line.startsWith("+") && !line.startsWith("+++")) cls = "text-emerald-400 bg-emerald-950/30";
        else if (line.startsWith("-") && !line.startsWith("---")) cls = "text-red-400 bg-red-950/30";
        else if (line.startsWith("@@")) cls = "text-sky-400";
        return (
          <div key={i} className={`${cls} leading-5`}>
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}

// ─── Confidence badge ─────────────────────────────────────────────────────────

function ConfidenceBadge({ value }: { value: number | null }) {
  if (value === null) return <Badge variant="outline" className="text-zinc-500">No score</Badge>;
  const pct = Math.round(value * 100);
  const cls =
    pct >= 90 ? "bg-emerald-900/60 text-emerald-300 border-emerald-700" :
    pct >= 70 ? "bg-yellow-900/60 text-yellow-300 border-yellow-700" :
                "bg-red-900/60 text-red-300 border-red-700";
  return <Badge className={`${cls} border text-xs`}>{pct}% confidence</Badge>;
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
  const [loading, setLoading] = useState<"approve" | "reject" | null>(null);

  const handleApprove = async () => {
    setLoading("approve");
    await onApprove(proposal.id);
    setLoading(null);
  };

  const handleReject = async () => {
    setLoading("reject");
    await onReject(proposal.id);
    setLoading(null);
  };

  const statusColor =
    proposal.status === "applied"  ? "text-emerald-400" :
    proposal.status === "rejected" ? "text-red-400" :
    proposal.status === "failed"   ? "text-orange-400" :
                                     "text-zinc-300";

  return (
    <Card className="bg-zinc-900/60 border-zinc-800">
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-sm font-semibold ${statusColor}`}>{proposal.title}</span>
              <ConfidenceBadge value={proposal.confidence} />
              {proposal.status !== "pending" && (
                <Badge variant="outline" className="text-xs capitalize">{proposal.status}</Badge>
              )}
            </div>
            <div className="flex items-center gap-1 mt-1">
              <FileCode className="w-3 h-3 text-zinc-500 shrink-0" />
              <span className="text-xs text-zinc-500 truncate">{proposal.targetFile}</span>
            </div>
          </div>
          <button
            onClick={() => setExpanded(v => !v)}
            className="text-zinc-500 hover:text-zinc-300 shrink-0 mt-0.5"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="px-4 pb-3 space-y-3">
          {proposal.description && (
            <p className="text-xs text-zinc-400 leading-relaxed">{proposal.description}</p>
          )}

          {proposal.diff ? (
            <DiffView diff={proposal.diff} />
          ) : (
            <div className="text-xs text-zinc-600 italic">No diff available — full file replacement</div>
          )}

          {proposal.secondaryChanges && proposal.secondaryChanges.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs text-zinc-500 font-medium">Secondary changes ({proposal.secondaryChanges.length} file{proposal.secondaryChanges.length > 1 ? "s" : ""})</div>
              {proposal.secondaryChanges.map((sc, i) => (
                <div key={i}>
                  <div className="text-xs text-zinc-500 mb-1 flex items-center gap-1">
                    <FileCode className="w-3 h-3" />{sc.file}
                  </div>
                  <DiffView diff={sc.diff} />
                </div>
              ))}
            </div>
          )}

          {proposal.status === "pending" && (
            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                className="bg-emerald-700 hover:bg-emerald-600 text-white h-7 text-xs"
                onClick={handleApprove}
                disabled={loading !== null}
              >
                {loading === "approve" ? (
                  <RefreshCw className="w-3 h-3 animate-spin mr-1" />
                ) : (
                  <CheckCircle className="w-3 h-3 mr-1" />
                )}
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-red-800 text-red-400 hover:bg-red-950 h-7 text-xs"
                onClick={handleReject}
                disabled={loading !== null}
              >
                {loading === "reject" ? (
                  <RefreshCw className="w-3 h-3 animate-spin mr-1" />
                ) : (
                  <XCircle className="w-3 h-3 mr-1" />
                )}
                Reject
              </Button>
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

  const wrap = (fn: () => Promise<void>, key: string) => async () => {
    setLoading(key);
    await fn();
    setLoading(null);
  };

  if (!status) return null;

  const isPaused = status.status === "paused";
  const nextRun = status.nextRunAt ? new Date(status.nextRunAt).toLocaleString() : "—";

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2 rounded-lg bg-zinc-900/80 border border-zinc-800 text-xs">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full ${isPaused ? "bg-yellow-500" : "bg-emerald-500 animate-pulse"}`} />
          <span className="text-zinc-300 font-medium">Auto-trigger</span>
          <span className="text-zinc-500">every {status.intervalHours}h</span>
        </div>
        <div className="flex items-center gap-1 text-zinc-500">
          <Clock className="w-3 h-3" />
          <span>Next: {nextRun}</span>
        </div>
        <div className="text-zinc-600">Cycles run: {status.runCount}</div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-xs border-zinc-700 text-zinc-400 hover:text-zinc-200 px-2"
          onClick={wrap(onTrigger, "trigger")}
          disabled={loading !== null}
        >
          {loading === "trigger" ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
          <span className="ml-1">Run now</span>
        </Button>
        {isPaused ? (
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-xs border-zinc-700 text-emerald-400 hover:text-emerald-300 px-2"
            onClick={wrap(onResume, "resume")}
            disabled={loading !== null}
          >
            <Play className="w-3 h-3 mr-1" />Resume
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-xs border-zinc-700 text-yellow-400 hover:text-yellow-300 px-2"
            onClick={wrap(onPause, "pause")}
            disabled={loading !== null}
          >
            <Pause className="w-3 h-3 mr-1" />Pause
          </Button>
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
    } catch {
      // ignore
    }
  }, [filter]);

  const fetchScheduler = useCallback(async () => {
    try {
      const r = await fetch("/api/rsi/scheduler");
      if (r.ok) setScheduler(await r.json());
    } catch {
      // ignore
    }
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
      if (data.success || data.applied) {
        toast.success("Proposal approved and applied ✓");
        await fetchProposals();
      } else {
        toast.error(`Apply failed: ${data.error ?? "Unknown error"}`);
      }
    } catch (err) {
      toast.error("Network error");
    }
  };

  const handleReject = async (id: string) => {
    try {
      await fetch(`/api/self/proposals/${id}/reject`, { method: "POST" });
      toast.info("Proposal rejected");
      await fetchProposals();
    } catch {
      toast.error("Network error");
    }
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

  const handlePause = async () => {
    await fetch("/api/rsi/scheduler/pause", { method: "POST" });
    toast.info("Scheduler paused");
    await fetchScheduler();
  };

  const handleResume = async () => {
    await fetch("/api/rsi/scheduler/resume", { method: "POST" });
    toast.success("Scheduler resumed");
    await fetchScheduler();
  };

  const pending = proposals.filter(p => p.status === "pending");

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-violet-400" />
          <span className="text-sm font-semibold text-zinc-200">RSI Proposals</span>
          {pending.length > 0 && (
            <Badge className="bg-violet-900/60 text-violet-300 border-violet-700 border text-xs">
              {pending.length} pending
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFilter(f => f === "pending" ? "all" : "pending")}
            className="text-xs text-zinc-500 hover:text-zinc-300"
          >
            {filter === "pending" ? "Show all" : "Pending only"}
          </button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0 text-zinc-500 hover:text-zinc-300"
            onClick={() => { fetchProposals(); fetchScheduler(); }}
          >
            <RefreshCw className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {/* Scheduler bar */}
      <SchedulerBar
        status={scheduler}
        onTrigger={handleTrigger}
        onPause={handlePause}
        onResume={handleResume}
      />

      {/* Proposals list */}
      {loading ? (
        <div className="text-xs text-zinc-600 text-center py-6">Loading proposals…</div>
      ) : proposals.length === 0 ? (
        <div className="text-center py-8 text-zinc-600">
          <AlertTriangle className="w-6 h-6 mx-auto mb-2 opacity-40" />
          <div className="text-sm">No {filter === "pending" ? "pending " : ""}proposals</div>
          <div className="text-xs mt-1">Trigger a cycle to generate new proposals</div>
        </div>
      ) : (
        <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
          {proposals.map(p => (
            <ProposalCard
              key={p.id}
              proposal={p}
              onApprove={handleApprove}
              onReject={handleReject}
            />
          ))}
        </div>
      )}
    </div>
  );
}
