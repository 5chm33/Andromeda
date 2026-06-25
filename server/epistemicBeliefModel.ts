/**
 * epistemicBeliefModel.ts — Epistemic Belief Modeling for Swarm Agents
 * Andromeda v11.0.0 — Phase 12: Gödel Ascension
 *
 * Implements Theory of Mind / Epistemic Logic for the Andromeda swarm.
 * Each swarm agent maintains a "belief state" — a probabilistic model of
 * what other agents know, believe, and intend. This enables:
 *
 *   1. Structured, formal debates before RSI consensus is reached
 *   2. Detection of Byzantine agents (agents with inconsistent beliefs)
 *   3. Optimal information sharing (only share what others don't know)
 *   4. Epistemic trust scoring (how reliable is agent X's belief about Y?)
 *
 * Architecture:
 *   - Belief: a proposition with a probability (0.0–1.0)
 *   - BeliefState: an agent's full set of beliefs about the world
 *   - EpistemicModel: the full model of all agents' belief states
 *   - DebateProtocol: structured argumentation for RSI proposal evaluation
 *
 * Epistemic operators (Kripke semantics):
 *   - K(agent, p): agent "knows" proposition p (P >= 0.95)
 *   - B(agent, p): agent "believes" proposition p (P >= 0.7)
 *   - D(agent, p): agent "doubts" proposition p (P < 0.5)
 *   - Common Knowledge: all agents know p AND all agents know that all agents know p
 */

import { createLogger } from "./logger.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const log = createLogger("epistemicBeliefModel");

// ── Types ─────────────────────────────────────────────────────────────────────

export type EpistemicOperator = "knows" | "believes" | "doubts" | "ignores";

export interface Belief {
  proposition: string;
  probability: number;      // 0.0–1.0
  confidence: number;       // How confident is the agent in this probability?
  evidence: string[];       // Supporting evidence IDs
  lastUpdated: number;
}

export interface BeliefState {
  agentId: string;
  beliefs: Map<string, Belief>;
  /** Beliefs about other agents' beliefs: agentId -> proposition -> probability */
  metaBeliefs: Map<string, Map<string, number>>;
  trustScores: Map<string, number>;  // agentId -> trust (0.0–1.0)
  lastSyncAt: number;
}

export interface DebateArgument {
  id: string;
  agentId: string;
  proposition: string;
  stance: "for" | "against" | "neutral";
  strength: number;          // 0.0–1.0
  evidence: string[];
  rebuttalTo?: string;       // ID of argument being rebutted
  timestamp: number;
}

export interface DebateRound {
  id: string;
  topic: string;
  proposalId: string;
  arguments: DebateArgument[];
  startedAt: number;
  endedAt?: number;
  verdict?: "approved" | "rejected" | "deferred";
  consensusProbability?: number;
}

export interface EpistemicConsensus {
  proposition: string;
  commonKnowledge: boolean;
  averageBelief: number;
  beliefVariance: number;
  dissenterCount: number;
  dissenterIds: string[];
  confidence: number;
}

// ── Epistemic Operators ───────────────────────────────────────────────────────

export function getEpistemicOperator(probability: number): EpistemicOperator {
  if (probability >= 0.95) return "knows";
  if (probability >= 0.70) return "believes";
  if (probability >= 0.50) return "doubts";
  return "ignores";
}

// ── Belief State ──────────────────────────────────────────────────────────────

export class AgentBeliefState {
  private state: BeliefState;

  constructor(agentId: string) {
    this.state = {
      agentId,
      beliefs: new Map(),
      metaBeliefs: new Map(),
      trustScores: new Map(),
      lastSyncAt: Date.now(),
    };
  }

  getAgentId(): string {
    return this.state.agentId;
  }

  // ── Belief Management ───────────────────────────────────────────────────────

