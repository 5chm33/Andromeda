/**
 * CapabilityGrowthChart.tsx — Andromeda v6.35
 *
 * Visualises per-category eval score deltas across RSI cycles.
 * Data source: GET /api/rsi/proof-history
 *
 * Categories tracked:
 *   - code_generation, browser_automation, multi_step_reasoning, self_knowledge
 *   - (plus any future categories added to evalFramework.ts)
 */

import React, { useEffect, useState, useCallback } from "react";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Tooltip, Legend,
  LineChart, Line, XAxis, YAxis, CartesianGrid,
} from "recharts";

interface ProofEntry {
  cycleId: string;
  completedAt: string;
  scoreBefore: number;
  scoreAfter: number;
  scoreDelta: number;
  categoryScoresBefore?: Record<string, number>;
  categoryScoresAfter?: Record<string, number>;
}

interface CategoryTrendPoint {
  cycle: string;
  date: string;
  [category: string]: number | string;
}

const CATEGORY_COLORS: Record<string, string> = {
  code_generation:      "#6366f1",
  browser_automation:   "#22d3ee",
  multi_step_reasoning: "#f59e0b",
  self_knowledge:       "#10b981",
  reliability:          "#ef4444",
  performance:          "#8b5cf6",
  security:             "#f97316",
  readability:          "#84cc16",
};

const DEFAULT_COLOR = "#94a3b8";

function getCategoryColor(cat: string): string {
  return CATEGORY_COLORS[cat] ?? DEFAULT_COLOR;
}

