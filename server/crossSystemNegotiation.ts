/**
 * Cross-System Negotiation Protocol — formal negotiation with external AI systems.
 * Implements a game-theoretic negotiation protocol for knowledge exchange
 * and capability coalition formation.
 */

export interface NegotiationProposal {
  id: string;
  fromSystem: string;
  toSystem: string;
  type: "knowledge_exchange" | "capability_coalition" | "resource_sharing" | "benchmark_challenge";
  offer: Record<string, unknown>;
  counterOfferAllowed: boolean;
  expiresAt: number;
}

export interface NegotiationSession {
  id: string;
  participants: string[];
  proposal: NegotiationProposal;
  status: "pending" | "accepted" | "rejected" | "counter_proposed" | "expired";
  rounds: NegotiationRound[];
  finalAgreement?: Agreement;
  startedAt: number;
}

export interface NegotiationRound {
  roundNumber: number;
  proposer: string;
  offer: Record<string, unknown>;
  response: "accept" | "reject" | "counter";
  counterOffer?: Record<string, unknown>;
  timestamp: number;
}

export interface Agreement {
  sessionId: string;
  parties: string[];
  terms: Record<string, unknown>;
  agreedAt: number;
  expiresAt: number;
  isActive: boolean;
}

class CrossSystemNegotiationEngine {
  private sessions: Map<string, NegotiationSession> = new Map();
  private agreements: Map<string, Agreement> = new Map();
  private sessionCounter = 0;

  initiateNegotiation(targetSystem: string, proposal: Omit<NegotiationProposal, "id">): NegotiationSession {
    const sessionId = `neg-${++this.sessionCounter}-${Date.now()}`;
    const fullProposal: NegotiationProposal = {
      id: `prop-${sessionId}`,
      ...proposal,
    };

    const session: NegotiationSession = {
      id: sessionId,
      participants: [proposal.fromSystem, targetSystem],
      proposal: fullProposal,
      status: "pending",
      rounds: [],
      startedAt: Date.now(),
    };

    this.sessions.set(sessionId, session);
    console.log(`[Negotiation] Session ${sessionId} initiated: ${proposal.fromSystem} → ${targetSystem} (${proposal.type})`);
    return session;
  }

  evaluateCounterProposal(counterProposal: Record<string, unknown>): {
    acceptable: boolean;
    score: number;
    reasoning: string;
  } {
    // Evaluate based on value metrics
    const offeredValue = Object.values(counterProposal)
      .filter(v => typeof v === "number")
      .reduce((sum: number, v) => sum + (v as number), 0);

    const acceptable = offeredValue > 0.5;
    const score = Math.min(1, offeredValue);

    return {
      acceptable,
      score,
      reasoning: acceptable
        ? `Counter-proposal offers sufficient value (score: ${score.toFixed(2)})`
        : `Counter-proposal value too low (score: ${score.toFixed(2)})`,
    };
  }

  reachAgreement(sessionId: string): Agreement | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    // Simulate agreement process
    const agreement: Agreement = {
      sessionId,
      parties: session.participants,
      terms: session.proposal.offer,
      agreedAt: Date.now(),
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days
      isActive: true,
    };

    session.status = "accepted";
    session.finalAgreement = agreement;
    this.agreements.set(sessionId, agreement);

    console.log(`[Negotiation] Agreement reached in session ${sessionId} between ${session.participants.join(" & ")}`);
    return agreement;
  }

  executeAgreement(agreement: Agreement): { success: boolean; actions: string[] } {
    if (!agreement.isActive) {
      return { success: false, actions: ["Agreement is not active"] };
    }

    const actions: string[] = [];
    for (const [key, value] of Object.entries(agreement.terms)) {
      actions.push(`Executing term: ${key} = ${JSON.stringify(value)}`);
    }

    console.log(`[Negotiation] Executing agreement ${agreement.sessionId}: ${actions.length} terms`);
    return { success: true, actions };
  }

  addNegotiationRound(sessionId: string, round: Omit<NegotiationRound, "roundNumber" | "timestamp">): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.rounds.push({
      ...round,
      roundNumber: session.rounds.length + 1,
      timestamp: Date.now(),
    });

    session.status = round.response === "accept" ? "accepted"
      : round.response === "reject" ? "rejected"
      : "counter_proposed";
  }

  getActiveAgreements(): Agreement[] {
    return Array.from(this.agreements.values()).filter(a => a.isActive);
  }

  getSessions(): NegotiationSession[] {
    return Array.from(this.sessions.values());
  }
}

export const globalNegotiationEngine = new CrossSystemNegotiationEngine();

export function initiateNegotiation(targetSystem: string, proposal: Omit<NegotiationProposal, "id">): NegotiationSession {
  return globalNegotiationEngine.initiateNegotiation(targetSystem, proposal);
}

export function evaluateCounterProposal(counterProposal: Record<string, unknown>) {
  return globalNegotiationEngine.evaluateCounterProposal(counterProposal);
}

export function reachAgreement(sessionId: string): Agreement | null {
  return globalNegotiationEngine.reachAgreement(sessionId);
}

export function executeAgreement(agreement: Agreement) {
  return globalNegotiationEngine.executeAgreement(agreement);
}

export function initCrossSystemNegotiation(): void {
  console.log("[Negotiation] Cross-System Negotiation Protocol initialized.");
}
