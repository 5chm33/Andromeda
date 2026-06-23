/**
 * SwarmVotingPanel.tsx — Phase 2 Dashboard Component
 *
 * Displays swarm specialist voting activity:
 * - Voting enabled/disabled toggle
 * - Recent voting sessions with consensus results
 * - Per-specialist vote breakdown
 * - Approval rate trend
 * - Veto history
 */
import React, { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface SpecialistVote {
  role: string;
  approve: boolean;
  confidence: number;
  reasoning: string;
  vetoed: boolean;
  latencyMs: number;
}

interface VotingSession {
  sessionId: string;
  proposalId: string;
  targetFile: string;
  changeDescription: string;
  startedAt: number;
  completedAt?: number;
  votes: SpecialistVote[];
  consensus: {
    approved: boolean;
    overallScore: number;
    quorumMet: boolean;
    vetoedBy?: string;
    reasoning: string;
  };
}

interface VotingStats {
  enabled: boolean;
  totalSessions: number;
  approvedSessions: number;
  vetoedSessions: number;
  approvalRate: number;
  recentSessions: VotingSession[];
}

const ROLE_COLORS: Record<string, string> = {
  security: "text-red-400",
  architect: "text-blue-400",
  performance: "text-yellow-400",
  testing: "text-green-400",
  ethics: "text-purple-400",
};

const ROLE_ICONS: Record<string, string> = {
  security: "🔒",
  architect: "🏗️",
  performance: "⚡",
  testing: "🧪",
  ethics: "⚖️",
};

export function SwarmVotingPanel() {
  const [stats, setStats] = useState<VotingStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);

  const fetchStats = async () => {
    try {
      const res = await fetch("/api/swarm/voting/stats");
      if (res.ok) setStats(await res.json());
    } catch { /* non-fatal */ }
    finally { setLoading(false); }
  };

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 15_000);
    return () => clearInterval(interval);
  }, []);

  const handleToggle = async () => {
    if (!stats) return;
    setToggling(true);
    try {
      const endpoint = stats.enabled ? "/api/swarm/voting/disable" : "/api/swarm/voting/enable";
      await fetch(endpoint, { method: "POST" });
      await fetchStats();
    } finally {
      setToggling(false);
    }
  };

  if (loading) {
    return <div className="p-4 text-center text-slate-500 text-xs">Loading swarm stats…</div>;
  }

  if (!stats) {
    return <div className="p-4 text-center text-slate-500 text-xs">Swarm voting unavailable</div>;
  }

  return (
    <div className="p-4 space-y-4">
      {/* Header with toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${stats.enabled ? "bg-emerald-400" : "bg-slate-600"}`} />
          <span className="text-xs text-slate-300">
            {stats.enabled ? "Voting Active" : "Voting Disabled"}
          </span>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={handleToggle}
          disabled={toggling}
          className="text-[10px] h-6 border-slate-600 text-slate-300 hover:bg-slate-700"
        >
          {stats.enabled ? "Disable" : "Enable"}
        </Button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-slate-800 rounded-lg p-2 text-center">
          <div className="text-slate-200 font-mono text-sm font-semibold">{stats.totalSessions}</div>
          <div className="text-[10px] text-slate-400">Sessions</div>
        </div>
        <div className="bg-slate-800 rounded-lg p-2 text-center">
          <div className="text-emerald-400 font-mono text-sm font-semibold">
            {Math.round(stats.approvalRate * 100)}%
          </div>
          <div className="text-[10px] text-slate-400">Approval Rate</div>
        </div>
        <div className="bg-slate-800 rounded-lg p-2 text-center">
          <div className="text-red-400 font-mono text-sm font-semibold">{stats.vetoedSessions}</div>
          <div className="text-[10px] text-slate-400">Vetoes</div>
        </div>
      </div>

      {/* Recent sessions */}
      {stats.recentSessions.length > 0 && (
        <div>
          <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-2">Recent Sessions</div>
          <div className="space-y-2">
            {stats.recentSessions.slice(-5).reverse().map(session => (
              <div key={session.sessionId} className="bg-slate-800 rounded-lg p-2 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-300 truncate max-w-[140px]" title={session.targetFile}>
                    {session.targetFile.split("/").pop()}
                  </span>
                  <Badge
                    variant="outline"
                    className={`text-[9px] px-1 py-0 ${session.consensus.approved ? "border-emerald-600 text-emerald-400" : "border-red-600 text-red-400"}`}
                  >
                    {session.consensus.vetoedBy ? `VETOED (${session.consensus.vetoedBy})` : session.consensus.approved ? "APPROVED" : "REJECTED"}
                  </Badge>
                </div>
                {session.votes.length > 0 && (
                  <div className="flex gap-1 flex-wrap">
                    {session.votes.map(vote => (
                      <span
                        key={vote.role}
                        title={`${vote.role}: ${vote.approve ? "approve" : "reject"} (${Math.round(vote.confidence * 100)}%)`}
                        className={`text-[10px] ${ROLE_COLORS[vote.role] || "text-slate-400"} ${vote.vetoed ? "underline" : ""}`}
                      >
                        {ROLE_ICONS[vote.role] || "•"}{vote.approve ? "✓" : "✗"}
                      </span>
                    ))}
                  </div>
                )}
                <div className="text-[10px] text-slate-500 truncate" title={session.consensus.reasoning}>
                  {session.consensus.reasoning}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