function formatCategoryLabel(cat: string): string {
  return cat.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

export function CapabilityGrowthChart() {
  const [history, setHistory] = useState<ProofEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"radar" | "trend">("radar");

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/rsi/proof-history");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ProofEntry[] = await res.json();
      setHistory(data);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHistory();
    const interval = setInterval(fetchHistory, 60_000);
    return () => clearInterval(interval);
  }, [fetchHistory]);

  // Collect all categories seen across all entries
  const allCategories = Array.from(new Set(
    history.flatMap(e => [
      ...Object.keys(e.categoryScoresBefore ?? {}),
      ...Object.keys(e.categoryScoresAfter ?? {}),
    ])
  )).sort();

  // Latest cycle radar data
  const latestEntry = history.length > 0 ? history[history.length - 1] : null;
  const radarData = allCategories.map(cat => ({
    category: formatCategoryLabel(cat),
    before: latestEntry?.categoryScoresBefore?.[cat] ?? 0,
    after: latestEntry?.categoryScoresAfter?.[cat] ?? 0,
  }));

  // Trend data — one point per cycle
  const trendData: CategoryTrendPoint[] = history
    .filter(e => e.categoryScoresAfter && Object.keys(e.categoryScoresAfter).length > 0)
    .map((e, i) => {
      const point: CategoryTrendPoint = {
        cycle: `C${i + 1}`,
        date: new Date(e.completedAt).toLocaleDateString(),
      };
      for (const cat of allCategories) {
        point[cat] = e.categoryScoresAfter?.[cat] ?? 0;
      }
      return point;
    });

  if (loading) {
    return (
      <div className="bg-gray-900 rounded-xl border border-gray-700 p-6">
        <div className="text-gray-400 text-sm">Loading capability growth data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-gray-900 rounded-xl border border-red-800 p-6">
        <div className="text-red-400 text-sm">Failed to load capability data: {error}</div>
      </div>
    );
  }

  const hasCategoryData = allCategories.length > 0 && latestEntry?.categoryScoresAfter;

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-700 p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-white font-semibold text-lg">Capability Growth</h3>
          <p className="text-gray-400 text-xs mt-0.5">
            Per-category eval scores across {history.length} RSI cycle{history.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setView("radar")}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              view === "radar"
                ? "bg-indigo-600 text-white"
                : "bg-gray-800 text-gray-400 hover:bg-gray-700"
            }`}
          >
            Radar
          </button>
          <button
            onClick={() => setView("trend")}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              view === "trend"
                ? "bg-indigo-600 text-white"
                : "bg-gray-800 text-gray-400 hover:bg-gray-700"
            }`}
          >
            Trend
          </button>
          <button
            onClick={fetchHistory}
            className="px-3 py-1 rounded text-xs font-medium bg-gray-800 text-gray-400 hover:bg-gray-700 transition-colors"
          >
            ↻
          </button>
        </div>
      </div>

      {!hasCategoryData ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="text-4xl mb-3">📊</div>
          <div className="text-gray-400 text-sm">
            No per-category data yet.
          </div>
          <div className="text-gray-500 text-xs mt-1">
            Category scores are captured after each RSI cycle that applies at least one proposal.
          </div>
        </div>
      ) : view === "radar" ? (
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={radarData}>
              <PolarGrid stroke="#374151" />
              <PolarAngleAxis
                dataKey="category"
                tick={{ fill: "#9ca3af", fontSize: 11 }}
              />
              <PolarRadiusAxis
                angle={90}
                domain={[0, 100]}
                tick={{ fill: "#6b7280", fontSize: 9 }}
              />
              <Radar
                name="Before"
                dataKey="before"
                stroke="#6b7280"
                fill="#6b7280"
                fillOpacity={0.15}
                strokeDasharray="4 2"
              />
              <Radar
                name="After"
                dataKey="after"
                stroke="#6366f1"
                fill="#6366f1"
                fillOpacity={0.3}
              />
              <Legend
                wrapperStyle={{ fontSize: "12px", color: "#9ca3af" }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#1f2937",
                  border: "1px solid #374151",
                  borderRadius: "8px",
                  color: "#f9fafb",
                  fontSize: "12px",
                }}
                formatter={(value: number, name: string) => [
                  `${value.toFixed(1)}%`,
                  name,
                ]}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="h-72">
          {trendData.length < 2 ? (
            <div className="flex items-center justify-center h-full text-gray-500 text-sm">
              Need at least 2 cycles with category data to show trend.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis
                  dataKey="cycle"
                  tick={{ fill: "#9ca3af", fontSize: 11 }}
                  axisLine={{ stroke: "#374151" }}
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fill: "#9ca3af", fontSize: 11 }}
                  axisLine={{ stroke: "#374151" }}
                  unit="%"
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#1f2937",
                    border: "1px solid #374151",
                    borderRadius: "8px",
                    color: "#f9fafb",
                    fontSize: "12px",
                  }}
                  formatter={(value: number, name: string) => [
                    `${value.toFixed(1)}%`,
                    formatCategoryLabel(name),
                  ]}
                  labelFormatter={(label, payload) => {
                    const entry = payload?.[0]?.payload;
                    return entry ? `${label} — ${entry.date}` : label;
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: "11px", color: "#9ca3af" }}
                  formatter={(value: string) => formatCategoryLabel(value)}
                />
                {allCategories.map(cat => (
                  <Line
                    key={cat}
                    type="monotone"
                    dataKey={cat}
                    stroke={getCategoryColor(cat)}
                    strokeWidth={2}
                    dot={{ r: 3, fill: getCategoryColor(cat) }}
                    activeDot={{ r: 5 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      )}

      {/* Category delta table */}
      {hasCategoryData && latestEntry && (
        <div className="border-t border-gray-800 pt-4">
          <div className="text-gray-500 text-xs mb-2 uppercase tracking-wide">Latest Cycle Delta</div>
          <div className="grid grid-cols-2 gap-2">
            {allCategories.map(cat => {
              const before = latestEntry.categoryScoresBefore?.[cat] ?? 0;
              const after = latestEntry.categoryScoresAfter?.[cat] ?? 0;
              const delta = after - before;
              return (
                <div key={cat} className="flex items-center justify-between bg-gray-800 rounded px-3 py-2">
                  <span className="text-gray-300 text-xs">{formatCategoryLabel(cat)}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500 text-xs">{before.toFixed(0)}%</span>
                    <span className="text-gray-600 text-xs">→</span>
                    <span className="text-white text-xs font-medium">{after.toFixed(0)}%</span>
                    <span className={`text-xs font-bold ${delta > 0 ? "text-green-400" : delta < 0 ? "text-red-400" : "text-gray-500"}`}>
                      {delta > 0 ? "+" : ""}{delta.toFixed(0)}
                    </span>
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

export default CapabilityGrowthChart;
