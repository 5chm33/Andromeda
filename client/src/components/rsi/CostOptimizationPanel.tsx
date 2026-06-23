/**
 * CostOptimizationPanel.tsx — Phase 1 Dashboard Component
 *
 * Displays real-time cost optimization stats:
 * - Total spend today / this hour
 * - Cost by model (breakdown)
 * - Estimated savings from cheap routing
 * - Projected monthly cost
 * - Daily/hourly budget utilization bars
 */
import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface CostStats {
  totalSpentUsd: number;
  todaySpentUsd: number;
  thisHourSpentUsd: number;
  totalCalls: number;
  byModel: Record<string, { calls: number; totalUsd: number; avgCostUsd: number }>;
  savingsFromCheapRouting: number;
  projectedMonthlyUsd: number;
}

function formatUsd(amount: number): string {
  if (amount < 0.001) return `$${(amount * 1000).toFixed(3)}m`;
  return `$${amount.toFixed(4)}`;
}

function BudgetBar({ used, cap, label }: { used: number; cap: number; label: string }) {
  const pct = Math.min(100, (used / cap) * 100);
  const color = pct > 90 ? "bg-red-500" : pct > 70 ? "bg-yellow-500" : "bg-emerald-500";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px] text-slate-400">
        <span>{label}</span>
        <span>{formatUsd(used)} / {formatUsd(cap)}</span>
      </div>
      <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function CostOptimizationPanel() {
  const [stats, setStats] = useState<CostStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch("/api/cost/stats");
        if (res.ok) setStats(await res.json());
      } catch { /* non-fatal */ }
      finally { setLoading(false); }
    };
    fetchStats();
    const interval = setInterval(fetchStats, 30_000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="p-4 text-center text-slate-500 text-xs">Loading cost stats…</div>
    );
  }

  if (!stats) {
    return (
      <div className="p-4 text-center text-slate-500 text-xs">Cost stats unavailable</div>
    );
  }

  const DAILY_CAP = parseFloat(import.meta.env.VITE_RSI_DAILY_BUDGET_USD ?? "2.00");
  const HOURLY_CAP = parseFloat(import.meta.env.VITE_RSI_HOURLY_BUDGET_USD ?? "0.50");

  const modelEntries = Object.entries(stats.byModel).sort(
    ([, a], [, b]) => b.totalUsd - a.totalUsd
  );

  return (
    <div className="p-4 space-y-4">
      {/* Budget bars */}
      <div className="space-y-2">
        <BudgetBar used={stats.todaySpentUsd} cap={DAILY_CAP} label="Daily Budget" />
        <BudgetBar used={stats.thisHourSpentUsd} cap={HOURLY_CAP} label="Hourly Budget" />
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-slate-800 rounded-lg p-2 text-center">
          <div className="text-emerald-400 font-mono text-sm font-semibold">
            {formatUsd(stats.savingsFromCheapRouting)}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">Saved (cheap routing)</div>
        </div>
        <div className="bg-slate-800 rounded-lg p-2 text-center">
          <div className="text-blue-400 font-mono text-sm font-semibold">
            {formatUsd(stats.projectedMonthlyUsd)}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">Projected / month</div>
        </div>
        <div className="bg-slate-800 rounded-lg p-2 text-center">
          <div className="text-slate-200 font-mono text-sm font-semibold">
            {stats.totalCalls.toLocaleString()}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">Total LLM calls</div>
        </div>
        <div className="bg-slate-800 rounded-lg p-2 text-center">
          <div className="text-violet-400 font-mono text-sm font-semibold">
            {formatUsd(stats.totalSpentUsd)}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">Total spend</div>
        </div>
      </div>

      {/* Model breakdown */}
      {modelEntries.length > 0 && (
        <div>
          <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-2">By Model</div>
          <div className="space-y-1">
            {modelEntries.slice(0, 6).map(([modelId, data]) => (
              <div key={modelId} className="flex items-center justify-between text-[11px]">
                <span className="text-slate-300 truncate max-w-[160px]" title={modelId}>
                  {modelId.split("/").pop() || modelId}
                </span>
                <div className="flex items-center gap-2 ml-2 shrink-0">
                  <Badge variant="outline" className="text-[9px] border-slate-600 text-slate-400 px-1 py-0">
                    {data.calls} calls
                  </Badge>
                  <span className="text-slate-400 font-mono">{formatUsd(data.totalUsd)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
