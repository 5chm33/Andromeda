/**
 * DebateViewer.tsx — v101.0.0
 * Real-time multi-agent debate viewer. Shows the RSI swarm's deliberation
 * process: each agent's proposal, votes, rebuttals, and final consensus.
 */
import React, { useEffect, useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users, MessageSquare, ThumbsUp, ThumbsDown, CheckCircle2,
  XCircle, RefreshCw, Clock, Zap, Brain, Shield, BarChart3,
  ChevronDown, ChevronUp, Radio, AlertTriangle
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
type AgentRole = "proposer" | "critic" | "safety" | "optimizer" | "consensus";
type VoteType = "approve" | "reject" | "abstain";
type DebateStatus = "active" | "consensus" | "rejected" | "pending";

interface AgentVote {
  agentId: string;
  agentRole: AgentRole;
  vote: VoteType;
  confidence: number;
  reasoning: string;
  timestamp: number;
}

interface DebateRound {
  roundNumber: number;
  proposal: string;
  proposedBy: string;
  votes: AgentVote[];
  status: DebateStatus;
  consensusScore?: number;
  startedAt: number;
  endedAt?: number;
}

interface DebateSession {
  sessionId: string;
  topic: string;
  rounds: DebateRound[];
  status: DebateStatus;
  startedAt: number;
  totalAgents: number;
}

// ── Mock data ─────────────────────────────────────────────────────────────────
const AGENT_CONFIGS: Record<AgentRole, { color: string; icon: React.FC<{size?: number}> ; label: string }> = {
  proposer:  { color: "#8b5cf6", icon: Brain,    label: "Proposer"  },
  critic:    { color: "#ef4444", icon: Shield,   label: "Critic"    },
  safety:    { color: "#f59e0b", icon: AlertTriangle, label: "Safety" },
  optimizer: { color: "#10b981", icon: Zap,      label: "Optimizer" },
  consensus: { color: "#06b6d4", icon: BarChart3, label: "Consensus" },
};

function generateMockDebate(): DebateSession {
  const topics = [
    "Refactor the RSI engine to use async generators for better memory efficiency",
    "Add differential privacy to the episodic memory store",
    "Implement a Raft consensus protocol for the agent election system",
    "Replace the moving average anomaly detector with an LSTM-based model",
    "Add causal intervention support to the knowledge graph query engine",
  ];

  const reasonings = {
    approve: [
      "The proposal improves performance by ~23% based on benchmarks.",
      "This change aligns with our constitutional safety principles.",
      "Memory efficiency gains are significant and the risk is low.",
      "The implementation follows established patterns in the codebase.",
    ],
    reject: [
      "The change introduces a potential race condition in the event loop.",
      "This violates the principle of minimal surface area for safety modules.",
      "The performance gain does not justify the added complexity.",
      "Insufficient test coverage for the edge cases identified.",
    ],
    abstain: [
      "Insufficient data to evaluate the long-term implications.",
      "Deferring to the safety agent on this decision.",
    ],
  };

  const roles: AgentRole[] = ["proposer", "critic", "safety", "optimizer", "consensus"];
  const votes: AgentVote[] = roles.map((role, i) => {
    const vote: VoteType = i === 1 ? "reject" : i === 4 ? "abstain" : "approve";
    const rList = reasonings[vote];
    return {
      agentId: `agent-${role}-${Math.random().toString(36).slice(2, 6)}`,
      agentRole: role,
      vote,
      confidence: 0.6 + Math.random() * 0.4,
      reasoning: rList[Math.floor(Math.random() * rList.length)],
      timestamp: Date.now() - Math.floor(Math.random() * 30000),
    };
  });

  const approvals = votes.filter(v => v.vote === "approve").length;
  const total = votes.filter(v => v.vote !== "abstain").length;
  const consensusScore = approvals / total;

  const rounds: DebateRound[] = [
    {
      roundNumber: 1,
      proposal: topics[Math.floor(Math.random() * topics.length)],
      proposedBy: "RSI Engine v100.0.0",
      votes,
      status: consensusScore >= 0.6 ? "consensus" : "rejected",
      consensusScore,
      startedAt: Date.now() - 45000,
      endedAt: Date.now() - 5000,
    },
  ];

  return {
    sessionId: `debate-${Math.random().toString(36).slice(2, 10)}`,
    topic: "RSI Improvement Cycle #247",
    rounds,
    status: rounds[0].status,
    startedAt: Date.now() - 60000,
    totalAgents: 5,
  };
}

// ── Vote Badge ────────────────────────────────────────────────────────────────
const VoteBadge: React.FC<{ vote: VoteType }> = ({ vote }) => {
  const config = {
    approve: { color: "text-green-400 bg-green-400/10 border-green-400/30", icon: ThumbsUp, label: "Approve" },
    reject:  { color: "text-red-400 bg-red-400/10 border-red-400/30",   icon: ThumbsDown, label: "Reject" },
    abstain: { color: "text-gray-400 bg-gray-400/10 border-gray-400/30", icon: Clock,      label: "Abstain" },
  }[vote];
  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium ${config.color}`}>
      <Icon size={10} />
      {config.label}
    </span>
  );
};

// ── Agent Vote Card ───────────────────────────────────────────────────────────
const AgentVoteCard: React.FC<{ vote: AgentVote; index: number }> = ({ vote, index }) => {
  const [expanded, setExpanded] = useState(false);
  const config = AGENT_CONFIGS[vote.agentRole];
  const Icon = config.icon;

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.08 }}
      className="bg-gray-800/50 border border-gray-700 rounded-xl p-4"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: config.color + "22", color: config.color }}
          >
            <Icon size={15} />
          </div>
          <div>
            <p className="text-sm font-medium text-white">{config.label}</p>
            <p className="text-xs text-gray-500 font-mono">{vote.agentId}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <VoteBadge vote={vote.vote} />
          <span className="text-xs text-gray-500">{(vote.confidence * 100).toFixed(0)}%</span>
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-gray-500 hover:text-white transition-colors"
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-3 pt-3 border-t border-gray-700">
              <p className="text-xs text-gray-400 leading-relaxed italic">"{vote.reasoning}"</p>
              <p className="text-xs text-gray-600 mt-2">
                {new Date(vote.timestamp).toLocaleTimeString()}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Confidence bar */}
      <div className="mt-3 h-1 bg-gray-700 rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${vote.confidence * 100}%` }}
          transition={{ delay: index * 0.08 + 0.2, duration: 0.5 }}
          className="h-full rounded-full"
          style={{ backgroundColor: config.color }}
        />
      </div>
    </motion.div>
  );
};

