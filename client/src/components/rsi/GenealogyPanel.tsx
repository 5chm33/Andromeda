/**
 * GenealogyPanel.tsx — v17.0.0
 *
 * Displays the proposal genealogy DAG, systemic patterns, and rollback
 * verifier health in the RSI dashboard.
 *
 * Data is fetched from:
 *   GET /api/rsi/genealogy/stats
 *   GET /api/rsi/genealogy/patterns
 *   GET /api/rsi/genealogy/graph
 *   GET /api/rsi/rollback-verifier/status
 */

import React, { useEffect, useState, useCallback } from "react";
import {
  GitBranch, GitMerge, RotateCcw, TrendingUp, TrendingDown,
  AlertTriangle, CheckCircle2, XCircle, RefreshCw, Activity,
  Users, FileCode2, Clock, Shield, Zap,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface GenealogyStats {
  totalProposals: number;
  applied: number;
  rejected: number;
  rolledBack: number;
  merged: number;
  acceptanceRate: number;
  rollbackRate: number;
  postChaosAcceptanceRate: number;
  mergedAcceptanceRate: number;
  acceptanceByAgent: Record<string, { total: number; applied: number; rate: number }>;
  highRollbackFiles: Array<{ file: string; rollbacks: number; total: number; rate: number }>;
  avgLifetimeMs: number;
}

interface SystemicPattern {
  pattern: string;
  confidence: number;
  supportingEvidence: number;
  recommendation: string;
}

interface GenealogyNode {
  id: string;
  targetFile: string;
  cycleId: string;
  agentPersona?: string;
  mergedFrom: string[];
  outcome: string;
  semanticSafetyScore: number;
  rewardScore: number;
  generatedAt: string;
  outcomeAt?: string;
  rejectionReason?: string;
}

interface RollbackVerifierStatus {
  totalVerifications: number;
  cleanRollbacks: number;
  dirtyRollbacks: number;
  cleanRate: number;
  lastVerification: {
    clean: boolean;
    typeCheckPassed: boolean;
    testsPassed: boolean | null;
    testsRun: number;
    durationMs: number;
    verifiedAt: string;
  } | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function shortFile(f: string): string {
  const parts = f.split("/");
  return parts[parts.length - 1] ?? f;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function outcomeColor(outcome: string): string {
  switch (outcome) {
    case "applied": return "text-emerald-400";
    case "rejected": return "text-red-400";
    case "rolled_back": return "text-amber-400";
    case "merged_into": return "text-blue-400";
    default: return "text-slate-400";
  }
}

function outcomeIcon(outcome: string): React.ReactNode {
  switch (outcome) {
    case "applied": return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
    case "rejected": return <XCircle className="w-3.5 h-3.5 text-red-400" />;
    case "rolled_back": return <RotateCcw className="w-3.5 h-3.5 text-amber-400" />;
    case "merged_into": return <GitMerge className="w-3.5 h-3.5 text-blue-400" />;
    default: return <Activity className="w-3.5 h-3.5 text-slate-400" />;
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  icon: Icon, label, value, sub, color = "text-white",
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4 flex flex-col gap-1">
      <div className="flex items-center gap-2 text-slate-400 text-xs font-medium uppercase tracking-wider">
        <Icon className="w-3.5 h-3.5" />
        {label}
      </div>
      <div className={`text-2xl font-bold font-mono ${color}`}>{value}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

function PatternCard({ pattern }: { pattern: SystemicPattern }) {
  const confidencePct = Math.round(pattern.confidence * 100);
  const isWarning = pattern.confidence > 0.7;

  return (
    <div className={`border rounded-lg p-3 ${isWarning ? "border-amber-500/40 bg-amber-500/5" : "border-slate-700/50 bg-slate-800/40"}`}>
      <div className="flex items-start gap-2">
        <AlertTriangle className={`w-4 h-4 mt-0.5 flex-shrink-0 ${isWarning ? "text-amber-400" : "text-slate-500"}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-xs font-mono text-slate-300 truncate">{pattern.pattern}</span>
            <span className={`text-xs font-bold flex-shrink-0 ${isWarning ? "text-amber-400" : "text-slate-400"}`}>
              {confidencePct}% conf
            </span>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">{pattern.recommendation}</p>
          <div className="mt-1.5 text-xs text-slate-600">{pattern.supportingEvidence} data points</div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function GenealogyPanel() {
  const [stats, setStats] = useState<GenealogyStats | null>(null);
  const [patterns, setPatterns] = useState<SystemicPattern[]>([]);
  const [graph, setGraph] = useState<GenealogyNode[]>([]);
  const [verifierStatus, setVerifierStatus] = useState<RollbackVerifierStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"overview" | "graph" | "agents" | "rollback">("overview");

  const fetchData = useCallback(async () => {
    try {
      const [statsRes, patternsRes, graphRes, verifierRes] = await Promise.allSettled([
        fetch("/api/rsi/genealogy/stats").then(r => r.json()),
        fetch("/api/rsi/genealogy/patterns").then(r => r.json()),
        fetch("/api/rsi/genealogy/graph?limit=50").then(r => r.json()),
        fetch("/api/rsi/rollback-verifier/status").then(r => r.json()),
      ]);

      if (statsRes.status === "fulfilled") setStats(statsRes.value);
      if (patternsRes.status === "fulfilled") setPatterns(patternsRes.value);
      if (graphRes.status === "fulfilled") setGraph(graphRes.value);
      if (verifierRes.status === "fulfilled") setVerifierStatus(verifierRes.value);
    } catch (err) {
      console.error("[GenealogyPanel] Fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500">
        <RefreshCw className="w-5 h-5 animate-spin mr-2" />
        Loading genealogy data...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-violet-400" />
            Proposal Genealogy
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            DAG tracking of proposal lineage, merges, rollbacks, and systemic patterns
          </p>
        </div>
        <button
          onClick={fetchData}
          className="text-slate-500 hover:text-slate-300 transition-colors p-1.5 rounded-lg hover:bg-slate-800"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Top Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            icon={TrendingUp}
            label="Acceptance Rate"
            value={pct(stats.acceptanceRate)}
            sub={`${stats.applied} applied`}
            color={stats.acceptanceRate > 0.85 ? "text-emerald-400" : stats.acceptanceRate > 0.7 ? "text-amber-400" : "text-red-400"}
          />
          <StatCard
            icon={GitMerge}
            label="Merge Boost"
            value={pct(stats.mergedAcceptanceRate)}
            sub={`${stats.merged} merged`}
            color="text-blue-400"
          />
          <StatCard
            icon={RotateCcw}
            label="Rollback Rate"
            value={pct(stats.rollbackRate)}
            sub={`${stats.rolledBack} rolled back`}
            color={stats.rollbackRate < 0.05 ? "text-emerald-400" : stats.rollbackRate < 0.15 ? "text-amber-400" : "text-red-400"}
          />
          <StatCard
            icon={Clock}
            label="Avg Lifetime"
            value={`${Math.round(stats.avgLifetimeMs / 1000)}s`}
            sub={`${stats.totalProposals} total`}
            color="text-slate-300"
          />
        </div>
      )}

      {/* Tab Navigation */}
      <div className="flex gap-1 bg-slate-800/50 rounded-lg p-1">
        {(["overview", "graph", "agents", "rollback"] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-1.5 px-3 rounded-md text-xs font-medium transition-all capitalize ${
              activeTab === tab
                ? "bg-slate-700 text-white shadow-sm"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            {tab === "rollback" ? "Rollback Health" : tab}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === "overview" && (
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-medium text-slate-300 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            Systemic Patterns ({patterns.length})
          </h3>
          {patterns.length === 0 ? (
            <div className="text-center py-8 text-slate-600 text-sm">
              No systemic patterns detected yet — need more proposal history
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {patterns.map((p, i) => (
                <PatternCard key={i} pattern={p} />
              ))}
            </div>
          )}

          {stats && stats.highRollbackFiles.length > 0 && (
            <>
              <h3 className="text-sm font-medium text-slate-300 flex items-center gap-2 mt-2">
                <FileCode2 className="w-4 h-4 text-red-400" />
                High Rollback Files
              </h3>
              <div className="flex flex-col gap-1">
                {stats.highRollbackFiles.slice(0, 5).map((f, i) => (
                  <div key={i} className="flex items-center justify-between bg-slate-800/40 rounded-lg px-3 py-2">
                    <span className="text-xs font-mono text-slate-300 truncate max-w-[60%]">
                      {shortFile(f.file)}
                    </span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-slate-500">{f.rollbacks}/{f.total}</span>
                      <span className={`text-xs font-bold ${f.rate > 0.3 ? "text-red-400" : "text-amber-400"}`}>
                        {pct(f.rate)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {activeTab === "graph" && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-slate-300">Recent Proposals ({graph.length})</h3>
          <div className="flex flex-col gap-1 max-h-96 overflow-y-auto">
            {graph.length === 0 ? (
              <div className="text-center py-8 text-slate-600 text-sm">No proposals recorded yet</div>
            ) : (
              graph.map(node => (
                <div key={node.id} className="flex items-center gap-3 bg-slate-800/40 rounded-lg px-3 py-2 hover:bg-slate-800/60 transition-colors">
                  <div className="flex-shrink-0">{outcomeIcon(node.outcome)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-slate-300 truncate">
                        {shortFile(node.targetFile)}
                      </span>
                      {node.mergedFrom.length > 0 && (
                        <span className="text-xs bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded">
                          merged
                        </span>
                      )}
                      {node.agentPersona && (
                        <span className="text-xs text-slate-600 truncate hidden md:block">
                          {node.agentPersona}
                        </span>
                      )}
                    </div>
                    {node.rejectionReason && (
                      <div className="text-xs text-slate-600 truncate mt-0.5">{node.rejectionReason}</div>
                    )}
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <div className={`text-xs font-medium ${outcomeColor(node.outcome)}`}>
                      {node.outcome.replace("_", " ")}
                    </div>
                    <div className="text-xs text-slate-600">
                      {relativeTime(node.generatedAt)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {activeTab === "agents" && stats && (
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-medium text-slate-300 flex items-center gap-2">
            <Users className="w-4 h-4 text-violet-400" />
            Acceptance Rate by Agent Persona
          </h3>
          {Object.keys(stats.acceptanceByAgent).length === 0 ? (
            <div className="text-center py-8 text-slate-600 text-sm">
              No agent debate data yet — enable multi-agent debate to see per-agent stats
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {Object.entries(stats.acceptanceByAgent)
                .sort((a, b) => b[1].rate - a[1].rate)
                .map(([agent, s]) => (
                  <div key={agent} className="bg-slate-800/40 rounded-lg px-3 py-2.5">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-medium text-slate-300">{agent}</span>
                      <span className={`text-xs font-bold ${s.rate > 0.85 ? "text-emerald-400" : s.rate > 0.7 ? "text-amber-400" : "text-red-400"}`}>
                        {pct(s.rate)}
                      </span>
                    </div>
                    <div className="w-full bg-slate-700/50 rounded-full h-1.5">
                      <div
                        className={`h-1.5 rounded-full transition-all ${s.rate > 0.85 ? "bg-emerald-500" : s.rate > 0.7 ? "bg-amber-500" : "bg-red-500"}`}
                        style={{ width: `${s.rate * 100}%` }}
                      />
                    </div>
                    <div className="text-xs text-slate-600 mt-1">{s.applied}/{s.total} proposals applied</div>
                  </div>
                ))}
            </div>
          )}

          {/* Post-chaos vs normal comparison */}
          <div className="grid grid-cols-2 gap-3 mt-2">
            <div className="bg-slate-800/40 border border-slate-700/50 rounded-lg p-3">
              <div className="text-xs text-slate-500 mb-1">Normal Proposals</div>
              <div className="text-xl font-bold text-emerald-400 font-mono">{pct(stats.acceptanceRate)}</div>
            </div>
            <div className="bg-slate-800/40 border border-amber-500/20 rounded-lg p-3">
              <div className="text-xs text-slate-500 mb-1">Post-Chaos Proposals</div>
              <div className={`text-xl font-bold font-mono ${stats.postChaosAcceptanceRate < stats.acceptanceRate - 0.1 ? "text-amber-400" : "text-emerald-400"}`}>
                {pct(stats.postChaosAcceptanceRate)}
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "rollback" && (
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-medium text-slate-300 flex items-center gap-2">
            <Shield className="w-4 h-4 text-emerald-400" />
            Rollback Verifier Health
          </h3>
          {!verifierStatus ? (
            <div className="text-center py-8 text-slate-600 text-sm">No rollback verifications yet</div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3">
                <StatCard
                  icon={CheckCircle2}
                  label="Clean Rate"
                  value={pct(verifierStatus.cleanRate)}
                  sub={`${verifierStatus.cleanRollbacks} clean`}
                  color={verifierStatus.cleanRate > 0.9 ? "text-emerald-400" : "text-amber-400"}
                />
                <StatCard
                  icon={RotateCcw}
                  label="Total Verified"
                  value={String(verifierStatus.totalVerifications)}
                  sub="rollbacks"
                  color="text-slate-300"
                />
                <StatCard
                  icon={AlertTriangle}
                  label="Dirty Rollbacks"
                  value={String(verifierStatus.dirtyRollbacks)}
                  sub="escalated to chaos"
                  color={verifierStatus.dirtyRollbacks === 0 ? "text-emerald-400" : "text-red-400"}
                />
              </div>

              {verifierStatus.lastVerification && (
                <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4">
                  <div className="text-xs font-medium text-slate-400 mb-3">Last Verification</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex items-center gap-2">
                      {verifierStatus.lastVerification.typeCheckPassed
                        ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        : <XCircle className="w-4 h-4 text-red-400" />}
                      <span className="text-xs text-slate-300">TypeScript Check</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {verifierStatus.lastVerification.testsPassed === null
                        ? <Activity className="w-4 h-4 text-slate-500" />
                        : verifierStatus.lastVerification.testsPassed
                          ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                          : <XCircle className="w-4 h-4 text-red-400" />}
                      <span className="text-xs text-slate-300">
                        Tests ({verifierStatus.lastVerification.testsRun} run)
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Zap className="w-4 h-4 text-slate-500" />
                      <span className="text-xs text-slate-400">
                        {verifierStatus.lastVerification.durationMs}ms
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-slate-500" />
                      <span className="text-xs text-slate-400">
                        {relativeTime(verifierStatus.lastVerification.verifiedAt)}
                      </span>
                    </div>
                  </div>
                  <div className={`mt-3 text-center text-sm font-semibold ${verifierStatus.lastVerification.clean ? "text-emerald-400" : "text-red-400"}`}>
                    {verifierStatus.lastVerification.clean ? "✓ Clean Rollback" : "✗ Dirty Rollback — Escalated"}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
