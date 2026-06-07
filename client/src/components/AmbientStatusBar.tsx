/**
 * AmbientStatusBar.tsx — v7.2.0
 *
 * Phase 3: Ambient intelligence status strip showing live Andromeda activity.
 * Polls /api/rsi/status and /api/self/introspect every 15s.
 * Shows: cycle phase, pending proposals, last improvement, active goals.
 */

import { useState, useEffect } from "react";
import { Zap, GitBranch, Target, Clock, ChevronRight } from "lucide-react";

interface RsiStatus {
  phase: string;
  cycleCount: number;
  lastCycleAt: number | null;
  isRunning: boolean;
}

interface IntrospectData {
  pendingProposals: number;
  activeGoalCount: number;
  recentModifications: Array<{ file: string; at: number }>;
}

function timeAgo(ts: number | null): string {
  if (!ts) return "never";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function AmbientStatusBar() {
  const [rsi, setRsi] = useState<RsiStatus | null>(null);
  const [intro, setIntro] = useState<IntrospectData | null>(null);
  const [expanded, setExpanded] = useState(false);

  const fetchData = async () => {
    try {
      const [rsiRes, introRes] = await Promise.all([
        fetch("/api/rsi/status"),
        fetch("/api/self/introspect"),
      ]);
      if (rsiRes.ok) setRsi(await rsiRes.json());
      if (introRes.ok) setIntro(await introRes.json());
    } catch { /* non-fatal */ }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15_000);
    return () => clearInterval(interval);
  }, []);

  if (!rsi && !intro) return null;

  const isRunning = rsi?.isRunning ?? false;
  const pendingCount = intro?.pendingProposals ?? 0;
  const goalCount = intro?.activeGoalCount ?? 0;
  const lastImprovement = intro?.recentModifications?.[0]?.at ?? null;
  const lastFile = intro?.recentModifications?.[0]?.file?.split("/").pop() ?? null;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-20 pointer-events-none"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex justify-center pb-1 pointer-events-auto">
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-3 px-4 py-1.5 rounded-full text-[11px] transition-all"
          style={{
            background: "oklch(0.11 0.012 265 / 0.92)",
            backdropFilter: "blur(12px)",
            border: "1px solid oklch(0.22 0.015 265 / 0.6)",
            boxShadow: "0 0 20px oklch(0.62 0.22 265 / 0.08)",
          }}
        >
          {/* RSI cycle indicator */}
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${isRunning ? "bg-violet-400 animate-pulse" : "bg-zinc-600"}`} />
            <span className={isRunning ? "text-violet-300" : "text-zinc-500"}>
              {isRunning ? `RSI · ${rsi?.phase ?? "running"}` : `RSI · idle · ${rsi?.cycleCount ?? 0} cycles`}
            </span>
          </div>

          <span className="text-zinc-700">·</span>

          {/* Pending proposals */}
          <div className="flex items-center gap-1">
            <Zap className="w-3 h-3 text-zinc-600" />
            <span className={pendingCount > 0 ? "text-amber-400" : "text-zinc-600"}>
              {pendingCount > 0 ? `${pendingCount} proposal${pendingCount > 1 ? "s" : ""} pending` : "no proposals"}
            </span>
          </div>

          <span className="text-zinc-700">·</span>

          {/* Last improvement */}
          <div className="flex items-center gap-1">
            <Clock className="w-3 h-3 text-zinc-600" />
            <span className="text-zinc-500">
              {lastImprovement
                ? `last: ${lastFile ? lastFile + " " : ""}${timeAgo(lastImprovement)}`
                : "no improvements yet"}
            </span>
          </div>

          {goalCount > 0 && (
            <>
              <span className="text-zinc-700">·</span>
              <div className="flex items-center gap-1">
                <Target className="w-3 h-3 text-zinc-600" />
                <span className="text-zinc-500">{goalCount} goal{goalCount > 1 ? "s" : ""}</span>
              </div>
            </>
          )}

          <ChevronRight className={`w-3 h-3 text-zinc-700 transition-transform ${expanded ? "rotate-90" : ""}`} />
        </button>
      </div>

      {/* Expanded detail panel */}
      {expanded && (
        <div
          className="mx-auto mb-8 max-w-sm rounded-xl p-3 space-y-2 pointer-events-auto animate-slide-up"
          style={{
            background: "oklch(0.11 0.012 265 / 0.96)",
            backdropFilter: "blur(16px)",
            border: "1px solid oklch(0.22 0.015 265 / 0.6)",
            boxShadow: "0 8px 32px oklch(0 0 0 / 0.4)",
          }}
        >
          <div className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider px-1">Andromeda Status</div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                <Zap className="w-3 h-3 text-violet-400" />
                RSI Engine
              </div>
              <span className={`text-xs font-medium ${isRunning ? "text-violet-300" : "text-zinc-500"}`}>
                {isRunning ? rsi?.phase ?? "running" : "idle"}
              </span>
            </div>

            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                <GitBranch className="w-3 h-3 text-amber-400" />
                Pending proposals
              </div>
              <span className={`text-xs font-medium ${pendingCount > 0 ? "text-amber-300" : "text-zinc-600"}`}>
                {pendingCount}
              </span>
            </div>

            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                <Target className="w-3 h-3 text-sky-400" />
                Active goals
              </div>
              <span className="text-xs font-medium text-zinc-400">{goalCount}</span>
            </div>

            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                <Clock className="w-3 h-3 text-emerald-400" />
                Last improvement
              </div>
              <span className="text-xs font-medium text-zinc-400">
                {lastImprovement ? timeAgo(lastImprovement) : "—"}
              </span>
            </div>

            {rsi?.cycleCount !== undefined && (
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                  <div className="w-3 h-3 flex items-center justify-center">
                    <div className="w-2 h-2 rounded-full border border-zinc-600" />
                  </div>
                  Total cycles
                </div>
                <span className="text-xs font-medium text-zinc-500">{rsi.cycleCount.toLocaleString()}</span>
              </div>
            )}
          </div>

          {intro?.recentModifications && intro.recentModifications.length > 0 && (
            <div className="border-t border-zinc-800/60 pt-2 space-y-1">
              <div className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider px-1">Recent changes</div>
              {intro.recentModifications.slice(0, 3).map((m, i) => (
                <div key={i} className="flex items-center justify-between px-1">
                  <span className="text-[11px] text-zinc-500 truncate max-w-[160px]">{m.file.split("/").pop()}</span>
                  <span className="text-[10px] text-zinc-700">{timeAgo(m.at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