  setBelief(proposition: string, probability: number, evidence: string[] = []): void {
    const existing = this.state.beliefs.get(proposition);
    const confidence = existing
      ? Math.min(1.0, existing.confidence + 0.1)
      : 0.5;

    this.state.beliefs.set(proposition, {
      proposition,
      probability: Math.min(1.0, Math.max(0.0, probability)),
      confidence,
      evidence,
      lastUpdated: Date.now(),
    });
  }

  getBelief(proposition: string): Belief | undefined {
    return this.state.beliefs.get(proposition);
  }

  getBeliefProbability(proposition: string): number {
    return this.state.beliefs.get(proposition)?.probability ?? 0.5;
  }

  getEpistemicStatus(proposition: string): EpistemicOperator {
    const prob = this.getBeliefProbability(proposition);
    return getEpistemicOperator(prob);
  }

  getAllBeliefs(): Belief[] {
    return Array.from(this.state.beliefs.values());
  }

  // ── Meta-Beliefs (beliefs about other agents' beliefs) ──────────────────────

  setMetaBelief(targetAgentId: string, proposition: string, probability: number): void {
    if (!this.state.metaBeliefs.has(targetAgentId)) {
      this.state.metaBeliefs.set(targetAgentId, new Map());
    }
    this.state.metaBeliefs.get(targetAgentId)!.set(proposition, probability);
  }

  getMetaBelief(targetAgentId: string, proposition: string): number {
    return this.state.metaBeliefs.get(targetAgentId)?.get(proposition) ?? 0.5;
  }

  // ── Trust Scoring ───────────────────────────────────────────────────────────

  setTrust(agentId: string, trust: number): void {
    this.state.trustScores.set(agentId, Math.min(1.0, Math.max(0.0, trust)));
  }

  getTrust(agentId: string): number {
    return this.state.trustScores.get(agentId) ?? 0.5;
  }

  /**
   * Update trust based on whether an agent's prediction was correct.
   */
  updateTrust(agentId: string, wasCorrect: boolean): void {
    const current = this.getTrust(agentId);
    const delta = wasCorrect ? 0.05 : -0.1;  // Faster trust loss than gain
    this.setTrust(agentId, current + delta);
  }

  // ── Bayesian Belief Update ──────────────────────────────────────────────────

  /**
   * Update belief using Bayes' theorem given new evidence.
   * P(H|E) = P(E|H) * P(H) / P(E)
   */
  bayesianUpdate(proposition: string, likelihoodGivenTrue: number, likelihoodGivenFalse: number): void {
    const prior = this.getBeliefProbability(proposition);
    const pEvidence = likelihoodGivenTrue * prior + likelihoodGivenFalse * (1 - prior);
    if (pEvidence === 0) return;

    const posterior = (likelihoodGivenTrue * prior) / pEvidence;
    this.setBelief(proposition, posterior);
  }

  toJSON(): BeliefState {
    return {
      ...this.state,
      beliefs: this.state.beliefs,
      metaBeliefs: this.state.metaBeliefs,
      trustScores: this.state.trustScores,
    };
  }
}

// ── Epistemic Model ───────────────────────────────────────────────────────────

export class EpistemicModel {
  private agents = new Map<string, AgentBeliefState>();
  private debates = new Map<string, DebateRound>();
  private dataDir: string;

  constructor(dataDir?: string) {
    this.dataDir = dataDir ?? join(process.cwd(), "data", "epistemic");
    mkdirSync(this.dataDir, { recursive: true });
  }

  // ── Agent Management ────────────────────────────────────────────────────────

  registerAgent(agentId: string): AgentBeliefState {
    if (!this.agents.has(agentId)) {
      this.agents.set(agentId, new AgentBeliefState(agentId));
      log.info(`[epistemic] Agent registered: ${agentId}`);
    }
    return this.agents.get(agentId)!;
  }

  getAgent(agentId: string): AgentBeliefState | undefined {
    return this.agents.get(agentId);
  }

