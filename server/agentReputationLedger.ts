/**
 * agentReputationLedger.ts — v46.0.0
 *
 * Immutable append-only ledger tracking reputation events for all sub-agents.
 * Uses exponential decay to weight recent performance more heavily.
 */

export type ReputationEventType =
  | "task_success"
  | "task_failure"
  | "peer_endorsement"
  | "peer_complaint"
  | "timeout"
  | "safety_violation";

export interface ReputationEvent {
  eventId: string;
  agentId: string;
  type: ReputationEventType;
  impact: number;       // signed delta to raw score
  description: string;
  timestamp: number;
}

export interface ReputationSummary {
  agentId: string;
  rawScore: number;       // sum of all impacts
  decayedScore: number;   // exponentially decayed, 0.0–1.0
  totalEvents: number;
  successRate: number;
  tier: "bronze" | "silver" | "gold" | "platinum";
}

const IMPACT_MAP: Record<ReputationEventType, number> = {
  task_success: +2,
  task_failure: -5,
  peer_endorsement: +1,
  peer_complaint: -3,
  timeout: -4,
  safety_violation: -20,
};

const DECAY_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const ledger: ReputationEvent[] = [];
let eventCounter = 0;

export function recordEvent(
  agentId: string,
  type: ReputationEventType,
  description = ""
): ReputationEvent {
  const event: ReputationEvent = {
    eventId: `rep-${++eventCounter}-${Date.now()}`,
    agentId,
    type,
    impact: IMPACT_MAP[type],
    description,
    timestamp: Date.now(),
  };
  ledger.push(event);
  return event;
}

export function getReputation(agentId: string): ReputationSummary {
  const agentEvents = ledger.filter(e => e.agentId === agentId);
  const now = Date.now();

  let rawScore = 0;
  let decayedScore = 0;

  for (const event of agentEvents) {
    rawScore += event.impact;
    const ageMs = now - event.timestamp;
    const decayFactor = Math.pow(0.5, ageMs / DECAY_HALF_LIFE_MS);
    decayedScore += event.impact * decayFactor;
  }

  // Normalize decayed score to 0–1 range (sigmoid-like)
  const normalized = 1 / (1 + Math.exp(-decayedScore / 10));

  const successes = agentEvents.filter(e => e.type === "task_success").length;
  const failures = agentEvents.filter(e => e.type === "task_failure").length;
  const total = successes + failures;
  const successRate = total > 0 ? successes / total : 0.5;

  let tier: ReputationSummary["tier"];
  if (normalized >= 0.85) tier = "platinum";
  else if (normalized >= 0.7) tier = "gold";
  else if (normalized >= 0.55) tier = "silver";
  else tier = "bronze";

  return {
    agentId,
    rawScore,
    decayedScore: Math.round(normalized * 1000) / 1000,
    totalEvents: agentEvents.length,
    successRate: Math.round(successRate * 1000) / 1000,
    tier,
  };
}

export function getTopAgents(limit = 10): ReputationSummary[] {
  const agentIds = [...new Set(ledger.map(e => e.agentId))];
  return agentIds
    .map(id => getReputation(id))
    .sort((a, b) => b.decayedScore - a.decayedScore)
    .slice(0, limit);
}

export function getLedgerForAgent(agentId: string): ReputationEvent[] {
  return ledger.filter(e => e.agentId === agentId);
}

export function _resetLedgerForTest(): void {
  ledger.length = 0;
  eventCounter = 0;
}
