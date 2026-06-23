/**
 * AlgorithmRegistryPanel.tsx — Phase 3 Dashboard Component
 *
 * Displays the algorithmic discovery registry:
 * - Active algorithms per capability
 * - Tournament history
 * - Average improvement over baseline
 * - Trigger new discovery tournament
 */
import React, { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface CapabilityInfo {
  algorithmId: string;
  score: number;
}

interface AlgorithmStats {
  totalAlgorithms: number;
  activeAlgorithms: number;
  totalTournaments: number;
  avgImprovement: number;
  byCapability: Record<string, CapabilityInfo>;
  recentTournaments: Array<{
    id: string;
    capability: string;
    baselineScore: number;
    improvement: number;
    completedAt?: number;
    winnerId?: string;
  }>;
}

const CAPABILITY_LABELS: Record<string, string> = {
  context_compression: "Context Compression",
  proposal_ranking: "Proposal Ranking",
  goal_decomposition: "Goal Decomposition",
  memory_retrieval: "Memory Retrieval",
  cost_estimation: "Cost Estimation",
  pattern_matching: "Pattern Matching",
  anomaly_detection: "Anomaly Detection",
};

export function AlgorithmRegistryPanel() {
  const [stats, setStats] = useState<AlgorithmStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const fetchStats = async () => {
    try {
      const res = await fetch("/api/algo/stats");
      if (res.ok) setStats(await res.json());
    } catch { /* non-fatal */ }
    finally { setLoading(false); }
  };

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 60_000);
    return () => clearInterval(interval);
  }, []);

  const handleRunTournament = async (capability: string) => {
    setRunning(true);
    try {
      await fetch("/api/algo/tournament", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capability }),
      });
      await fetchStats();
    } finally {
      setRunning(false);
    }
  };

  if (loading) {
    return <div className="p-4 text-center text-slate-500 text-xs">Loading algorithm registry…</div>;
  }

  if (!stats) {
    return <div className="p-4 text-center text-slate-500 text-xs">Algorithm registry unavailable</div>;
  }

  return (
    <div className="p-4 space-y-4">
      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-slate-800 rounded-lg p-2 text-center">
          <div className="text-violet-400 font-mono text-sm font-semibold">{stats.totalAlgorithms}</div>
          <div className="text-[10px] text-slate-400">Discovered</div>
        </div>
        <div className="bg-slate-800 rounded-lg p-2 text-center">
          <div className="text-emerald-400 font-mono text-sm font-semibold">
            +{stats.avgImprovement.toFixed(1)}%
          </div>
          <div className="text-[10px] text-slate-400">Avg Improvement</div>
        </div>
        <div className="bg-slate-800 rounded-lg p-2 text-center">
          <div className="text-blue-400 font-mono text-sm font-semibold">{stats.activeAlgorithms}</div>
          <div className="text-[10px] text-slate-400">Active</div>
        </div>
        <div className="bg-slate-800 rounded-lg p-2 text-center">
          <div className="text-slate-200 font-mono text-sm font-semibold">{stats.totalTournaments}</div>
          <div className="text-[10px] text-slate-400">Tournaments</div>
        </div>
      </div>

      {/* Active algorithms by capability */}
      <div>
        <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-2">Active Algorithms</div>
        <div className="space-y-1">
          {Object.entries(CAPABILITY_LABELS).map(([cap, label]) => {
            const info = stats.byCapability[cap];
            return (
              <div key={cap} className="flex items-center justify-between text-[11px]">
                <span className="text-slate-300">{label}</span>
                <div className="flex items-center gap-2">
                  {info ? (
                    <>
                      <div className="h-1 w-16 bg-slate-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-violet-500 rounded-full"
                          style={{ width: `${info.score}%` }}
                        />
                      </div>
                      <span className="text-slate-400 font-mono w-8 text-right">{info.score}</span>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={running}
                      onClick={() => handleRunTournament(cap)}
                      className="text-[9px] h-5 text-slate-500 hover:text-slate-300 px-1"
                    >
                      Discover
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent tournaments */}
      {stats.recentTournaments.length > 0 && (
        <div>
          <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-2">Recent Tournaments</div>
          <div className="space-y-1">
            {stats.recentTournaments.slice(-3).reverse().map(t => (
              <div key={t.id} className="flex items-center justify-between text-[11px]">
                <span className="text-slate-300 truncate max-w-[140px]">
                  {CAPABILITY_LABELS[t.capability] || t.capability}
                </span>
                <Badge
                  variant="outline"
                  className={`text-[9px] px-1 py-0 ${t.improvement > 0 ? "border-emerald-600 text-emerald-400" : "border-slate-600 text-slate-500"}`}
                >
                  {t.improvement > 0 ? `+${t.improvement.toFixed(1)}%` : "No gain"}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
