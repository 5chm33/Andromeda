/**
 * EvalTrendChart.tsx — v6.32
 *
 * Visualises RSI proof history score deltas over time using recharts.
 * Data source: GET /api/rsi/proof-history → data/rsi_proof_history.json
 */

import { useState, useEffect, useCallback } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Area,
  AreaChart,
} from "recharts";
import { TrendingUp, TrendingDown, Minus, RefreshCw, BarChart2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProofEntry {
  cycleId: string;
  startedAt: number;
  completedAt: number;
  proposalsGenerated: number;
  proposalsApplied: number;
  evalBefore: number | null;
  evalAfter: number | null;
  scoreDelta: number | null;
  appliedProposalIds: string[];
}

interface ChartPoint {
  date: string;
  before: number | null;
  after: number | null;
  delta: number | null;
  applied: number;
  label: string;
}

// ─── Custom tooltip ───────────────────────────────────────────────────────────

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload as ChartPoint;
  return (
    <div className="rounded-lg p-3 text-xs shadow-2xl" style={{ background: '#18181b', border: '1px solid #27272a' }}>
      <div className="mb-2" style={{ color: '#71717a' }}>{d.label}</div>
      {d.before !== null && (
        <div style={{ color: '#a1a1aa' }}>Before: <span className="font-mono" style={{ color: '#38bdf8' }}>{d.before.toFixed(1)}%</span></div>
      )}
      {d.after !== null && (
        <div style={{ color: '#a1a1aa' }}>After: <span className="font-mono" style={{ color: '#34d399' }}>{d.after.toFixed(1)}%</span></div>
      )}
      {d.delta !== null && (
        <div className="font-semibold mt-1" style={{ color: d.delta >= 0 ? '#34d399' : '#fb7185' }}>
          {d.delta >= 0 ? '+' : ''}{d.delta.toFixed(1)}% delta
        </div>
      )}
      <div className="mt-1" style={{ color: '#52525b' }}>{d.applied} proposal{d.applied !== 1 ? 's' : ''} applied</div>
    </div>
  );
}

// ─── Summary stats ────────────────────────────────────────────────────────────

function SummaryStats({ entries }: { entries: ProofEntry[] }) {
  const withScores = entries.filter(e => e.scoreDelta !== null);
  if (withScores.length === 0) return null;

  const totalDelta = withScores.reduce((s, e) => s + (e.scoreDelta ?? 0), 0);
  const avgDelta = totalDelta / withScores.length;
  const best = Math.max(...withScores.map(e => e.scoreDelta ?? 0));
  const totalApplied = entries.reduce((s, e) => s + e.proposalsApplied, 0);

  const TrendIcon = avgDelta > 0.5 ? TrendingUp : avgDelta < -0.5 ? TrendingDown : Minus;
  const trendColor = avgDelta > 0.5 ? "text-emerald-400" : avgDelta < -0.5 ? "text-red-400" : "text-zinc-400";

  return (
    <div className="grid grid-cols-4 gap-2">
      {[
        { label: "Cycles", value: entries.length.toString(), color: "text-zinc-200" },
        { label: "Avg Δ", value: `${avgDelta >= 0 ? "+" : ""}${avgDelta.toFixed(1)}%`, color: trendColor },
        { label: "Best Δ", value: `+${best.toFixed(1)}%`, color: "text-emerald-400" },
        { label: "Applied", value: totalApplied.toString(), color: "text-violet-400" },
      ].map(stat => (
        <div key={stat.label} className="rounded-lg px-3 py-2" style={{ background: '#18181b', border: '1px solid #27272a' }}>
          <div className={`text-sm font-bold font-mono ${stat.color}`}>{stat.value}</div>
          <div className="text-xs mt-0.5" style={{ color: '#52525b' }}>{stat.label}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Main chart ───────────────────────────────────────────────────────────────

export function EvalTrendChart() {
  const [entries, setEntries] = useState<ProofEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"score" | "delta">("score");

  const fetchHistory = useCallback(async () => {
    try {
      const r = await fetch("/api/rsi/proof-history");
      if (r.ok) {
        const data = await r.json();
        setEntries(data.entries ?? []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHistory();
    const interval = setInterval(fetchHistory, 60_000);
    return () => clearInterval(interval);
  }, [fetchHistory]);

  const chartData: ChartPoint[] = entries.map(e => ({
    date: new Date(e.startedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    label: new Date(e.startedAt).toLocaleString(),
    before: e.evalBefore,
    after: e.evalAfter,
    delta: e.scoreDelta,
    applied: e.proposalsApplied,
  }));

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart2 className="w-4 h-4" style={{ color: '#a78bfa' }} />
          <span className="text-sm font-semibold" style={{ color: '#e4e4e7', letterSpacing: '-0.02em' }}>Eval Score Trend</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid #27272a' }}>
            {(['score', 'delta'] as const).map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                className="px-2.5 py-1 text-xs transition-all"
                style={view === v
                  ? { background: 'rgba(124,58,237,0.2)', color: '#c4b5fd' }
                  : { color: '#52525b' }}
              >
                {v === 'score' ? 'Score' : 'Delta'}
              </button>
            ))}
          </div>
          <button
            className="p-1 rounded-lg transition-colors"
            style={{ color: '#52525b' }}
            onClick={fetchHistory}
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-xs text-center py-8" style={{ color: '#52525b' }}>Loading history…</div>
      ) : entries.length === 0 ? (
        <div className="text-center py-8" style={{ color: '#52525b' }}>
          <BarChart2 className="w-6 h-6 mx-auto mb-2 opacity-30" />
          <div className="text-sm">No proof history yet</div>
          <div className="text-xs mt-1">Score data will appear after the first RSI cycle completes</div>
        </div>
      ) : (
        <>
          <SummaryStats entries={entries} />

          <div className="h-48 mt-2">
            <ResponsiveContainer width="100%" height="100%">
              {view === "score" ? (
                <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="beforeGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#38bdf8" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="afterGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#34d399" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#71717a" }} />
                  <YAxis tick={{ fontSize: 10, fill: "#71717a" }} domain={[0, 100]} unit="%" />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="before" stroke="#38bdf8" fill="url(#beforeGrad)" strokeWidth={1.5} dot={false} name="Before" connectNulls />
                  <Area type="monotone" dataKey="after" stroke="#34d399" fill="url(#afterGrad)" strokeWidth={1.5} dot={{ r: 3, fill: "#34d399" }} name="After" connectNulls />
                </AreaChart>
              ) : (
                <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="deltaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#a78bfa" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#71717a" }} />
                  <YAxis tick={{ fontSize: 10, fill: "#71717a" }} unit="%" />
                  <Tooltip content={<CustomTooltip />} />
                  <ReferenceLine y={0} stroke="#52525b" strokeDasharray="4 4" />
                  <Area type="monotone" dataKey="delta" stroke="#a78bfa" fill="url(#deltaGrad)" strokeWidth={2} dot={{ r: 3, fill: "#a78bfa" }} name="Delta" connectNulls />
                </AreaChart>
              )}
            </ResponsiveContainer>
          </div>

          <div className="flex items-center gap-4 text-xs" style={{ color: '#52525b' }}>
            {view === "score" && (
              <>
                <div className="flex items-center gap-1.5"><div className="w-3 h-0.5 bg-sky-400" />Before</div>
                <div className="flex items-center gap-1.5"><div className="w-3 h-0.5 bg-emerald-400" />After</div>
              </>
            )}
            {view === "delta" && (
              <div className="flex items-center gap-1.5"><div className="w-3 h-0.5 bg-violet-400" />Score delta per cycle</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