// ── Main Component ─────────────────────────────────────────────────────────────
export default function DebateViewer() {
  const [session, setSession] = useState<DebateSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchSession = useCallback(async () => {
    try {
      const res = await fetch("/api/debate/latest", { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        setSession(await res.json() as DebateSession);
      } else throw new Error("API unavailable");
    } catch {
      setSession(generateMockDebate());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSession();
    if (autoRefresh) {
      intervalRef.current = setInterval(fetchSession, 8000);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchSession, autoRefresh]);

  const round = session?.rounds[0];

  const voteStats = round ? {
    approve: round.votes.filter(v => v.vote === "approve").length,
    reject:  round.votes.filter(v => v.vote === "reject").length,
    abstain: round.votes.filter(v => v.vote === "abstain").length,
  } : null;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      {/* Header */}
      <div className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users className="text-blue-400" size={22} />
          <h1 className="text-lg font-bold text-white">Multi-Agent Debate Viewer</h1>
          {session?.status === "active" && (
            <span className="flex items-center gap-1.5 text-xs text-green-400 bg-green-400/10 px-2 py-0.5 rounded-full border border-green-400/20">
              <Radio size={10} className="animate-pulse" />
              Live
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors ${
              autoRefresh ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"
            }`}
          >
            <Radio size={12} />
            Auto-refresh
          </button>
          <button
            onClick={fetchSession}
            className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 max-w-4xl mx-auto w-full">
        {loading ? (
          <div className="flex items-center justify-center h-48 text-gray-500">
            <RefreshCw size={18} className="animate-spin mr-2" />
            Loading debate session…
          </div>
        ) : session && round ? (
          <div className="space-y-6">
            {/* Session Header */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Session</p>
                  <h2 className="text-xl font-bold text-white">{session.topic}</h2>
                  <p className="text-xs text-gray-500 font-mono mt-1">{session.sessionId}</p>
                </div>
                <div className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                  session.status === "consensus" ? "bg-green-500/20 text-green-400 border border-green-500/30" :
                  session.status === "rejected"  ? "bg-red-500/20 text-red-400 border border-red-500/30" :
                  "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                }`}>
                  {session.status === "consensus" ? "✓ Consensus" :
                   session.status === "rejected"  ? "✗ Rejected" : "● Active"}
                </div>
              </div>
              <div className="flex items-center gap-4 text-sm text-gray-500">
                <span className="flex items-center gap-1.5">
                  <Users size={13} />
                  {session.totalAgents} agents
                </span>
                <span className="flex items-center gap-1.5">
                  <MessageSquare size={13} />
                  {session.rounds.length} round{session.rounds.length !== 1 ? "s" : ""}
                </span>
                <span className="flex items-center gap-1.5">
                  <Clock size={13} />
                  Started {Math.floor((Date.now() - session.startedAt) / 1000)}s ago
                </span>
              </div>
            </div>

            {/* Proposal */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Proposal — Round {round.roundNumber}</p>
              <p className="text-white leading-relaxed">{round.proposal}</p>
              <p className="text-xs text-gray-600 mt-2">Proposed by {round.proposedBy}</p>
            </div>

            {/* Vote Summary */}
            {voteStats && (
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Approve", count: voteStats.approve, color: "text-green-400", bg: "bg-green-400/10 border-green-400/20" },
                  { label: "Reject",  count: voteStats.reject,  color: "text-red-400",   bg: "bg-red-400/10 border-red-400/20" },
                  { label: "Abstain", count: voteStats.abstain, color: "text-gray-400",  bg: "bg-gray-400/10 border-gray-400/20" },
                ].map(({ label, count, color, bg }) => (
                  <div key={label} className={`rounded-xl border p-4 text-center ${bg}`}>
                    <p className={`text-2xl font-bold ${color}`}>{count}</p>
                    <p className="text-xs text-gray-500 mt-1">{label}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Consensus Score */}
            {round.consensusScore !== undefined && (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-white">Consensus Score</p>
                  <p className={`text-sm font-bold ${round.consensusScore >= 0.6 ? "text-green-400" : "text-red-400"}`}>
                    {(round.consensusScore * 100).toFixed(1)}%
                  </p>
                </div>
                <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${round.consensusScore * 100}%` }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
                    className={`h-full rounded-full ${round.consensusScore >= 0.6 ? "bg-green-500" : "bg-red-500"}`}
                  />
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Threshold: 60% — {round.consensusScore >= 0.6 ? "Passed" : "Failed"}
                </p>
              </div>
            )}

            {/* Agent Votes */}
            <div>
              <p className="text-sm font-semibold text-gray-400 mb-3">Agent Votes</p>
              <div className="space-y-3">
                {round.votes.map((vote, i) => (
                  <AgentVoteCard key={vote.agentId} vote={vote} index={i} />
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-48 text-gray-500">
            No active debate session.
          </div>
        )}
      </div>
    </div>
  );
}
