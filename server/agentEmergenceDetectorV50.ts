/**
 * agentEmergenceDetectorV50.ts — v50.0.0
 *
 * Detects emergent behaviors in the sub-agent economy that were not
 * explicitly programmed: unexpected collaboration patterns, novel strategies,
 * and self-organizing behaviors.
 */

export interface EmergentPattern {
  patternId: string;
  type: "collaboration" | "specialization" | "market-formation" | "knowledge-cascade" | "collective-decision";
  description: string;
  involvedAgents: string[];
  strength: number;   // 0.0–1.0
  novelty: number;    // 0.0–1.0 (how unexpected)
  detectedAt: number;
}

export interface BehaviorSignal {
  agentId: string;
  behavior: string;
  frequency: number;
  associatedAgents: string[];
  timestamp: number;
}

const signals: BehaviorSignal[] = [];
const patterns: EmergentPattern[] = [];
let patternCounter = 0;

export function recordBehaviorSignal(signal: BehaviorSignal): void {
  signals.push({ ...signal });
  detectPatterns();
}

function detectPatterns(): void {
  // Detect collaboration: multiple agents sharing the same behavior
  const behaviorGroups = new Map<string, string[]>();
  for (const sig of signals) {
    const group = behaviorGroups.get(sig.behavior) ?? [];
    if (!group.includes(sig.agentId)) group.push(sig.agentId);
    behaviorGroups.set(sig.behavior, group);
  }

  for (const [behavior, agents] of behaviorGroups) {
    if (agents.length >= 3) {
      const existing = patterns.find(p => p.type === "collaboration" && p.description.includes(behavior));
      if (!existing) {
        patterns.push({
          patternId: `ep-${++patternCounter}`,
          type: "collaboration",
          description: `Emergent collaboration around "${behavior}"`,
          involvedAgents: agents,
          strength: Math.min(1.0, agents.length / 10),
          novelty: 0.7,
          detectedAt: Date.now(),
        });
      }
    }
  }

  // Detect knowledge cascade: same behavior spreading across associated agents
  for (const sig of signals) {
    if (sig.associatedAgents.length >= 2 && sig.frequency > 3) {
      const existing = patterns.find(p => p.type === "knowledge-cascade" && p.involvedAgents.includes(sig.agentId));
      if (!existing) {
        patterns.push({
          patternId: `ep-${++patternCounter}`,
          type: "knowledge-cascade",
          description: `Knowledge cascade from ${sig.agentId} via "${sig.behavior}"`,
          involvedAgents: [sig.agentId, ...sig.associatedAgents],
          strength: Math.min(1.0, sig.frequency / 10),
          novelty: 0.8,
          detectedAt: Date.now(),
        });
      }
    }
  }
}

export function getPatterns(type?: EmergentPattern["type"]): EmergentPattern[] {
  return type ? patterns.filter(p => p.type === type) : [...patterns];
}

export function getNoveltyScore(): number {
  if (patterns.length === 0) return 0;
  return patterns.reduce((s, p) => s + p.novelty, 0) / patterns.length;
}

export function _resetEmergenceDetectorV50ForTest(): void {
  signals.length = 0;
  patterns.length = 0;
  patternCounter = 0;
}