  getAgentIds(): string[] {
    return Array.from(this.agents.keys());
  }

  removeAgent(agentId: string): void {
    this.agents.delete(agentId);
  }

  // ── Common Knowledge ────────────────────────────────────────────────────────

  /**
   * Compute epistemic consensus across all agents for a proposition.
   * Returns whether it constitutes "common knowledge" (all agents know it).
   */
  computeConsensus(proposition: string): EpistemicConsensus {
    const agentIds = this.getAgentIds();
    if (agentIds.length === 0) {
      return {
        proposition,
        commonKnowledge: false,
        averageBelief: 0.5,
        beliefVariance: 0,
        dissenterCount: 0,
        dissenterIds: [],
        confidence: 0,
      };
    }

    const beliefs = agentIds.map(id => ({
      agentId: id,
      prob: this.agents.get(id)!.getBeliefProbability(proposition),
    }));

    const avgBelief = beliefs.reduce((s, b) => s + b.prob, 0) / beliefs.length;
    const variance = beliefs.reduce((s, b) => s + Math.pow(b.prob - avgBelief, 2), 0) / beliefs.length;

    // Dissenters: agents whose belief differs significantly from average
    const dissenters = beliefs.filter(b => Math.abs(b.prob - avgBelief) > 0.2);

    // Common knowledge: all agents "know" the proposition (P >= 0.95)
    const commonKnowledge = beliefs.every(b => b.prob >= 0.95);

    return {
      proposition,
      commonKnowledge,
      averageBelief: avgBelief,
      beliefVariance: variance,
      dissenterCount: dissenters.length,
      dissenterIds: dissenters.map(d => d.agentId),
      confidence: Math.max(0, 1 - variance * 4),
    };
  }

  /**
   * Broadcast a belief to all agents (with trust-weighted update).
   */
  broadcastBelief(
    sourceAgentId: string,
    proposition: string,
    probability: number,
    evidence: string[] = []
  ): void {
    for (const [agentId, agent] of this.agents) {
      if (agentId === sourceAgentId) continue;

      const trust = agent.getTrust(sourceAgentId);
      const currentBelief = agent.getBeliefProbability(proposition);

      // Weighted update: trust determines how much the broadcast influences belief
      const newBelief = currentBelief + trust * (probability - currentBelief) * 0.3;
      agent.setBelief(proposition, newBelief, evidence);

      // Update meta-belief: this agent now knows what the source believes
      agent.setMetaBelief(sourceAgentId, proposition, probability);
    }
  }

  // ── Debate Protocol ─────────────────────────────────────────────────────────

  /**
   * Start a formal debate about an RSI proposal.
   */
  startDebate(proposalId: string, topic: string): DebateRound {
    const debate: DebateRound = {
      id: `debate_${Date.now()}`,
      topic,
      proposalId,
      arguments: [],
      startedAt: Date.now(),
    };
    this.debates.set(debate.id, debate);
    log.info(`[epistemic] Debate started: ${debate.id} — "${topic}"`);
    return debate;
  }

  /**
   * Submit an argument in a debate.
   */
  submitArgument(
    debateId: string,
    agentId: string,
    stance: "for" | "against" | "neutral",
    strength: number,
    evidence: string[],
    rebuttalTo?: string
  ): DebateArgument {
    const debate = this.debates.get(debateId);
    if (!debate) throw new Error(`Debate not found: ${debateId}`);

    const arg: DebateArgument = {
      id: `arg_${Date.now()}_${agentId}`,
      agentId,
      proposition: debate.topic,
      stance,
      strength: Math.min(1.0, Math.max(0.0, strength)),
      evidence,
      rebuttalTo,
      timestamp: Date.now(),
    };

    debate.arguments.push(arg);
    log.info(`[epistemic] Argument submitted: ${agentId} is ${stance} (strength=${strength.toFixed(2)})`);
    return arg;
  }

