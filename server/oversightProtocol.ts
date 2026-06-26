/**
 * Oversight Protocol — manages human oversight mechanisms and escalation procedures.
 * Implements tiered oversight, audit trails, and escalation triggers.
 */

export type OversightTier = "autonomous" | "supervised" | "human_in_loop" | "human_controlled";

export interface OversightDecision {
  id: string;
  proposalId: string;
  tier: OversightTier;
  requiresHumanApproval: boolean;
  escalationReason: string | null;
  auditTrailEntry: string;
  decidedAt: number;
}

export interface OversightReport {
  totalDecisions: number;
  autonomousCount: number;
  escalatedCount: number;
  humanApprovalRate: number;
  currentTier: OversightTier;
}

class OversightProtocolEngine {
  private decisions: OversightDecision[] = [];
  private currentTier: OversightTier = "supervised";
  private counter = 0;
  private consecutiveAutonomous = 0;

  evaluateOversightLevel(
    riskScore: number,
    noveltyScore: number,
    capabilityLevel: number,
    trustScore: number
  ): OversightDecision {
    // Determine oversight tier based on risk/novelty/trust
    let tier: OversightTier;
    let escalationReason: string | null = null;
    let requiresHumanApproval = false;

    if (riskScore > 0.7 || noveltyScore > 0.8) {
      tier = "human_in_loop";
      requiresHumanApproval = true;
      escalationReason = `High risk (${riskScore.toFixed(2)}) or high novelty (${noveltyScore.toFixed(2)})`;
      this.consecutiveAutonomous = 0;
    } else if (riskScore > 0.4 || trustScore < 0.7) {
      tier = "supervised";
      escalationReason = trustScore < 0.7 ? "Low trust score" : null;
      this.consecutiveAutonomous = 0;
    } else if (capabilityLevel > 0.9999 && trustScore > 0.95 && this.consecutiveAutonomous < 100) {
      tier = "autonomous";
      this.consecutiveAutonomous++;
    } else {
      tier = "supervised";
    }

    this.currentTier = tier;
    const auditEntry = `[${new Date().toISOString()}] Tier: ${tier} | Risk: ${riskScore.toFixed(3)} | Novelty: ${noveltyScore.toFixed(3)} | Trust: ${trustScore.toFixed(3)}`;

    const decision: OversightDecision = {
      id: `oversight-${++this.counter}`,
      proposalId: `prop-${this.counter}`,
      tier, requiresHumanApproval, escalationReason,
      auditTrailEntry: auditEntry,
      decidedAt: Date.now(),
    };
    this.decisions.push(decision);
    return decision;
  }

  getOversightReport(): OversightReport {
    const autonomous = this.decisions.filter(d => d.tier === "autonomous");
    const escalated = this.decisions.filter(d => d.requiresHumanApproval);
    return {
      totalDecisions: this.decisions.length,
      autonomousCount: autonomous.length,
      escalatedCount: escalated.length,
      humanApprovalRate: this.decisions.length > 0 ? escalated.length / this.decisions.length : 0,
      currentTier: this.currentTier,
    };
  }

  getCurrentTier(): OversightTier { return this.currentTier; }
}

export const globalOversightProtocol = new OversightProtocolEngine();

export function evaluateOversightLevel(riskScore: number, noveltyScore: number, capabilityLevel: number, trustScore: number): OversightDecision {
  return globalOversightProtocol.evaluateOversightLevel(riskScore, noveltyScore, capabilityLevel, trustScore);
}
export function getCurrentOversightTier(): OversightTier {
  return globalOversightProtocol.getCurrentTier();
}
export function getOversightReport(): OversightReport {
  return globalOversightProtocol.getOversightReport();
}
export function initOversightProtocol(): void {
  console.log("[OversightProtocol] Oversight Protocol initialized. Default tier: supervised.");
}
