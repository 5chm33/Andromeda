/**
 * RsiDashboard.tsx — v11.294.0 — SOTA Redesign
 *
 * Complete visual overhaul: Linear/Vercel-grade dark UI with:
 * - Sidebar navigation with live status indicators
 * - Animated stat cards with micro-interactions
 * - Glassmorphism panels with gradient borders
 * - Polished data tables with hover states
 * - OLED-black base with violet identity
 */
import React, { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ProposalReviewPanel } from "@/components/rsi/ProposalReviewPanel";
import { EvalTrendChart } from "@/components/rsi/EvalTrendChart";
import { CapabilityGrowthChart } from "@/components/rsi/CapabilityGrowthChart";
import { CostOptimizationPanel } from "@/components/rsi/CostOptimizationPanel";
import { SwarmVotingPanel } from "@/components/rsi/SwarmVotingPanel";
import { AlgorithmRegistryPanel } from "@/components/rsi/AlgorithmRegistryPanel";
import { ExternalRepoFixer } from "@/components/rsi/ExternalRepoFixer";
import {
  Activity, GitBranch, Zap, Brain, DollarSign, Users, FlaskConical,
  BarChart3, GitCommit, Database, Settings, ArrowLeft, Cpu,
  RefreshCw, Play, Pause, TrendingUp,
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
  costStats?: { totalSpentUsd: number; sessionSpentUsd: number; dailyCapUsd: number; dailyCapExceeded: boolean; byProvider: Record<string, { calls: number; totalUsd: number }>; };
}
interface GitCommit {
  hash: string; fullHash?: string; subject: string; author: string;
  date: string; pushed?: boolean; isRsiCommit?: boolean;
}
interface VectorStats { entryCount: number; dimension: number; model: string; sizeBytes: number; }
interface MemoryStats { total: number; byType: Record<string, number>; }
type NavSection = "overview" | "proposals" | "commits" | "memory" | "cost" | "swarm" | "algorithms";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatTs(ts: number): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
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
  if (before == null || after == null) return <span className="text-[#52525b]">—</span>;
  const delta = ((after - before) / before) * 100;
  if (Math.abs(delta) < 0.01) return <span className="text-[#52525b]">±0.00%</span>;
  if (delta > 0) return <span className="pill pill-emerald">+{delta.toFixed(2)}%</span>;
  return <span className="pill pill-rose">{delta.toFixed(2)}%</span>;
}

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, icon: Icon, color = "violet", trend }: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; color?: "violet"|"emerald"|"cyan"|"amber"|"rose";
  trend?: "up"|"down"|"neutral";
}) {
  const colorMap = {
    violet:  { bg: "rgba(124,58,237,0.1)",  text: "#a78bfa", border: "rgba(124,58,237,0.2)" },
    emerald: { bg: "rgba(16,185,129,0.1)",  text: "#34d399", border: "rgba(16,185,129,0.2)" },
    cyan:    { bg: "rgba(6,182,212,0.1)",   text: "#22d3ee", border: "rgba(6,182,212,0.2)" },
    amber:   { bg: "rgba(245,158,11,0.1)",  text: "#fbbf24", border: "rgba(245,158,11,0.2)" },
    rose:    { bg: "rgba(244,63,94,0.1)",   text: "#fb7185", border: "rgba(244,63,94,0.2)" },
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
      <p className="text-2xl font-bold text-[#fafafa]" style={{ letterSpacing: "-0.03em" }}>{value}</p>
      <p className="text-xs font-medium text-[#a1a1aa] mt-0.5">{label}</p>
      {sub && <p className="text-[11px] text-[#52525b] mt-0.5">{sub}</p>}
    </motion.div>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────────
function Panel({ title, subtitle, children, badge, action, className = "" }: {
  title: string; subtitle?: string; children: React.ReactNode;
  badge?: React.ReactNode; action?: React.ReactNode; className?: string;
}) {
  return (
    <motion.div className={`rounded-xl border border-[#27272a] bg-[#111113] overflow-hidden ${className}`}
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      {/* Gradient top accent */}
      <div className="h-px w-full" style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(124,58,237,0.5) 40%, rgba(99,102,241,0.3) 70%, transparent 100%)' }} />
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#1f1f23]">
        <div className="flex items-center gap-3">
          <div>
            <h3 className="text-sm font-semibold text-[#e4e4e7]" style={{ letterSpacing: '-0.02em' }}>{title}</h3>
            {subtitle && <p className="text-[11px] text-[#52525b] mt-0.5">{subtitle}</p>}
          </div>
          {badge}
        </div>
        {action}
      </div>
      <div>{children}</div>
    </motion.div>
  );
}

// ─── RSI Status Banner ────────────────────────────────────────────────────────
function RsiStatusBanner() {
  const [status, setStatus] = useState<RsiStatus | null>(null);
  const [schedulerPaused, setSchedulerPaused] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);

  const load = useCallback(async () => {
    try {
      const [statusRes, schedRes] = await Promise.all([
        fetch("/api/rsi/status"), fetch("/api/rsi/scheduler"),
      ]);
      if (statusRes.ok) setStatus(await statusRes.json());
      if (schedRes.ok) { const d = await schedRes.json(); setSchedulerPaused(d.paused ?? false); }
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

  if (loading) return (
    <div className="rounded-xl border border-[#27272a] bg-[#111113] p-5 animate-pulse">
      <div className="h-4 w-48 bg-[#27272a] rounded mb-2" /><div className="h-3 w-32 bg-[#1f1f23] rounded" />
    </div>
  );

  const isRunning = status?.phase === "running" || status?.phase === "improving";
  const phaseColor = isRunning ? "#34d399" : schedulerPaused ? "#fbbf24" : "#71717a";
  const phaseLabel = isRunning ? "Running" : schedulerPaused ? "Paused" : status?.phase ?? "Idle";

  return (
    <motion.div className="rounded-xl border bg-[#111113] overflow-hidden"
      style={{ borderColor: isRunning ? "rgba(52,211,153,0.2)" : "#27272a" }}
      initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
      <div className="h-0.5 w-full" style={{ background: isRunning ? "linear-gradient(90deg,transparent,#34d399,transparent)" : "linear-gradient(90deg,transparent,#7c3aed,transparent)", opacity: isRunning ? 1 : 0.4 }} />
      <div className="px-5 py-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <div className="w-2 h-2 rounded-full" style={{ background: phaseColor }} />
              {isRunning && <div className="absolute inset-0 rounded-full animate-ping" style={{ background: phaseColor, opacity: 0.4 }} />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-[#fafafa]">RSI Engine</span>
                <span className="pill" style={{ background: isRunning ? "rgba(52,211,153,0.1)" : "rgba(113,113,122,0.1)", color: phaseColor, border: `1px solid ${isRunning ? "rgba(52,211,153,0.2)" : "rgba(113,113,122,0.2)"}` }}>{phaseLabel}</span>
              </div>
              <p className="text-[11px] text-[#52525b] mt-0.5">{status?.cycleCount ?? 0} cycles{status?.lastCycleAt ? ` · last ${formatTs(status.lastCycleAt)}` : ""}</p>
            </div>
          </div>
          <div className="flex items-center gap-6 ml-auto">
            {status?.costStats && (
              <>
                <div className="text-center"><p className="text-xs font-semibold text-[#fafafa]">${status.costStats.sessionSpentUsd.toFixed(4)}</p><p className="text-[10px] text-[#52525b]">session cost</p></div>
                <div className="text-center"><p className="text-xs font-semibold text-[#fafafa]">${status.costStats.dailyCapUsd.toFixed(2)}</p><p className="text-[10px] text-[#52525b]">daily cap</p></div>
                {status.costStats.dailyCapExceeded && <span className="pill pill-amber">Cap exceeded</span>}
              </>
            )}
            <div className="flex items-center gap-2">
              <button onClick={toggleScheduler} disabled={toggling} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border" style={{ background: schedulerPaused ? "rgba(52,211,153,0.1)" : "rgba(251,191,36,0.1)", color: schedulerPaused ? "#34d399" : "#fbbf24", borderColor: schedulerPaused ? "rgba(52,211,153,0.2)" : "rgba(251,191,36,0.2)" }}>
                {schedulerPaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
                {schedulerPaused ? "Resume" : "Pause"}
              </button>
              <button onClick={() => fetch("/api/rsi/trigger", { method: "POST" }).catch(() => {})} disabled={schedulerPaused} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-[#27272a] text-[#a1a1aa] hover:text-[#fafafa] hover:bg-[#18181b] transition-all disabled:opacity-40">
                <Zap className="w-3 h-3" />Trigger
              </button>
            </div>
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
    };
    load(); const i = setInterval(load, 15_000); return () => clearInterval(i);
  }, []);
  const completedCycles = cycles.filter(c => c.phase === "completed").length;
  const totalProposals = cycles.reduce((a, c) => a + (c.proposalsGenerated || 0), 0);
  const appliedProposals = cycles.reduce((a, c) => a + (c.proposalsApplied || 0), 0);
  const latestScore = cycles.find(c => c.evalScoreAfter != null)?.evalScoreAfter;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard label="Total Cycles" value={status?.cycleCount ?? 0} sub={`${completedCycles} completed`} icon={Activity} color="violet" trend="up" />
      <StatCard label="Proposals Generated" value={totalProposals} sub={`${appliedProposals} applied`} icon={Brain} color="cyan" trend="up" />
      <StatCard label="Latest Eval Score" value={latestScore != null ? `${(latestScore * 100).toFixed(1)}%` : "—"} sub="recursive improvement" icon={TrendingUp} color="emerald" trend={latestScore != null && latestScore > 0.8 ? "up" : "neutral"} />
      <StatCard label="Session Cost" value={status?.costStats ? `$${status.costStats.sessionSpentUsd.toFixed(4)}` : "$0.0000"} sub={`cap: $${status?.costStats?.dailyCapUsd?.toFixed(2) ?? "—"}`} icon={DollarSign} color="amber" trend="neutral" />
    </div>
  );
}

// ─── Cycle History Table ──────────────────────────────────────────────────────
function CycleHistoryTable() {
  const [cycles, setCycles] = useState<RsiCycle[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const load = async () => {
      try { const r = await fetch("/api/rsi/history"); if (r.ok) { const d = await r.json(); setCycles(Array.isArray(d) ? d : d.cycles ?? []); } }
      catch { /* non-fatal */ } finally { setLoading(false); }
    };
    load(); const i = setInterval(load, 30_000); return () => clearInterval(i);
  }, []);
  if (loading) return <div className="p-6 space-y-2">{[...Array(4)].map((_,i) => <div key={i} className="h-10 rounded-lg bg-[#18181b] shimmer" />)}</div>;
  if (cycles.length === 0) return (
    <div className="flex flex-col items-center justify-center py-12 text-[#52525b]">
      <Activity className="w-8 h-8 mb-3 opacity-30" />
      <p className="text-sm">No cycles recorded yet</p>
      <p className="text-xs mt-1">RSI will populate this table as it runs</p>
    </div>
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-[#1f1f23]">
            {["Started","Duration","Phase","Generated","Applied","Score Before","Score After","Δ"].map(h => (
              <th key={h} className="px-4 py-3 text-left font-medium text-[#52525b] whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#1f1f23]">
          {cycles.slice().reverse().slice(0, 50).map((cycle, i) => (
            <motion.tr key={cycle.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }} className="hover:bg-[#18181b] transition-colors">
              <td className="px-4 py-3 font-mono text-[#71717a]">{formatTs(cycle.startedAt)}</td>
              <td className="px-4 py-3 font-mono text-[#71717a]">{formatDuration(cycle.startedAt, cycle.completedAt)}</td>
              <td className="px-4 py-3"><span className={`pill ${cycle.error ? "pill-rose" : cycle.phase === "completed" ? "pill-emerald" : "pill-violet"}`}>{cycle.error ? "error" : cycle.phase}</span></td>
              <td className="px-4 py-3 text-[#a1a1aa]">{cycle.proposalsGenerated}</td>
              <td className="px-4 py-3 text-[#a1a1aa]">{cycle.proposalsApplied}</td>
              <td className="px-4 py-3 font-mono text-[#71717a]">{cycle.evalScoreBefore != null ? `${(cycle.evalScoreBefore*100).toFixed(1)}%` : "—"}</td>
              <td className="px-4 py-3 font-mono text-[#71717a]">{cycle.evalScoreAfter != null ? `${(cycle.evalScoreAfter*100).toFixed(1)}%` : "—"}</td>
              <td className="px-4 py-3">{deltaBadge(cycle.evalScoreBefore, cycle.evalScoreAfter)}</td>
            </motion.tr>
          ))}
        </tbody>
      </table>
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
      try { const r = await fetch("/api/git/log?limit=40"); if (r.ok) { const d = await r.json(); setCommits(d.commits ?? []); setSyncStatus(d.syncStatus ?? "unknown"); setAheadCount(d.aheadCount ?? 0); } }
      catch { /* non-fatal */ } finally { setLoading(false); }
    };
    load(); const i = setInterval(load, 15_000); return () => clearInterval(i);
  }, []);
  const rsiCount = commits.filter(c => c.isRsiCommit || isRSICommit(c.subject)).length;
  if (loading) return <div className="p-4 space-y-2">{[...Array(5)].map((_,i) => <div key={i} className="h-12 rounded-lg bg-[#18181b] shimmer" />)}</div>;
  return (
    <div>
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[#1f1f23] bg-[#0f0f12]">
        <div className={`flex items-center gap-1.5 text-[10px] font-mono ${syncStatus === "synced" ? "text-[#34d399]" : syncStatus === "unknown" ? "text-[#52525b]" : "text-[#fbbf24]"}`}>
          <span className={`w-1.5 h-1.5 rounded-full inline-block ${syncStatus === "synced" ? "bg-[#34d399]" : syncStatus === "unknown" ? "bg-[#52525b]" : "bg-[#fbbf24] animate-pulse"}`} />
          {syncStatus === "synced" ? "GitHub: synced" : syncStatus === "unknown" ? "GitHub: checking…" : `GitHub: ${aheadCount} commit${aheadCount !== 1 ? "s" : ""} ahead`}
        </div>
        {rsiCount > 0 && <span className="ml-auto pill pill-violet">{rsiCount} AI commit{rsiCount !== 1 ? "s" : ""}</span>}
      </div>
      <div className="overflow-y-auto max-h-72 divide-y divide-[#1f1f23]">
        {commits.map((c, i) => {
          const isAi = c.isRsiCommit || isRSICommit(c.subject);
          return (
            <motion.div key={c.hash} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
              className={`flex items-start gap-3 px-4 py-3 hover:bg-[#18181b] transition-colors ${isAi ? "border-l-2 border-[#7c3aed]" : ""}`}>
              <div className="flex-shrink-0 mt-0.5">
                {isAi ? <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-[rgba(124,58,237,0.15)] text-[#a78bfa] text-[9px] font-bold border border-[rgba(124,58,237,0.2)]">AI</span>
                       : <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-[#18181b] text-[#52525b] text-[9px] font-bold border border-[#27272a]">GIT</span>}
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
  const [stats, setStats] = useState<{ vector: VectorStats | null; memory: MemoryStats | null; neuralActive: boolean } | null>(null);
  useEffect(() => {
    const load = async () => { try { const r = await fetch("/api/memory/vector-stats"); if (r.ok) setStats(await r.json()); } catch { /* non-fatal */ } };
    load(); const i = setInterval(load, 60_000); return () => clearInterval(i);
  }, []);
  if (!stats) return <div className="p-6 space-y-2">{[...Array(3)].map((_,i) => <div key={i} className="h-8 rounded bg-[#18181b] shimmer" />)}</div>;
  const { vector, memory, neuralActive } = stats;
  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-[#71717a]">Backend</span>
        <span className={`pill ${neuralActive ? "pill-violet" : "pill-cyan"}`}>{neuralActive ? "Neural (OpenAI)" : "TF-IDF"}</span>
      </div>
      {vector && (
        <div className="space-y-2">
          {[["Vectors stored", vector.entryCount.toLocaleString()], ["Dimensions", String(vector.dimension)], ["Index size", `${(vector.sizeBytes/1024).toFixed(1)} KB`]].map(([k,v]) => (
            <div key={k} className="flex items-center justify-between text-xs">
              <span className="text-[#71717a]">{k}</span>
              <span className="font-mono text-[#e4e4e7]">{v}</span>
            </div>
          ))}
        </div>
      )}
      {memory && (
        <div className="pt-3 border-t border-[#1f1f23]">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#52525b] mb-2">Memory by type</p>
          <div className="space-y-1.5">
            {Object.entries(memory.byType).map(([type, count]) => {
              const pct = Math.round((count / memory.total) * 100);
              return (
                <div key={type}>
                  <div className="flex items-center justify-between text-[10px] mb-1">
                    <span className="text-[#71717a] capitalize">{type}</span>
                    <span className="font-mono text-[#a1a1aa]">{count} ({pct}%)</span>
                  </div>
                  <div className="h-1 rounded-full bg-[#18181b] overflow-hidden">
                    <motion.div className="h-full rounded-full" style={{ background: "#7c3aed" }} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.8, ease: "easeOut" }} />
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
const NAV_ITEMS: { id: NavSection; label: string; icon: React.ElementType }[] = [
  { id: "overview",    label: "Overview",      icon: BarChart3 },
  { id: "proposals",   label: "Proposals",     icon: Brain },
  { id: "commits",     label: "Commit Feed",   icon: GitCommit },
  { id: "memory",      label: "Memory",        icon: Database },
  { id: "cost",        label: "Cost",          icon: DollarSign },
  { id: "swarm",       label: "Swarm Voting",  icon: Users },
  { id: "algorithms",  label: "Algorithms",    icon: FlaskConical },
];

function Sidebar({ active, onChange }: { active: NavSection; onChange: (s: NavSection) => void }) {
  return (
    <aside className="w-52 flex-shrink-0 flex flex-col border-r border-[#1f1f23] bg-[#0a0a0c]">
      <div className="px-4 py-4 border-b border-[#1f1f23]">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#7c3aed] to-[#6366f1] flex items-center justify-center flex-shrink-0">
            <Cpu className="w-3.5 h-3.5 text-white" />
          </div>
          <div>
            <p className="text-xs font-bold text-[#fafafa]" style={{ letterSpacing: "-0.02em" }}>Andromeda</p>
            <p className="text-[9px] text-[#52525b]">RSI Dashboard</p>
          </div>
        </div>
      </div>
      <nav className="flex-1 p-2 space-y-0.5">
        {NAV_ITEMS.map(item => (
          <button key={item.id} onClick={() => onChange(item.id)} className={`nav-item w-full text-left ${active === item.id ? "active" : ""}`}>
            <item.icon className="w-3.5 h-3.5 flex-shrink-0" />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="p-2 border-t border-[#1f1f23]">
        <div className="nav-item"><Settings className="w-3.5 h-3.5" /><span>Settings</span></div>
      </div>
    </aside>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export default function RsiDashboard() {
  const [, navigate] = useLocation();
  const [activeSection, setActiveSection] = useState<NavSection>("overview");
  const adminKey = typeof localStorage !== "undefined" ? (localStorage.getItem("andromeda_admin_key") ?? "") : "";

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "#09090b" }}>
      <Sidebar active={activeSection} onChange={setActiveSection} />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="flex-shrink-0 flex items-center justify-between px-6 py-3.5 border-b border-[#1f1f23] glass">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate("/")} className="flex items-center gap-1.5 text-xs text-[#71717a] hover:text-[#fafafa] transition-colors">
              <ArrowLeft className="w-3.5 h-3.5" />Home
            </button>
            <span className="text-[#27272a]">/</span>
            <span className="text-sm font-semibold text-[#fafafa]">{NAV_ITEMS.find(n => n.id === activeSection)?.label ?? "Dashboard"}</span>
          </div>
          <div className="flex items-center gap-3">
            <ExternalRepoFixer adminKey={adminKey} />
            <span className="pill pill-violet text-[10px]">v11.294.0</span>
          </div>
        </header>

        {/* Scrollable content */}
        <main className="flex-1 overflow-y-auto">
          <AnimatePresence mode="wait">
            <motion.div key={activeSection} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }} className="p-6 space-y-6 max-w-screen-2xl mx-auto">

              {activeSection === "overview" && (<>
                <RsiStatusBanner />
                <OverviewStats />
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                  <Panel title="Eval Score Trend" subtitle="Recursive improvement over time" badge={<span className="pill pill-violet ml-2">Live</span>}><EvalTrendChart /></Panel>
                  <Panel title="Capability Growth" subtitle="By category"><CapabilityGrowthChart /></Panel>
                </div>
                <Panel title="Cycle History" subtitle="Last 50 RSI cycles" action={<button className="flex items-center gap-1.5 text-xs text-[#71717a] hover:text-[#fafafa] transition-colors"><RefreshCw className="w-3 h-3" />Refresh</button>}><CycleHistoryTable /></Panel>
              </>)}

              {activeSection === "proposals" && (<>
                <div><h2 className="text-lg font-bold text-[#fafafa] mb-1" style={{ letterSpacing: "-0.025em" }}>Pending Proposals</h2><p className="text-sm text-[#71717a]">Review and approve AI-generated improvement proposals</p></div>
                <Panel title="Proposal Review" subtitle="Diff viewer with approve/reject"><ProposalReviewPanel /></Panel>
              </>)}

              {activeSection === "commits" && (<>
                <div><h2 className="text-lg font-bold text-[#fafafa] mb-1" style={{ letterSpacing: "-0.025em" }}>Autonomous Commit Feed</h2><p className="text-sm text-[#71717a]">Real-time log of AI-authored commits pushed to GitHub</p></div>
                <Panel title="Git Log" subtitle="Last 40 commits" badge={<span className="pill pill-emerald ml-2">Live · 15s</span>}><GitCommitFeed /></Panel>
              </>)}

              {activeSection === "memory" && (<>
                <div><h2 className="text-lg font-bold text-[#fafafa] mb-1" style={{ letterSpacing: "-0.025em" }}>Memory System</h2><p className="text-sm text-[#71717a]">Vector store and episodic memory statistics</p></div>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                  <Panel title="Vector Memory" subtitle="Neural embeddings"><VectorMemoryStats /></Panel>
                  <Panel title="Capability Growth" subtitle="Tracked over cycles"><CapabilityGrowthChart /></Panel>
                </div>
              </>)}

              {activeSection === "cost" && (<>
                <div><h2 className="text-lg font-bold text-[#fafafa] mb-1" style={{ letterSpacing: "-0.025em" }}>Cost Optimization</h2><p className="text-sm text-[#71717a]">Model routing, spend tracking, and daily cap management</p></div>
                <Panel title="Cost Optimization" subtitle="Phase 1 — model routing" badge={<span className="pill pill-emerald ml-2">Phase 1</span>}><CostOptimizationPanel /></Panel>
              </>)}

              {activeSection === "swarm" && (<>
                <div><h2 className="text-lg font-bold text-[#fafafa] mb-1" style={{ letterSpacing: "-0.025em" }}>Swarm Specialist Voting</h2><p className="text-sm text-[#71717a]">5-agent consensus system for proposal evaluation</p></div>
                <Panel title="Swarm Voting" subtitle="Phase 2 — consensus" badge={<span className="pill pill-cyan ml-2">Phase 2</span>}><SwarmVotingPanel /></Panel>
              </>)}

              {activeSection === "algorithms" && (<>
                <div><h2 className="text-lg font-bold text-[#fafafa] mb-1" style={{ letterSpacing: "-0.025em" }}>Algorithm Registry</h2><p className="text-sm text-[#71717a]">Discovery tournaments and algorithm performance tracking</p></div>
                <Panel title="Algorithm Registry" subtitle="Phase 3 — discovery" badge={<span className="pill pill-violet ml-2">Phase 3</span>}><AlgorithmRegistryPanel /></Panel>
              </>)}

            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
