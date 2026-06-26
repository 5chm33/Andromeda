/**
 * agentCollectiveIntelligence.ts — v50.0.0
 *
 * Aggregates distributed agent observations into collective insights
 * using voting, weighted averaging, and consensus mechanisms.
 */

export interface Observation {
  agentId: string;
  topic: string;
  value: number;      // normalized 0.0–1.0
  confidence: number; // 0.0–1.0
  timestamp: number;
}

export interface CollectiveInsight {
  topic: string;
  aggregatedValue: number;
  confidence: number;
  observationCount: number;
  consensus: boolean;  // true if std dev < 0.15
  method: "weighted-avg" | "majority-vote" | "median";
}

const observations: Observation[] = [];

export function submitObservation(agentId: string, topic: string, value: number, confidence: number): void {
  observations.push({ agentId, topic, value: Math.max(0, Math.min(1, value)), confidence: Math.max(0, Math.min(1, confidence)), timestamp: Date.now() });
}

export function aggregateInsight(topic: string, method: CollectiveInsight["method"] = "weighted-avg"): CollectiveInsight | null {
  const relevant = observations.filter(o => o.topic === topic);
  if (relevant.length === 0) return null;

  let aggregatedValue: number;
  let confidence: number;

  if (method === "weighted-avg") {
    const totalWeight = relevant.reduce((s, o) => s + o.confidence, 0);
    aggregatedValue = totalWeight > 0
      ? relevant.reduce((s, o) => s + o.value * o.confidence, 0) / totalWeight
      : relevant.reduce((s, o) => s + o.value, 0) / relevant.length;
    confidence = totalWeight / relevant.length;
  } else if (method === "majority-vote") {
    const votes: number[] = relevant.map(o => o.value > 0.5 ? 1 : 0);
    const positiveVotes = votes.reduce((s: number, v: number) => s + v, 0);
    aggregatedValue = positiveVotes / votes.length;
    confidence = Math.abs(aggregatedValue - 0.5) * 2;
  } else {
    // median
    const sorted = [...relevant].sort((a, b) => a.value - b.value);
    const mid = Math.floor(sorted.length / 2);
    aggregatedValue = sorted.length % 2 === 0
      ? (sorted[mid - 1].value + sorted[mid].value) / 2
      : sorted[mid].value;
    confidence = relevant.reduce((s, o) => s + o.confidence, 0) / relevant.length;
  }

  // Compute std dev for consensus check
  const mean = aggregatedValue;
  const variance = relevant.reduce((s, o) => s + Math.pow(o.value - mean, 2), 0) / relevant.length;
  const stdDev = Math.sqrt(variance);

  return {
    topic,
    aggregatedValue,
    confidence,
    observationCount: relevant.length,
    consensus: stdDev < 0.15,
    method,
  };
}

export function getObservationCount(topic: string): number {
  return observations.filter(o => o.topic === topic).length;
}

export function _resetCollectiveIntelligenceForTest(): void {
  observations.length = 0;
}
