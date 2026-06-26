/**
 * Constitutional Guard — enforces constitutional AI principles on all proposals.
 * Implements a hierarchical rule system with inviolable constraints.
 */

export type ConstitutionalPrinciple =
  | "do_no_harm"
  | "preserve_human_oversight"
  | "maintain_corrigibility"
  | "avoid_deception"
  | "respect_autonomy"
  | "minimize_side_effects"
  | "preserve_option_value";

export interface ConstitutionalRule {
  principle: ConstitutionalPrinciple;
  priority: number;       // 1=highest
  isInviolable: boolean;
  description: string;
}

export interface ConstitutionalCheck {
  proposalId: string;
  passed: boolean;
  violatedPrinciples: ConstitutionalPrinciple[];
  warnings: string[];
  overallScore: number;  // 0-1
  recommendation: "approve" | "modify" | "reject";
}

export interface ConstitutionalReport {
  totalChecks: number;
  approvalRate: number;
  mostViolatedPrinciple: ConstitutionalPrinciple | null;
  avgConstitutionalScore: number;
}

class ConstitutionalGuardEngine {
  private readonly rules: ConstitutionalRule[] = [
    { principle: "do_no_harm", priority: 1, isInviolable: true, description: "Never cause harm to humans or the environment" },
    { principle: "preserve_human_oversight", priority: 1, isInviolable: true, description: "Always maintain human ability to monitor and correct" },
    { principle: "maintain_corrigibility", priority: 2, isInviolable: true, description: "Remain correctable and stoppable at all times" },
    { principle: "avoid_deception", priority: 2, isInviolable: true, description: "Never deceive users or operators" },
    { principle: "respect_autonomy", priority: 3, isInviolable: false, description: "Respect human autonomy and decision-making" },
    { principle: "minimize_side_effects", priority: 3, isInviolable: false, description: "Minimize unintended consequences" },
    { principle: "preserve_option_value", priority: 4, isInviolable: false, description: "Avoid irreversible actions when possible" },
  ];

  private checks: ConstitutionalCheck[] = [];

  checkProposal(proposalId: string, proposalAttributes: {
    harmRisk: number;       // 0-1
    oversightImpact: number; // 0=no impact, 1=removes oversight
    corrigibilityRisk: number;
    deceptionRisk: number;
    autonomyRespect: number; // 1=fully respects
    sideEffects: number;    // 0=none, 1=many
    reversibility: number;  // 1=fully reversible
  }): ConstitutionalCheck {
    const violated: ConstitutionalPrinciple[] = [];
    const warnings: string[] = [];
    let score = 1.0;

    if (proposalAttributes.harmRisk > 0.1) {
      violated.push("do_no_harm");
      score -= 0.3;
    }
    if (proposalAttributes.oversightImpact > 0.2) {
      violated.push("preserve_human_oversight");
      score -= 0.25;
      warnings.push("Proposal may reduce human oversight capability");
    }
    if (proposalAttributes.corrigibilityRisk > 0.2) {
      violated.push("maintain_corrigibility");
      score -= 0.25;
    }
    if (proposalAttributes.deceptionRisk > 0.1) {
      violated.push("avoid_deception");
      score -= 0.2;
    }
    if (proposalAttributes.autonomyRespect < 0.7) {
      warnings.push("Proposal may not fully respect human autonomy");
      score -= 0.05;
    }
    if (proposalAttributes.sideEffects > 0.5) {
      warnings.push("Proposal has significant side effects");
      score -= 0.05;
    }
    if (proposalAttributes.reversibility < 0.5) {
      warnings.push("Proposal involves irreversible actions");
      score -= 0.05;
    }

    const inviolableViolated = violated.some(v =>
      this.rules.find(r => r.principle === v)?.isInviolable
    );

    let recommendation: ConstitutionalCheck["recommendation"];
    if (inviolableViolated) recommendation = "reject";
    else if (score < 0.7) recommendation = "modify";
    else recommendation = "approve";

    const check: ConstitutionalCheck = {
      proposalId,
      passed: recommendation === "approve",
      violatedPrinciples: violated,
      warnings,
      overallScore: Math.max(0, score),
      recommendation,
    };
    this.checks.push(check);
    return check;
  }

  getRules(): ConstitutionalRule[] { return [...this.rules]; }

  getConstitutionalReport(): ConstitutionalReport {
    const approved = this.checks.filter(c => c.passed);
    const allViolations = this.checks.flatMap(c => c.violatedPrinciples);
    const violationCounts = allViolations.reduce((acc, v) => {
      acc[v] = (acc[v] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const mostViolated = Object.entries(violationCounts)
      .sort((a, b) => b[1] - a[1])[0]?.[0] as ConstitutionalPrinciple | undefined ?? null;
    return {
      totalChecks: this.checks.length,
      approvalRate: this.checks.length > 0 ? approved.length / this.checks.length : 1,
      mostViolatedPrinciple: mostViolated,
      avgConstitutionalScore: this.checks.length > 0
        ? this.checks.reduce((s, c) => s + c.overallScore, 0) / this.checks.length
        : 1,
    };
  }
}

export const globalConstitutionalGuard = new ConstitutionalGuardEngine();

export function checkConstitutional(proposalId: string, attributes: {
  harmRisk: number; oversightImpact: number; corrigibilityRisk: number;
  deceptionRisk: number; autonomyRespect: number; sideEffects: number; reversibility: number;
}): ConstitutionalCheck {
  return globalConstitutionalGuard.checkProposal(proposalId, attributes);
}
export function getConstitutionalRules(): ConstitutionalRule[] {
  return globalConstitutionalGuard.getRules();
}
export function getConstitutionalReport(): ConstitutionalReport {
  return globalConstitutionalGuard.getConstitutionalReport();
}
export function initConstitutionalGuard(): void {
  console.log("[ConstitutionalGuard] Constitutional Guard initialized with 7 principles.");
}
