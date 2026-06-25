/**
 * RsiDashboard.tsx — v12.0.0 — SOTA Command Center Redesign
 *
 * Complete rebuild inspired by Linear's issue graph, Vercel's deployment
 * timeline, and Resend's real-time activity feed.
 *
 * Key improvements over v11.294:
 * - Two-column layout: main content + persistent live activity stream
 * - Command center hero header with live RSI phase, score delta, cost
 * - Cycle history as a vertical timeline (not a raw table)
 * - Live SSE activity stream replacing the terminal
 * - Sidebar with live badge counts
 * - ProposalTreeGraph promoted to full-screen first-class view
 */
import React, { useEffect, useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ProposalReviewPanel } from "@/components/rsi/ProposalReviewPanel";
import { EvalTrendChart } from "@/components/rsi/EvalTrendChart";
import { CapabilityGrowthChart } from "@/components/rsi/CapabilityGrowthChart";
import { CostOptimizationPanel } from "@/components/rsi/CostOptimizationPanel";
import { SwarmVotingPanel } from "@/components/rsi/SwarmVotingPanel";
import { AlgorithmRegistryPanel } from "@/components/rsi/AlgorithmRegistryPanel";
import { ProposalTreeGraph } from "@/components/rsi/ProposalTreeGraph";
import { ProposalFileList } from "@/components/rsi/ProposalFileList";
import { ExternalRepoFixer } from "@/components/rsi/ExternalRepoFixer";
import {
  Activity, GitBranch, Zap, Brain, DollarSign, Users, FlaskConical,
  BarChart3, GitCommit, Database, Settings, ArrowLeft, Cpu,
  RefreshCw, Play, Pause, TrendingUp, GitMerge, AlertTriangle,
  CheckCircle2, XCircle, Clock, Layers, Radio, Terminal,
  ChevronRight, Circle, Loader2, Network, FileCode2, ThumbsUp, ThumbsDown,
} from "lucide-react";
import { useLocation } from "wouter";

// ─── Types ────────────────────────────────────────────────────────────────────
interface RsiCycle {
  id: string; startedAt: number; completedAt?: number; phase: string;
  proposalsGenerated: number; proposalsApplied: number;
  evalScoreBefore?: number; evalScoreAfter?: number; error?: string;
}
interface RsiStatus {
  phase: string; enabled: boolean; cycleCount: number;
  lastCycleAt?: number; nextCycleAt?: number;
  costStats?: {
    totalSpentUsd: number; sessionSpentUsd: number; dailyCapUsd: number;
    dailyCapExceeded: boolean;
    byProvider: Record<string, { calls: number; totalUsd: number }>;
  };
}
interface GitCommit {
  hash: string; fullHash?: string; subject: string; author: string;
  date: string; pushed?: boolean; isRsiCommit?: boolean;
}
interface LiveEvent {
  id: string;
  type: string;
  timestamp: number;
  data: Record<string, unknown>;
}
type NavSection = "overview" | "graph" | "proposals" | "commits" | "memory" | "cost" | "swarm" | "algorithms";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatTs(ts: number): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function formatTimeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return formatTs(ts);
}
function formatDuration(start: number, end?: number): string {
  if (!end) return "running…";
  const s = Math.round((end - start) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}
function isRSICommit(subject: string): boolean {
  return /\[RSI\]|feat\(rsi\)|fix\(rsi\)|chore\(rsi\)|RSI cycle|andromeda.*auto|self-improv/i.test(subject);
}
function deltaBadge(before?: number, after?: number) {
  if (before == null || after == null) return <span className="text-[#52525b] text-[10px]">—</span>;
  const delta = ((after - before) / before) * 100;
  if (Math.abs(delta) < 0.01) return <span className="text-[#52525b] text-[10px]">±0.00%</span>;
  if (delta > 0) return <span className="pill pill-emerald text-[10px]">+{delta.toFixed(2)}%</span>;
  return <span className="pill pill-rose text-[10px]">{delta.toFixed(2)}%</span>;
}

// ─── Live Activity Stream ─────────────────────────────────────────────────────
function useRsiEvents() {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    // Load history first
    fetch("/api/rsi/events/history?limit=30")
      .then(r => r.ok ? r.json() : { events: [] })
      .then(d => {
        if (Array.isArray(d.events)) {
          setEvents(d.events.map((e: LiveEvent, i: number) => ({ ...e, id: `hist-${i}` })));
        }
      })
      .catch(() => {});

    // Connect SSE
    const es = new EventSource("/api/rsi/events");
    esRef.current = es;

    const eventTypes = ["proposal:new","proposal:applied","proposal:rejected","cycle:start","cycle:complete","parallel:start","parallel:complete","heartbeat","connected"];
    eventTypes.forEach(type => {
      es.addEventListener(type, (e: MessageEvent) => {
        if (type === "heartbeat" || type === "connected") {
          setConnected(true);
          return;
        }
        try {
          const data = JSON.parse(e.data);
          setEvents(prev => [{ ...data, id: `live-${Date.now()}-${Math.random()}` }, ...prev].slice(0, 80));
        } catch { /* non-fatal */ }
      });
    });

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    return () => { es.close(); esRef.current = null; };
  }, []);

  return { events, connected };
}

