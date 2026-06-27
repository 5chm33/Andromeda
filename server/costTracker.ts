/**
 * costTracker.ts — v78.0.0 "Cost Management & FinOps"
 * Records resource cost events and accumulates spend by service, team, and time window.
 */
export type CostCategory = "compute" | "storage" | "network" | "database" | "ai_inference" | "monitoring" | "other";

export interface CostEvent {
  eventId: string;
  service: string;
  team: string;
  category: CostCategory;
  amountUsd: number;
  resourceId: string;
  timestamp: number;
  tags: Record<string, string>;
}

export interface CostSummary {
  totalUsd: number;
  byService: Record<string, number>;
  byTeam: Record<string, number>;
  byCategory: Record<string, number>;
  eventCount: number;
}

const events: CostEvent[] = [];
let eventCounter = 0;

export function recordCostEvent(params: Omit<CostEvent, "eventId" | "timestamp">): CostEvent {
  const event: CostEvent = {
    ...params,
    eventId: `cost-${++eventCounter}`,
    timestamp: Date.now(),
  };
  events.push(event);
  return event;
}

export function getCostSummary(fromTimestamp?: number, toTimestamp?: number): CostSummary {
  const filtered = events.filter(e => {
    if (fromTimestamp && e.timestamp < fromTimestamp) return false;
    if (toTimestamp && e.timestamp > toTimestamp) return false;
    return true;
  });

  const summary: CostSummary = { totalUsd: 0, byService: {}, byTeam: {}, byCategory: {}, eventCount: filtered.length };
  for (const e of filtered) {
    summary.totalUsd += e.amountUsd;
    summary.byService[e.service] = (summary.byService[e.service] ?? 0) + e.amountUsd;
    summary.byTeam[e.team] = (summary.byTeam[e.team] ?? 0) + e.amountUsd;
    summary.byCategory[e.category] = (summary.byCategory[e.category] ?? 0) + e.amountUsd;
  }
  return summary;
}

export function getCostEvents(): CostEvent[] { return [...events]; }
export function _resetCostTrackerForTest(): void { events.length = 0; eventCounter = 0; }
