/**
 * temporalSelfModel.ts — v23.0.0
 * 
 * Temporal Self-Awareness.
 * Maintains a time-series of capability metrics and fits a predictive model
 * to forecast future performance and prioritize high-impact improvements.
 */

import * as fs from "fs";
import * as path from "path";

export interface CapabilitySnapshot {
  timestamp: number;
  acceptanceRate: number;
  testCoverage: number;
  benchmarkScore: number;
  tsErrors: number;
}

const TEMPORAL_STATE_FILE = path.join(process.cwd(), ".temporal_state.json");

export function initTemporalSelfModel(): void {
  if (!fs.existsSync(TEMPORAL_STATE_FILE)) {
    fs.writeFileSync(TEMPORAL_STATE_FILE, JSON.stringify({ snapshots: [] }, null, 2));
  }
}

function getTemporalState(): { snapshots: CapabilitySnapshot[] } {
  try {
    return JSON.parse(fs.readFileSync(TEMPORAL_STATE_FILE, "utf-8"));
  } catch {
    return { snapshots: [] };
  }
}

/**
 * Records a new snapshot of the system's capabilities.
 */
export function recordCapabilitySnapshot(snapshot: Omit<CapabilitySnapshot, "timestamp">): void {
  const state = getTemporalState();
  state.snapshots.push({
    ...snapshot,
    timestamp: Date.now()
  });
  
  // Keep only the last 30 days (assuming 1 snapshot per hour = 720 snapshots)
  if (state.snapshots.length > 720) {
    state.snapshots = state.snapshots.slice(-720);
  }
  
  fs.writeFileSync(TEMPORAL_STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Forecasts the acceptance rate for a given number of days in the future
 * using simple linear regression over the historical snapshots.
 */
export function forecastAcceptanceRate(daysAhead: number = 30): number {
  const state = getTemporalState();
  if (state.snapshots.length < 2) return 0.99; // Default fallback
  
  const n = state.snapshots.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  
  // Normalize timestamps to days relative to the first snapshot
  const t0 = state.snapshots[0].timestamp;
  const msPerDay = 1000 * 60 * 60 * 24;
  
  for (const s of state.snapshots) {
    const x = (s.timestamp - t0) / msPerDay;
    const y = s.acceptanceRate;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }
  
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  
  const targetX = ((Date.now() - t0) / msPerDay) + daysAhead;
  
  // Cap at 1.0 (100%)
  return Math.min(1.0, Math.max(0, intercept + slope * targetX));
}
