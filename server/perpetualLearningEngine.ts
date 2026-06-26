/**
 * perpetualLearningEngine.ts — v55.0.0 "The Grand Unification"
 *
 * Continuously learns from agent interactions, outcomes, and feedback.
 * Maintains a growing knowledge base of patterns, strategies, and heuristics.
 */

export interface LearningEvent {
  eventId: string;
  domain: string;
  input: unknown;
  output: unknown;
  outcome: "success" | "failure" | "partial";
  reward: number;   // -1.0 to 1.0
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface LearnedPattern {
  patternId: string;
  domain: string;
  description: string;
  occurrences: number;
  avgReward: number;
  confidence: number;
  lastUpdated: number;
}

export interface LearningStats {
  totalEvents: number;
  successRate: number;
  avgReward: number;
  topDomains: Array<{ domain: string; events: number; avgReward: number }>;
  patterns: number;
}

const events: LearningEvent[] = [];
const patterns = new Map<string, LearnedPattern>();
let eventCounter = 0;
let patternCounter = 0;

export function recordLearningEvent(
  domain: string,
  input: unknown,
  output: unknown,
  outcome: LearningEvent["outcome"],
  reward: number,
  metadata?: Record<string, unknown>
): LearningEvent {
  const event: LearningEvent = {
    eventId: `evt-${++eventCounter}`,
    domain,
    input,
    output,
    outcome,
    reward: Math.max(-1, Math.min(1, reward)),
    timestamp: Date.now(),
    metadata,
  };
  events.push(event);
  updatePatterns(event);
  return event;
}

export function getLearnedPatterns(domain?: string): LearnedPattern[] {
  const all = Array.from(patterns.values());
  return domain ? all.filter(p => p.domain === domain) : all;
}

export function getLearningStats(): LearningStats {
  const total = events.length;
  const successes = events.filter(e => e.outcome === "success").length;
  const avgReward = total > 0 ? events.reduce((s, e) => s + e.reward, 0) / total : 0;

  const domainMap = new Map<string, { count: number; totalReward: number }>();
  for (const e of events) {
    if (!domainMap.has(e.domain)) domainMap.set(e.domain, { count: 0, totalReward: 0 });
    const d = domainMap.get(e.domain)!;
    d.count++;
    d.totalReward += e.reward;
  }

  const topDomains = Array.from(domainMap.entries())
    .map(([domain, d]) => ({ domain, events: d.count, avgReward: d.totalReward / d.count }))
    .sort((a, b) => b.events - a.events)
    .slice(0, 5);

  return { totalEvents: total, successRate: total > 0 ? successes / total : 0, avgReward, topDomains, patterns: patterns.size };
}

function updatePatterns(event: LearningEvent): void {
  const key = `${event.domain}:${event.outcome}`;
  if (!patterns.has(key)) {
    patterns.set(key, {
      patternId: `pat-${++patternCounter}`,
      domain: event.domain,
      description: `${event.outcome} pattern in ${event.domain}`,
      occurrences: 0,
      avgReward: 0,
      confidence: 0,
      lastUpdated: Date.now(),
    });
  }
  const p = patterns.get(key)!;
  const n = p.occurrences;
  p.avgReward = (p.avgReward * n + event.reward) / (n + 1);
  p.occurrences++;
  p.confidence = Math.min(1.0, p.occurrences / 100);
  p.lastUpdated = Date.now();
}

export function _resetPerpetualLearningForTest(): void {
  events.length = 0;
  patterns.clear();
  eventCounter = 0;
  patternCounter = 0;
}