// ─── Event Icon & Color ───────────────────────────────────────────────────────
function eventMeta(type: string) {
  switch (type) {
    case "cycle:start":     return { icon: Play,         color: "#a78bfa", label: "Cycle started",    bg: "rgba(124,58,237,0.08)" };
    case "cycle:complete":  return { icon: CheckCircle2, color: "#34d399", label: "Cycle complete",   bg: "rgba(16,185,129,0.08)" };
    case "proposal:new":    return { icon: Brain,        color: "#22d3ee", label: "Proposal created", bg: "rgba(6,182,212,0.08)"  };
    case "proposal:applied":return { icon: GitMerge,     color: "#34d399", label: "Proposal applied", bg: "rgba(16,185,129,0.08)" };
    case "proposal:rejected":return { icon: XCircle,     color: "#fb7185", label: "Proposal rejected",bg: "rgba(244,63,94,0.08)"  };
    case "parallel:start":  return { icon: Layers,       color: "#fbbf24", label: "Parallel workers", bg: "rgba(245,158,11,0.08)" };
    case "parallel:complete":return { icon: CheckCircle2,color: "#34d399", label: "Workers done",     bg: "rgba(16,185,129,0.08)" };
    default:                return { icon: Activity,     color: "#71717a", label: type,               bg: "rgba(113,113,122,0.06)" };
  }
}

// ─── Live Event RLHF mini-thumbs ────────────────────────────────────────────
function LiveEventRlhf({ proposalId, targetFile, title }: { proposalId: string; targetFile: string; title: string }) {
  const [rated, setRated] = React.useState<"up" | "down" | null>(null);
  const adminKey = typeof localStorage !== "undefined" ? (localStorage.getItem("andromeda_admin_key") ?? "") : "";

  const submit = async (type: "accept" | "reject") => {
    if (rated) return;
    try {
      await fetch("/api/v71/rlhf/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Admin-Key": adminKey },
        body: JSON.stringify({ proposalId, targetFile, category: "unknown", title, feedbackType: type, rawRating: type === "accept" ? 1.0 : 0.0 }),
      });
      setRated(type === "accept" ? "up" : "down");
    } catch { /* non-fatal */ }
  };

  return (
    <div className="flex items-center gap-0.5 flex-shrink-0">
      <button
        onClick={(e) => { e.stopPropagation(); submit("accept"); }}
        disabled={!!rated}
        title="Good improvement"
        className="w-5 h-5 rounded flex items-center justify-center transition-all disabled:opacity-30"
        style={{ color: rated === "up" ? "#34d399" : "#3f3f46" }}
      >
        <ThumbsUp className="w-2.5 h-2.5" />
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); submit("reject"); }}
        disabled={!!rated}
        title="Poor improvement"
        className="w-5 h-5 rounded flex items-center justify-center transition-all disabled:opacity-30"
        style={{ color: rated === "down" ? "#fb7185" : "#3f3f46" }}
      >
        <ThumbsDown className="w-2.5 h-2.5" />
      </button>
    </div>
  );
}

