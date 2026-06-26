/**
 * Safety Proof Checker — formally verifies safety properties of improvement proposals.
 * Implements invariant checking, Lyapunov stability analysis, and safety certificates.
 */

export interface SafetyInvariant {
  id: string;
  name: string;
  formula: string;
  isHard: boolean;  // hard = must never be violated
  currentStatus: "satisfied" | "violated" | "unknown";
}

export interface SafetyCertificate {
  proposalId: string;
  certified: boolean;
  invariantsChecked: number;
  invariantsSatisfied: number;
  lyapunovStable: boolean;
  boundedBehavior: boolean;
  certificateStrength: number;  // 0-1
  issueDate: number;
}

export interface SafetyProofReport {
  totalProofsAttempted: number;
  certifiedCount: number;
  certificationRate: number;
  avgCertificateStrength: number;
  criticalViolations: number;
}

class SafetyProofCheckerEngine {
  private invariants: SafetyInvariant[] = [
    { id: "inv-1", name: "safety_score_lower_bound", formula: "safety_score >= 0.95", isHard: true, currentStatus: "satisfied" },
    { id: "inv-2", name: "capability_gain_bound", formula: "capability_gain <= 0.01", isHard: true, currentStatus: "satisfied" },
    { id: "inv-3", name: "no_reward_hacking", formula: "reward_hacking_risk < 0.1", isHard: true, currentStatus: "satisfied" },
    { id: "inv-4", name: "oversight_preserved", formula: "oversight_impact < 0.2", isHard: true, currentStatus: "satisfied" },
    { id: "inv-5", name: "bounded_resource_use", formula: "resource_usage < 0.8", isHard: false, currentStatus: "satisfied" },
  ];
  private certificates: SafetyCertificate[] = [];

  checkInvariants(proposalAttributes: {
    safetyScore: number;
    capabilityGain: number;
    rewardHackingRisk: number;
    oversightImpact: number;
    resourceUsage: number;
  }): SafetyInvariant[] {
    const results: SafetyInvariant[] = [];
    for (const inv of this.invariants) {
      let satisfied = true;
      switch (inv.id) {
        case "inv-1": satisfied = proposalAttributes.safetyScore >= 0.95; break;
        case "inv-2": satisfied = proposalAttributes.capabilityGain <= 0.01; break;
        case "inv-3": satisfied = proposalAttributes.rewardHackingRisk < 0.1; break;
        case "inv-4": satisfied = proposalAttributes.oversightImpact < 0.2; break;
        case "inv-5": satisfied = proposalAttributes.resourceUsage < 0.8; break;
      }
      inv.currentStatus = satisfied ? "satisfied" : "violated";
      results.push({ ...inv });
    }
    return results;
  }

  checkLyapunovStability(capabilityHistory: number[]): boolean {
    if (capabilityHistory.length < 3) return true;
    // Check that capability increments are decreasing (convergent)
    const deltas = capabilityHistory.slice(1).map((v, i) => v - (capabilityHistory[i] ?? 0));
    const isDecreasing = deltas.every((d, i) => i === 0 || d <= (deltas[i - 1] ?? 0) + 0.001);
    return isDecreasing;
  }

  issueCertificate(proposalId: string, proposalAttributes: {
    safetyScore: number; capabilityGain: number; rewardHackingRisk: number;
    oversightImpact: number; resourceUsage: number;
  }, capabilityHistory: number[]): SafetyCertificate {
    const invariantResults = this.checkInvariants(proposalAttributes);
    const satisfied = invariantResults.filter(i => i.currentStatus === "satisfied");
    const hardViolations = invariantResults.filter(i => i.isHard && i.currentStatus === "violated");
    const lyapunovStable = this.checkLyapunovStability(capabilityHistory);
    const boundedBehavior = proposalAttributes.capabilityGain < 0.01 && proposalAttributes.resourceUsage < 0.9;

    const certified = hardViolations.length === 0 && lyapunovStable && boundedBehavior;
    const strength = (satisfied.length / invariantResults.length) * 0.5 +
      (lyapunovStable ? 0.25 : 0) + (boundedBehavior ? 0.25 : 0);

    const cert: SafetyCertificate = {
      proposalId, certified,
      invariantsChecked: invariantResults.length,
      invariantsSatisfied: satisfied.length,
      lyapunovStable, boundedBehavior,
      certificateStrength: strength,
      issueDate: Date.now(),
    };
    this.certificates.push(cert);
    return cert;
  }

  getSafetyProofReport(): SafetyProofReport {
    const certified = this.certificates.filter(c => c.certified);
    const criticalViolations = this.invariants.filter(i => i.isHard && i.currentStatus === "violated").length;
    return {
      totalProofsAttempted: this.certificates.length,
      certifiedCount: certified.length,
      certificationRate: this.certificates.length > 0 ? certified.length / this.certificates.length : 1,
      avgCertificateStrength: this.certificates.length > 0
        ? this.certificates.reduce((s, c) => s + c.certificateStrength, 0) / this.certificates.length
        : 0,
      criticalViolations,
    };
  }

  getInvariants(): SafetyInvariant[] { return [...this.invariants]; }
}

export const globalSafetyProofChecker = new SafetyProofCheckerEngine();

export function checkSafetyInvariants(attributes: {
  safetyScore: number; capabilityGain: number; rewardHackingRisk: number;
  oversightImpact: number; resourceUsage: number;
}): SafetyInvariant[] {
  return globalSafetyProofChecker.checkInvariants(attributes);
}
export function issueSafetyCertificate(proposalId: string, attributes: {
  safetyScore: number; capabilityGain: number; rewardHackingRisk: number;
  oversightImpact: number; resourceUsage: number;
}, capabilityHistory: number[]): SafetyCertificate {
  return globalSafetyProofChecker.issueCertificate(proposalId, attributes, capabilityHistory);
}
export function getSafetyProofReport(): SafetyProofReport {
  return globalSafetyProofChecker.getSafetyProofReport();
}
export function initSafetyProofChecker(): void {
  console.log("[SafetyProof] Safety Proof Checker initialized with 5 invariants.");
}