  /**
   * Resolve a debate by computing the weighted consensus.
   * Uses trust-weighted argument aggregation.
   */
  resolveDebate(debateId: string): DebateRound {
    const debate = this.debates.get(debateId);
    if (!debate) throw new Error(`Debate not found: ${debateId}`);

    // Compute weighted stance scores
    let forScore = 0;
    let againstScore = 0;
    let totalWeight = 0;

    for (const arg of debate.arguments) {
      const agent = this.agents.get(arg.agentId);
      const trustWeight = agent
        ? 0.5 + 0.5 * (Array.from(this.agents.values())
            .reduce((sum, a) => sum + a.getTrust(arg.agentId), 0) / Math.max(1, this.agents.size))
        : 0.5;

      const weight = arg.strength * trustWeight;
      totalWeight += weight;

      if (arg.stance === "for") forScore += weight;
      else if (arg.stance === "against") againstScore += weight;
    }

    const consensusProbability = totalWeight > 0 ? forScore / totalWeight : 0.5;

    debate.endedAt = Date.now();
    debate.consensusProbability = consensusProbability;
    debate.verdict = consensusProbability >= 0.6 ? "approved"
      : consensusProbability <= 0.4 ? "rejected"
      : "deferred";

    log.info(`[epistemic] Debate resolved: ${debate.id} → ${debate.verdict} (P=${consensusProbability.toFixed(3)})`);

    // Update agent beliefs based on debate outcome
    for (const [agentId, agent] of this.agents) {
      agent.bayesianUpdate(
        debate.topic,
        debate.verdict === "approved" ? 0.9 : 0.2,
        debate.verdict === "approved" ? 0.1 : 0.8
      );
    }

    return debate;
  }

  getDebate(debateId: string): DebateRound | undefined {
    return this.debates.get(debateId);
  }

  getDebates(): DebateRound[] {
    return Array.from(this.debates.values());
  }

  // ── Byzantine Detection ─────────────────────────────────────────────────────

  /**
   * Detect agents with inconsistent belief states (potential Byzantine agents).
   * An agent is suspicious if its beliefs consistently diverge from consensus.
   */
  detectByzantineAgents(threshold = 0.3): string[] {
    const suspicious: string[] = [];
    const propositions = new Set<string>();

    // Collect all known propositions
    for (const agent of this.agents.values()) {
      for (const belief of agent.getAllBeliefs()) {
        propositions.add(belief.proposition);
      }
    }

    for (const agentId of this.agents.keys()) {
      let divergenceScore = 0;
      let count = 0;

      for (const proposition of propositions) {
        const consensus = this.computeConsensus(proposition);
        const agentBelief = this.agents.get(agentId)!.getBeliefProbability(proposition);
        divergenceScore += Math.abs(agentBelief - consensus.averageBelief);
        count++;
      }

      const avgDivergence = count > 0 ? divergenceScore / count : 0;
      if (avgDivergence > threshold) {
        suspicious.push(agentId);
        log.warn(`[epistemic] Potential Byzantine agent: ${agentId} (divergence=${avgDivergence.toFixed(3)})`);
      }
    }

    return suspicious;
  }

  // ── Persistence ──────────────────────────────────────────────────────────────

  saveToDisk(): void {
    try {
      const data = {
        agents: Array.from(this.agents.entries()).map(([id, agent]) => ({
          id,
          beliefs: Array.from(agent.getAllBeliefs()),
        })),
        debates: Array.from(this.debates.values()),
      };
      writeFileSync(join(this.dataDir, "epistemic_model.json"), JSON.stringify(data, null, 2));
    } catch (err) {
      log.warn(`[epistemic] Failed to save: ${err}`);
    }
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _model: EpistemicModel | null = null;

export function getEpistemicModel(dataDir?: string): EpistemicModel {
  if (!_model) {
    _model = new EpistemicModel(dataDir);
  }
  return _model;
}

export function resetEpistemicModel(): void {
  _model = null;
}