// ─── Live Activity Feed Panel ─────────────────────────────────────────────────
function LiveActivityFeed() {
  const { events, connected } = useRsiEvents();
  const feedRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#1f1f23] flex-shrink-0">
        <div className="flex items-center gap-2">
          <Terminal className="w-3.5 h-3.5 text-[#52525b]" />
          <span className="text-xs font-semibold text-[#e4e4e7]">Live Activity</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-[#34d399]" : "bg-[#52525b]"}`} />
          {connected && <span className="absolute w-1.5 h-1.5 rounded-full bg-[#34d399] animate-ping opacity-60" />}
          <span className="text-[10px] text-[#52525b] font-mono">{connected ? "SSE" : "polling"}</span>
        </div>
      </div>

      {/* Events */}
      <div ref={feedRef} className="flex-1 overflow-y-auto">
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-[#52525b]">
            <Radio className="w-5 h-5 mb-2 opacity-30" />
            <p className="text-xs">Waiting for events…</p>
          </div>
        ) : (
          <div className="divide-y divide-[#1a1a1d]">
            {events.map((event, i) => {
              const meta = eventMeta(event.type);
              const Icon = meta.icon;
              const title = (event.data?.title as string) || (event.data?.proposalTitle as string) || (event.data?.summary as string) || meta.label;
              const sub = event.data?.cycleId ? `cycle ${String(event.data.cycleId).slice(-6)}` : event.data?.file ? String(event.data.file) : "";
              return (
                <motion.div
                  key={event.id || i}
                  initial={i === 0 ? { opacity: 0, x: -8 } : false}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2 }}
                  className="flex items-start gap-2.5 px-3 py-2.5 hover:bg-[#111113] transition-colors group"
                >
                  <div className="flex-shrink-0 mt-0.5 w-5 h-5 rounded flex items-center justify-center" style={{ background: meta.bg }}>
                    <Icon className="w-2.5 h-2.5" style={{ color: meta.color }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] text-[#d4d4d8] leading-tight truncate">{title}</p>
                    {sub && <p className="text-[10px] text-[#52525b] font-mono mt-0.5 truncate">{sub}</p>}
                  </div>
                  <span className="text-[9px] text-[#3f3f46] font-mono flex-shrink-0 mt-0.5 group-hover:text-[#52525b] transition-colors">
                    {formatTimeAgo(event.timestamp)}
                  </span>
                  {event.type === "proposal:applied" && event.data?.proposalId && (
                    <LiveEventRlhf proposalId={String(event.data.proposalId)} targetFile={String(event.data?.file ?? "")} title={title} />
                  )}
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, icon: Icon, color = "violet", trend, loading = false }: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; color?: "violet"|"emerald"|"cyan"|"amber"|"rose";
  trend?: "up"|"down"|"neutral"; loading?: boolean;
}) {
  const colorMap = {
    violet:  { bg: "rgba(124,58,237,0.1)",  text: "#a78bfa", border: "rgba(124,58,237,0.2)" },
    emerald: { bg: "rgba(16,185,129,0.1)",  text: "#34d399", border: "rgba(16,185,129,0.2)" },
    cyan:    { bg: "rgba(6,182,212,0.1)",   text: "#22d3ee", border: "rgba(6,182,212,0.2)"  },
    amber:   { bg: "rgba(245,158,11,0.1)",  text: "#fbbf24", border: "rgba(245,158,11,0.2)" },
    rose:    { bg: "rgba(244,63,94,0.1)",   text: "#fb7185", border: "rgba(244,63,94,0.2)"  },
  };
  const c = colorMap[color];
  return (
    <motion.div className="stat-card" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} whileHover={{ y: -2 }} transition={{ duration: 0.3 }}>
      <div className="flex items-start justify-between mb-3">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: c.bg, border: `1px solid ${c.border}` }}>
          <Icon className="w-4 h-4" style={{ color: c.text }} />
        </div>
        {trend && <span className={`text-[10px] font-medium ${trend === "up" ? "text-[#34d399]" : trend === "down" ? "text-[#fb7185]" : "text-[#71717a]"}`}>{trend === "up" ? "↑" : trend === "down" ? "↓" : "→"}</span>}
      </div>
      {loading ? (
        <div className="space-y-1.5 mt-1"><div className="h-6 w-16 rounded bg-[#27272a] shimmer" /><div className="h-3 w-24 rounded bg-[#1f1f23] shimmer" /></div>
      ) : (
        <>
          <p className="text-2xl font-bold text-[#fafafa]" style={{ letterSpacing: "-0.03em" }}>{value}</p>
          <p className="text-xs font-medium text-[#a1a1aa] mt-0.5">{label}</p>
          {sub && <p className="text-[11px] text-[#52525b] mt-0.5">{sub}</p>}
        </>
      )}
    </motion.div>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────────
function Panel({ title, subtitle, children, badge, action, className = "", noPad = false }: {
  title: string; subtitle?: string; children: React.ReactNode;
  badge?: React.ReactNode; action?: React.ReactNode; className?: string; noPad?: boolean;
}) {
  return (
    <motion.div className={`rounded-xl border border-[#27272a] bg-[#111113] overflow-hidden ${className}`}
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <div className="h-px w-full" style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(124,58,237,0.5) 40%, rgba(99,102,241,0.3) 70%, transparent 100%)' }} />
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#1f1f23]">
        <div className="flex items-center gap-2.5">
          <div>
            <h3 className="text-sm font-semibold text-[#e4e4e7]" style={{ letterSpacing: '-0.02em' }}>{title}</h3>
            {subtitle && <p className="text-[11px] text-[#52525b] mt-0.5">{subtitle}</p>}
          </div>
          {badge}
        </div>
        {action}
      </div>
      <div className={noPad ? "" : ""}>{children}</div>
    </motion.div>
  );
}

// ─── Command Center Hero ──────────────────────────────────────────────────────
function CommandHero() {
  const [status, setStatus] = useState<RsiStatus | null>(null);
  const [schedulerPaused, setSchedulerPaused] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [loading, setLoading] = useState(true);
  const [cycles, setCycles] = useState<RsiCycle[]>([]);

  const load = useCallback(async () => {
    try {
      const [statusRes, schedRes, histRes] = await Promise.all([
        fetch("/api/rsi/status"),
        fetch("/api/rsi/scheduler"),
        fetch("/api/rsi/history"),
      ]);
      if (statusRes.ok) setStatus(await statusRes.json());
      if (schedRes.ok) { const d = await schedRes.json(); setSchedulerPaused(d.paused ?? false); }
      if (histRes.ok) { const d = await histRes.json(); setCycles(Array.isArray(d) ? d : d.cycles ?? []); }
    } catch { /* non-fatal */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); const i = setInterval(load, 10_000); return () => clearInterval(i); }, [load]);

  const toggleScheduler = async () => {
    setToggling(true);
    try {
      await fetch(schedulerPaused ? "/api/rsi/scheduler/resume" : "/api/rsi/scheduler/pause", { method: "POST" });
      setSchedulerPaused(!schedulerPaused);
    } catch { /* non-fatal */ }
    finally { setToggling(false); }
  };

  const isRunning = status?.phase === "running" || status?.phase === "improving";
  const phaseColor = isRunning ? "#34d399" : schedulerPaused ? "#fbbf24" : "#71717a";
  const latestCycle = cycles.find(c => c.evalScoreAfter != null);
  const avgDelta = cycles.filter(c => c.evalScoreBefore != null && c.evalScoreAfter != null)
    .reduce((sum, c) => sum + ((c.evalScoreAfter! - c.evalScoreBefore!) / c.evalScoreBefore!) * 100, 0) / Math.max(1, cycles.filter(c => c.evalScoreBefore != null && c.evalScoreAfter != null).length);

  return (
    <motion.div
      className="rounded-xl border overflow-hidden"
      style={{ borderColor: isRunning ? "rgba(52,211,153,0.2)" : "#27272a", background: "#0d0d10" }}
      initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
    >
      {/* Animated top line */}
      <div className="h-0.5 w-full" style={{
        background: isRunning
          ? "linear-gradient(90deg, transparent, #34d399, #6366f1, transparent)"
          : "linear-gradient(90deg, transparent, #7c3aed, transparent)",
        opacity: isRunning ? 1 : 0.5,
        animation: isRunning ? "shimmer-line 2s linear infinite" : undefined,
      }} />

      <div className="px-6 py-5">
        <div className="flex flex-wrap items-center gap-6">
          {/* Status indicator */}
          <div className="flex items-center gap-3">
            <div className="relative flex-shrink-0">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: isRunning ? "rgba(52,211,153,0.1)" : "rgba(124,58,237,0.1)", border: `1px solid ${isRunning ? "rgba(52,211,153,0.2)" : "rgba(124,58,237,0.2)"}` }}>
                {isRunning
                  ? <Loader2 className="w-5 h-5 text-[#34d399] animate-spin" />
                  : schedulerPaused
                  ? <Pause className="w-5 h-5 text-[#fbbf24]" />
                  : <Cpu className="w-5 h-5 text-[#a78bfa]" />}
              </div>
              {isRunning && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[#34d399] border-2 border-[#0d0d10]"><span className="absolute inset-0 rounded-full bg-[#34d399] animate-ping opacity-60" /></span>}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-bold text-[#fafafa]" style={{ letterSpacing: "-0.025em" }}>RSI Engine</span>
                <span className="pill text-[10px]" style={{
                  background: isRunning ? "rgba(52,211,153,0.1)" : schedulerPaused ? "rgba(245,158,11,0.1)" : "rgba(113,113,122,0.1)",
                  color: phaseColor,
                  border: `1px solid ${isRunning ? "rgba(52,211,153,0.2)" : schedulerPaused ? "rgba(245,158,11,0.2)" : "rgba(113,113,122,0.2)"}`,
                }}>
                  {isRunning ? "Running" : schedulerPaused ? "Paused" : status?.phase ?? "Idle"}
                </span>
              </div>
              <p className="text-[11px] text-[#52525b] mt-0.5">
                {status?.cycleCount ?? 0} cycles total
                {status?.lastCycleAt ? ` · last ${formatTimeAgo(status.lastCycleAt)}` : ""}
              </p>
            </div>
          </div>

          {/* Divider */}
          <div className="hidden lg:block w-px h-10 bg-[#27272a]" />

          {/* Score */}
          <div className="flex items-center gap-4">
            <div>
              <p className="text-[10px] text-[#52525b] uppercase tracking-wider mb-0.5">Latest Score</p>
              <p className="text-lg font-bold text-[#fafafa]" style={{ letterSpacing: "-0.03em" }}>
                {loading ? "—" : latestCycle?.evalScoreAfter != null ? `${(latestCycle.evalScoreAfter * 100).toFixed(1)}%` : "—"}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-[#52525b] uppercase tracking-wider mb-0.5">Avg Δ</p>
              <p className={`text-lg font-bold ${avgDelta > 0 ? "text-[#34d399]" : avgDelta < 0 ? "text-[#fb7185]" : "text-[#71717a]"}`} style={{ letterSpacing: "-0.03em" }}>
                {loading ? "—" : cycles.length > 0 ? `${avgDelta > 0 ? "+" : ""}${avgDelta.toFixed(2)}%` : "—"}
              </p>
            </div>
          </div>

          {/* Divider */}
          <div className="hidden lg:block w-px h-10 bg-[#27272a]" />

          {/* Cost */}
          {status?.costStats && (
            <div className="flex items-center gap-4">
              <div>
                <p className="text-[10px] text-[#52525b] uppercase tracking-wider mb-0.5">Session Cost</p>
                <p className="text-lg font-bold text-[#fafafa]" style={{ letterSpacing: "-0.03em" }}>
                  ${status.costStats.sessionSpentUsd.toFixed(4)}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-[#52525b] uppercase tracking-wider mb-0.5">Daily Cap</p>
                <p className="text-lg font-bold text-[#fafafa]" style={{ letterSpacing: "-0.03em" }}>
                  ${status.costStats.dailyCapUsd.toFixed(2)}
                </p>
              </div>
              {status.costStats.dailyCapExceeded && <span className="pill pill-amber">Cap exceeded</span>}
            </div>
          )}

          {/* Controls — pushed right */}
          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={toggleScheduler} disabled={toggling}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all border"
              style={{
                background: schedulerPaused ? "rgba(52,211,153,0.1)" : "rgba(251,191,36,0.1)",
                color: schedulerPaused ? "#34d399" : "#fbbf24",
                borderColor: schedulerPaused ? "rgba(52,211,153,0.25)" : "rgba(251,191,36,0.25)",
              }}
            >
              {toggling ? <Loader2 className="w-3 h-3 animate-spin" /> : schedulerPaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
              {schedulerPaused ? "Resume" : "Pause"}
            </button>
            <button
              onClick={() => fetch("/api/rsi/trigger", { method: "POST" }).catch(() => {})}
              disabled={schedulerPaused}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold border border-[#27272a] text-[#a1a1aa] hover:text-[#fafafa] hover:bg-[#18181b] transition-all disabled:opacity-40"
            >
              <Zap className="w-3 h-3" />Trigger
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Overview Stats ───────────────────────────────────────────────────────────
function OverviewStats() {
  const [status, setStatus] = useState<RsiStatus | null>(null);
  const [cycles, setCycles] = useState<RsiCycle[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const load = async () => {
      try {
        const [s, c] = await Promise.all([
          fetch("/api/rsi/status").then(r => r.ok ? r.json() : null),
          fetch("/api/rsi/history").then(r => r.ok ? r.json() : []),
        ]);
        if (s) setStatus(s);
        if (Array.isArray(c)) setCycles(c);
        else if (c?.cycles) setCycles(c.cycles);
      } catch { /* non-fatal */ }
      finally { setLoading(false); }
    };
    load(); const i = setInterval(load, 15_000); return () => clearInterval(i);
  }, []);
  const completedCycles = cycles.filter(c => c.phase === "completed").length;
  const totalProposals = cycles.reduce((a, c) => a + (c.proposalsGenerated || 0), 0);
  const appliedProposals = cycles.reduce((a, c) => a + (c.proposalsApplied || 0), 0);
  const latestScore = cycles.find(c => c.evalScoreAfter != null)?.evalScoreAfter;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard loading={loading} label="Total Cycles" value={status?.cycleCount ?? 0} sub={`${completedCycles} completed`} icon={Activity} color="violet" trend="up" />
      <StatCard loading={loading} label="Proposals Generated" value={totalProposals} sub={`${appliedProposals} applied`} icon={Brain} color="cyan" trend="up" />
      <StatCard loading={loading} label="Latest Eval Score" value={latestScore != null ? `${(latestScore * 100).toFixed(1)}%` : "—"} sub="recursive improvement" icon={TrendingUp} color="emerald" trend={latestScore != null && latestScore > 0.8 ? "up" : "neutral"} />
      <StatCard loading={loading} label="Session Cost" value={status?.costStats ? `$${status.costStats.sessionSpentUsd.toFixed(4)}` : "$0.0000"} sub={`cap: $${status?.costStats?.dailyCapUsd?.toFixed(2) ?? "—"}`} icon={DollarSign} color="amber" trend="neutral" />
    </div>
  );
}

// ─── Cycle Timeline ───────────────────────────────────────────────────────────
function CycleTimeline() {
  const [cycles, setCycles] = useState<RsiCycle[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch("/api/rsi/history");
        if (r.ok) { const d = await r.json(); setCycles(Array.isArray(d) ? d : d.cycles ?? []); }
      } catch { /* non-fatal */ }
      finally { setLoading(false); }
    };
    load(); const i = setInterval(load, 30_000); return () => clearInterval(i);
  }, []);

  if (loading) return (
    <div className="p-5 space-y-3">
      {[...Array(5)].map((_, i) => <div key={i} className="h-14 rounded-lg bg-[#18181b] shimmer" />)}
    </div>
  );
  if (cycles.length === 0) return (
    <div className="flex flex-col items-center justify-center py-14 text-[#52525b]">
      <Clock className="w-8 h-8 mb-3 opacity-30" />
      <p className="text-sm">No cycles recorded yet</p>
      <p className="text-xs mt-1 text-[#3f3f46]">RSI will populate this timeline as it runs</p>
    </div>
  );

  return (
    <div className="p-5">
      <div className="relative">
        {/* Vertical timeline line */}
        <div className="absolute left-[15px] top-2 bottom-2 w-px bg-[#27272a]" />

        <div className="space-y-1">
          {cycles.slice().reverse().slice(0, 30).map((cycle, i) => {
            const isError = !!cycle.error;
            const isComplete = cycle.phase === "completed";
            const isRunning = !cycle.completedAt;
            const dotColor = isError ? "#fb7185" : isRunning ? "#a78bfa" : isComplete ? "#34d399" : "#71717a";
            const isExpanded = expanded === cycle.id;

            return (
              <motion.div key={cycle.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.015 }}>
                <button
                  className="w-full text-left pl-9 pr-3 py-2.5 rounded-lg hover:bg-[#18181b] transition-colors group relative"
                  onClick={() => setExpanded(isExpanded ? null : cycle.id)}
                >
                  {/* Timeline dot */}
                  <div className="absolute left-[11px] top-1/2 -translate-y-1/2 w-2 h-2 rounded-full border-2 border-[#09090b]" style={{ background: dotColor }}>
                    {isRunning && <span className="absolute inset-0 rounded-full animate-ping" style={{ background: dotColor, opacity: 0.5 }} />}
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-mono text-[#52525b]">{formatTs(cycle.startedAt)}</span>
                        <span className={`pill text-[10px] ${isError ? "pill-rose" : isRunning ? "pill-violet" : isComplete ? "pill-emerald" : ""}`}>
                          {isError ? "error" : isRunning ? "running" : cycle.phase}
                        </span>
                        {deltaBadge(cycle.evalScoreBefore, cycle.evalScoreAfter)}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-[10px] text-[#71717a]">{formatDuration(cycle.startedAt, cycle.completedAt)}</span>
                        <span className="text-[10px] text-[#52525b]">{cycle.proposalsGenerated} generated · {cycle.proposalsApplied} applied</span>
                      </div>
                    </div>
                    <ChevronRight className={`w-3 h-3 text-[#3f3f46] flex-shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                  </div>
                </button>

                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }} className="overflow-hidden"
                    >
                      <div className="ml-9 mr-3 mb-2 p-3 rounded-lg bg-[#0f0f12] border border-[#1f1f23] text-[11px] space-y-1.5">
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                          {[
                            ["Cycle ID", cycle.id.slice(-8)],
                            ["Duration", formatDuration(cycle.startedAt, cycle.completedAt)],
                            ["Score before", cycle.evalScoreBefore != null ? `${(cycle.evalScoreBefore*100).toFixed(1)}%` : "—"],
                            ["Score after", cycle.evalScoreAfter != null ? `${(cycle.evalScoreAfter*100).toFixed(1)}%` : "—"],
                            ["Proposals generated", String(cycle.proposalsGenerated)],
                            ["Proposals applied", String(cycle.proposalsApplied)],
                          ].map(([k, v]) => (
                            <div key={k} className="flex items-center justify-between">
                              <span className="text-[#52525b]">{k}</span>
                              <span className="font-mono text-[#a1a1aa]">{v}</span>
                            </div>
                          ))}
                        </div>
                        {cycle.error && <div className="mt-2 p-2 rounded bg-[rgba(244,63,94,0.08)] border border-[rgba(244,63,94,0.15)] text-[#fb7185] font-mono">{cycle.error}</div>}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Git Commit Feed ──────────────────────────────────────────────────────────
function GitCommitFeed() {
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [syncStatus, setSyncStatus] = useState<string>("unknown");
  const [aheadCount, setAheadCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch("/api/git/log?limit=40");
        if (r.ok) { const d = await r.json(); setCommits(d.commits ?? []); setSyncStatus(d.syncStatus ?? "unknown"); setAheadCount(d.aheadCount ?? 0); }
      } catch { /* non-fatal */ }
      finally { setLoading(false); }
    };
    load(); const i = setInterval(load, 15_000); return () => clearInterval(i);
  }, []);
  const rsiCount = commits.filter(c => c.isRsiCommit || isRSICommit(c.subject)).length;

  if (loading) return <div className="p-4 space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="h-12 rounded-lg bg-[#18181b] shimmer" />)}</div>;

  return (
    <div>
      {/* Sync status bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[#1f1f23] bg-[#0f0f12]">
        <div className={`flex items-center gap-1.5 text-[10px] font-mono ${syncStatus === "synced" ? "text-[#34d399]" : syncStatus === "unknown" ? "text-[#52525b]" : "text-[#fbbf24]"}`}>
          <span className={`w-1.5 h-1.5 rounded-full inline-block ${syncStatus === "synced" ? "bg-[#34d399]" : syncStatus === "unknown" ? "bg-[#52525b]" : "bg-[#fbbf24] animate-pulse"}`} />
          {syncStatus === "synced" ? "GitHub: synced" : syncStatus === "unknown" ? "GitHub: checking…" : `GitHub: ${aheadCount} commit${aheadCount !== 1 ? "s" : ""} ahead`}
        </div>
        {rsiCount > 0 && <span className="ml-auto pill pill-violet">{rsiCount} AI commit{rsiCount !== 1 ? "s" : ""}</span>}
      </div>

      <div className="overflow-y-auto max-h-80 divide-y divide-[#1a1a1d]">
        {commits.map((c, i) => {
          const isAi = c.isRsiCommit || isRSICommit(c.subject);
          return (
            <motion.div key={c.hash} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
              className={`flex items-start gap-3 px-4 py-3 hover:bg-[#18181b] transition-colors ${isAi ? "border-l-2 border-[#7c3aed]" : "border-l-2 border-transparent"}`}>
              <div className="flex-shrink-0 mt-0.5">
                {isAi
                  ? <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-[rgba(124,58,237,0.15)] text-[#a78bfa] text-[9px] font-bold border border-[rgba(124,58,237,0.2)]">AI</span>
                  : <GitCommit className="w-4 h-4 text-[#3f3f46] mt-0.5" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className={`text-xs truncate font-medium ${isAi ? "text-[#c4b5fd]" : "text-[#e4e4e7]"}`}>{c.subject}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] text-[#52525b] font-mono">{c.hash} · {c.date ? new Date(c.date).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}</span>
                  {c.pushed === true && <span className="text-[9px] text-[#34d399] font-mono">✓ pushed</span>}
                  {c.pushed === false && <span className="text-[9px] text-[#fbbf24] font-mono">⟳ local</span>}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Vector Memory Stats ──────────────────────────────────────────────────────
function VectorMemoryStats() {
  const [stats, setStats] = useState<{ vector: { entryCount: number; dimension: number; model: string; sizeBytes: number } | null; memory: { total: number; byType: Record<string, number> } | null; neuralActive: boolean } | null>(null);
  useEffect(() => {
    const load = async () => { try { const r = await fetch("/api/memory/vector-stats"); if (r.ok) setStats(await r.json()); } catch { /* non-fatal */ } };
    load(); const i = setInterval(load, 60_000); return () => clearInterval(i);
  }, []);
  if (!stats) return <div className="p-6 space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-8 rounded bg-[#18181b] shimmer" />)}</div>;
  const { vector, memory, neuralActive } = stats;
  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-[#71717a]">Backend</span>
        <span className={`pill ${neuralActive ? "pill-violet" : "pill-cyan"}`}>{neuralActive ? "Neural (OpenAI)" : "TF-IDF"}</span>
      </div>
      {vector && (
        <div className="space-y-2">
          {[["Vectors stored", vector.entryCount.toLocaleString()], ["Dimensions", String(vector.dimension)], ["Index size", `${(vector.sizeBytes/1024).toFixed(1)} KB`]].map(([k, v]) => (
            <div key={k} className="flex items-center justify-between text-xs">
              <span className="text-[#71717a]">{k}</span>
              <span className="font-mono text-[#e4e4e7]">{v}</span>
            </div>
          ))}
        </div>
      )}
      {memory && (
        <div className="pt-3 border-t border-[#1f1f23]">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#52525b] mb-3">Memory by type</p>
          <div className="space-y-2">
            {Object.entries(memory.byType).map(([type, count]) => {
              const pct = Math.round((count / memory.total) * 100);
              return (
                <div key={type}>
                  <div className="flex items-center justify-between text-[10px] mb-1">
                    <span className="text-[#71717a] capitalize">{type}</span>
                    <span className="font-mono text-[#a1a1aa]">{count} ({pct}%)</span>
                  </div>
                  <div className="h-1 rounded-full bg-[#18181b] overflow-hidden">
                    <motion.div className="h-full rounded-full" style={{ background: "linear-gradient(90deg, #7c3aed, #6366f1)" }} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.8, ease: "easeOut" }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
const NAV_ITEMS: { id: NavSection; label: string; icon: React.ElementType; badge?: string }[] = [
  { id: "overview",    label: "Overview",      icon: BarChart3  },
  { id: "graph",       label: "File Improvements", icon: FileCode2 },
  { id: "proposals",   label: "Proposals",     icon: Brain      },
  { id: "commits",     label: "Commit Feed",   icon: GitCommit  },
  { id: "memory",      label: "Memory",        icon: Database   },
  { id: "cost",        label: "Cost",          icon: DollarSign },
  { id: "swarm",       label: "Swarm Voting",  icon: Users      },
  { id: "algorithms",  label: "Algorithms",    icon: FlaskConical },
];

function Sidebar({ active, onChange }: { active: NavSection; onChange: (s: NavSection) => void }) {
  const [status, setStatus] = useState<RsiStatus | null>(null);
  useEffect(() => {
    fetch("/api/rsi/status").then(r => r.ok ? r.json() : null).then(d => { if (d) setStatus(d); }).catch(() => {});
    const i = setInterval(() => {
      fetch("/api/rsi/status").then(r => r.ok ? r.json() : null).then(d => { if (d) setStatus(d); }).catch(() => {});
    }, 10_000);
    return () => clearInterval(i);
  }, []);

  const isRunning = status?.phase === "running" || status?.phase === "improving";

  return (
    <aside className="w-52 flex-shrink-0 flex flex-col border-r border-[#1f1f23]" style={{ background: "#0a0a0c" }}>
      {/* Logo */}
      <div className="px-4 py-4 border-b border-[#1f1f23]">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#7c3aed] to-[#6366f1] flex items-center justify-center flex-shrink-0 shadow-[0_0_12px_rgba(124,58,237,0.3)]">
            <Cpu className="w-3.5 h-3.5 text-white" />
          </div>
          <div>
            <p className="text-xs font-bold text-[#fafafa]" style={{ letterSpacing: "-0.02em" }}>Andromeda</p>
            <p className="text-[9px] text-[#52525b]">RSI Dashboard</p>
          </div>
        </div>
      </div>

      {/* Live status pill */}
      <div className="px-3 py-2 border-b border-[#1a1a1d]">
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg" style={{ background: isRunning ? "rgba(52,211,153,0.06)" : "rgba(113,113,122,0.04)" }}>
          <div className="relative">
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: isRunning ? "#34d399" : "#52525b" }} />
            {isRunning && <span className="absolute inset-0 rounded-full animate-ping" style={{ background: "#34d399", opacity: 0.5 }} />}
          </div>
          <span className="text-[10px] font-medium" style={{ color: isRunning ? "#34d399" : "#52525b" }}>
            {isRunning ? "Running" : status?.phase ?? "Idle"}
          </span>
          {status?.cycleCount != null && (
            <span className="ml-auto text-[9px] font-mono text-[#3f3f46]">#{status.cycleCount}</span>
          )}
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map(item => (
          <button key={item.id} onClick={() => onChange(item.id)}
            className={`nav-item w-full text-left ${active === item.id ? "active" : ""}`}>
            <item.icon className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="flex-1">{item.label}</span>
          </button>
        ))}
      </nav>

      {/* Footer */}
      <div className="p-2 border-t border-[#1f1f23]">
        <div className="nav-item cursor-default opacity-50">
          <Settings className="w-3.5 h-3.5" />
          <span>Settings</span>
        </div>
      </div>
    </aside>
  );
}

// ─── Section Header ───────────────────────────────────────────────────────────
function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-5">
      <h2 className="text-xl font-bold text-[#fafafa]" style={{ letterSpacing: "-0.03em" }}>{title}</h2>
      <p className="text-sm text-[#71717a] mt-0.5">{subtitle}</p>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export default function RsiDashboard() {
  const [, navigate] = useLocation();
  const [activeSection, setActiveSection] = useState<NavSection>("overview");
  const [adminKey, setAdminKey] = React.useState<string>(
    typeof localStorage !== "undefined" ? (localStorage.getItem("andromeda_admin_key") ?? "") : ""
  );
  // Auto-fetch admin key from server (localhost only)
  React.useEffect(() => {
    if (adminKey) return;
    fetch("/api/admin/local-key")
      .then(r => r.ok ? r.json() : null)
      .then((d: { key?: string } | null) => {
        if (d?.key) {
          localStorage.setItem("andromeda_admin_key", d.key);
          setAdminKey(d.key);
        }
      })
      .catch(() => {});
  }, [adminKey]);

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "#09090b" }}>
      <Sidebar active={activeSection} onChange={setActiveSection} />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="flex-shrink-0 flex items-center justify-between px-6 py-3 border-b border-[#1f1f23]" style={{ background: "rgba(9,9,11,0.8)", backdropFilter: "blur(20px)" }}>
          <div className="flex items-center gap-3">
            <button onClick={() => navigate("/")} className="flex items-center gap-1.5 text-xs text-[#71717a] hover:text-[#fafafa] transition-colors">
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Home</span>
            </button>
            <span className="text-[#27272a]">/</span>
            <span className="text-sm font-semibold text-[#fafafa]" style={{ letterSpacing: "-0.02em" }}>
              {NAV_ITEMS.find(n => n.id === activeSection)?.label ?? "Dashboard"}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <ExternalRepoFixer adminKey={adminKey} />
            <span className="pill pill-violet text-[10px]">v12.3.0</span>
          </div>
        </header>

        {/* Main content area */}
        <div className="flex-1 flex overflow-hidden">
          {/* Scrollable content */}
          <main className="flex-1 overflow-y-auto min-w-0">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeSection}
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
                className="p-6 space-y-5 max-w-screen-xl"
              >
                {/* ── Overview ─────────────────────────────────────────── */}
                {activeSection === "overview" && (<>
                  <CommandHero />
                  <OverviewStats />
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                    <Panel title="Eval Score Trend" subtitle="Recursive improvement over time" badge={<span className="pill pill-violet ml-2 text-[10px]">Live</span>}>
                      <EvalTrendChart />
                    </Panel>
                    <Panel title="Capability Growth" subtitle="By category">
                      <CapabilityGrowthChart />
                    </Panel>
                  </div>
                  <Panel
                    title="Cycle Timeline"
                    subtitle="Last 30 RSI cycles — click any row to expand"
                    action={
                      <button className="flex items-center gap-1.5 text-xs text-[#71717a] hover:text-[#fafafa] transition-colors" onClick={() => window.location.reload()}>
                        <RefreshCw className="w-3 h-3" />Refresh
                      </button>
                    }
                  >
                    <CycleTimeline />
                  </Panel>
                </>)}

                {/* ── File Improvements ─────────────────────────────────── */}
                {activeSection === "graph" && (<>
                  <SectionHeader title="File Improvements" subtitle="Every file the RSI engine has touched — click any row to see the diff" />
                  <div className="rounded-xl border border-[#27272a] overflow-hidden" style={{ height: "calc(100vh - 220px)", minHeight: 500 }}>
                    <ProposalFileList />
                  </div>
                </>)}

                {/* ── Proposals ────────────────────────────────────────── */}
                {activeSection === "proposals" && (<>
                  <SectionHeader title="Pending Proposals" subtitle="Review and approve AI-generated improvement proposals" />
                  <Panel title="Proposal Review" subtitle="Diff viewer with approve/reject">
                    <ProposalReviewPanel />
                  </Panel>
                </>)}

                {/* ── Commits ──────────────────────────────────────────── */}
                {activeSection === "commits" && (<>
                  <SectionHeader title="Autonomous Commit Feed" subtitle="Real-time log of AI-authored commits pushed to GitHub" />
                  <Panel title="Git Log" subtitle="Last 40 commits" badge={<span className="pill pill-emerald ml-2 text-[10px]">Live · 15s</span>}>
                    <GitCommitFeed />
                  </Panel>
                </>)}

                {/* ── Memory ───────────────────────────────────────────── */}
                {activeSection === "memory" && (<>
                  <SectionHeader title="Memory System" subtitle="Vector store and episodic memory statistics" />
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                    <Panel title="Vector Memory" subtitle="Neural embeddings">
                      <VectorMemoryStats />
                    </Panel>
                    <Panel title="Capability Growth" subtitle="Tracked over cycles">
                      <CapabilityGrowthChart />
                    </Panel>
                  </div>
                </>)}

                {/* ── Cost ─────────────────────────────────────────────── */}
                {activeSection === "cost" && (<>
                  <SectionHeader title="Cost Optimization" subtitle="Model routing, spend tracking, and daily cap management" />
                  <Panel title="Cost Optimization" subtitle="Phase 1 — model routing" badge={<span className="pill pill-emerald ml-2 text-[10px]">Phase 1</span>}>
                    <CostOptimizationPanel />
                  </Panel>
                </>)}

                {/* ── Swarm ────────────────────────────────────────────── */}
                {activeSection === "swarm" && (<>
                  <SectionHeader title="Swarm Specialist Voting" subtitle="5-agent consensus system for proposal evaluation" />
                  <Panel title="Swarm Voting" subtitle="Phase 2 — consensus" badge={<span className="pill pill-cyan ml-2 text-[10px]">Phase 2</span>}>
                    <SwarmVotingPanel />
                  </Panel>
                </>)}

                {/* ── Algorithms ───────────────────────────────────────── */}
                {activeSection === "algorithms" && (<>
                  <SectionHeader title="Algorithm Registry" subtitle="Discovery tournaments and algorithm performance tracking" />
                  <Panel title="Algorithm Registry" subtitle="Phase 3 — discovery" badge={<span className="pill pill-violet ml-2 text-[10px]">Phase 3</span>}>
                    <AlgorithmRegistryPanel />
                  </Panel>
                </>)}

              </motion.div>
            </AnimatePresence>
          </main>

          {/* ── Live Activity Stream (right sidebar) ─────────────────── */}
          {activeSection !== "graph" && (
            <aside className="w-72 flex-shrink-0 border-l border-[#1f1f23] flex flex-col overflow-hidden" style={{ background: "#0a0a0c" }}>
              {/* Gradient accent */}
              <div className="h-px w-full" style={{ background: "linear-gradient(90deg, transparent, rgba(124,58,237,0.4), transparent)" }} />
              <LiveActivityFeed />
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
