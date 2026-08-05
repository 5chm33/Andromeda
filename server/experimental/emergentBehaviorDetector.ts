/**
 * emergentBehaviorDetector.ts — v99.0.0 "Collective Intelligence & Swarm Cognition"
 * Detects emergent patterns and behaviors arising from collective agent interactions.
 */
export type EmergentPattern = "flocking" | "clustering" | "oscillation" | "consensus" | "divergence" | "synchronization" | "unknown";
export interface AgentObservation { agentId: string; position: { x: number; y: number }; velocity: { vx: number; vy: number }; state: string; timestamp: number; }
export interface EmergentEvent {
  eventId: string;
  pattern: EmergentPattern;
  involvedAgents: string[];
  confidence: number;
  metrics: Record<string, number>;
  detectedAt: number;
}

const observations: AgentObservation[] = [];
const events: EmergentEvent[] = [];
let eventCounter = 0;

export function recordObservation(agentId: string, position: { x: number; y: number }, velocity: { vx: number; vy: number }, state: string): void {
  observations.push({ agentId, position, velocity, state, timestamp: Date.now() });
}

export function detectEmergence(windowSize = 100): EmergentEvent[] {
  const recent = observations.slice(-windowSize);
  if (recent.length < 3) return [];
  const newEvents: EmergentEvent[] = [];

  // Flocking: agents moving in similar directions
  const avgVx = recent.reduce((s, o) => s + o.velocity.vx, 0) / recent.length;
  const avgVy = recent.reduce((s, o) => s + o.velocity.vy, 0) / recent.length;
  const velVariance = recent.reduce((s, o) => s + (o.velocity.vx - avgVx) ** 2 + (o.velocity.vy - avgVy) ** 2, 0) / recent.length;
  if (velVariance < 0.5) {
    const e: EmergentEvent = { eventId: `ee-${++eventCounter}`, pattern: "flocking", involvedAgents: [...new Set(recent.map(o => o.agentId))], confidence: Math.max(0, 1 - velVariance), metrics: { velocityVariance: velVariance, avgVx, avgVy }, detectedAt: Date.now() };
    events.push(e); newEvents.push(e);
  }

  // Consensus: agents in same state
  const states = recent.map(o => o.state);
  const stateCounts = states.reduce((m, s) => { m[s] = (m[s] ?? 0) + 1; return m; }, {} as Record<string, number>);
  const maxCount = Math.max(...Object.values(stateCounts));
  if (maxCount / recent.length > 0.8) {
    const dominantState = Object.entries(stateCounts).find(([, c]) => c === maxCount)![0];
    const e: EmergentEvent = { eventId: `ee-${++eventCounter}`, pattern: "consensus", involvedAgents: recent.filter(o => o.state === dominantState).map(o => o.agentId), confidence: maxCount / recent.length, metrics: { consensusRatio: maxCount / recent.length }, detectedAt: Date.now() };
    events.push(e); newEvents.push(e);
  }

  return newEvents;
}

export function getEvents(pattern?: EmergentPattern): EmergentEvent[] { return pattern ? events.filter(e => e.pattern === pattern) : [...events]; }
export function _resetEmergentBehaviorDetectorForTest(): void { observations.length = 0; events.length = 0; eventCounter = 0; }
