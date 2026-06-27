/**
 * agentElectionProtocol.ts — v86.0.0 "Multi-Agent Coordination"
 * Implements leader election protocol (Bully algorithm variant) for agent clusters.
 */
export type ElectionStatus = "idle" | "election_in_progress" | "leader_elected" | "leader_failed";

export interface ElectionParticipant {
  agentId: string;
  priority: number;
  isAlive: boolean;
  lastSeenAt: number;
}

export interface ElectionResult {
  electionId: string;
  leaderId: string;
  participantCount: number;
  electedAt: number;
  round: number;
}

const participants = new Map<string, ElectionParticipant>();
const electionHistory: ElectionResult[] = [];
let electionCounter = 0;
let currentLeaderId: string | null = null;
let electionStatus: ElectionStatus = "idle";

export function joinElection(agentId: string, priority: number): ElectionParticipant {
  const participant: ElectionParticipant = { agentId, priority, isAlive: true, lastSeenAt: Date.now() };
  participants.set(agentId, participant);
  return participant;
}

export function markAgentFailed(agentId: string): void {
  const p = participants.get(agentId);
  if (p) { p.isAlive = false; if (currentLeaderId === agentId) { currentLeaderId = null; electionStatus = "leader_failed"; } }
}

export function runElection(): ElectionResult | null {
  electionStatus = "election_in_progress";
  const alive = [...participants.values()].filter(p => p.isAlive);
  if (alive.length === 0) { electionStatus = "idle"; return null; }

  // Bully: highest priority wins
  const winner = alive.reduce((best, p) => p.priority > best.priority ? p : best);
  currentLeaderId = winner.agentId;
  electionStatus = "leader_elected";

  const result: ElectionResult = {
    electionId: `election-${++electionCounter}`,
    leaderId: winner.agentId,
    participantCount: alive.length,
    electedAt: Date.now(),
    round: electionCounter,
  };
  electionHistory.push(result);
  return result;
}

export function getCurrentLeader(): string | null { return currentLeaderId; }
export function getElectionStatus(): ElectionStatus { return electionStatus; }
export function getElectionHistory(): ElectionResult[] { return [...electionHistory]; }
export function getParticipantCount(): number { return participants.size; }
export function _resetAgentElectionProtocolForTest(): void { participants.clear(); electionHistory.length = 0; electionCounter = 0; currentLeaderId = null; electionStatus = "idle"; }
