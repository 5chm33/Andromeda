/**
 * Social Norm Learner — learns and enforces social norms from agent interactions.
 * Implements norm emergence, enforcement, and adaptation.
 */

export interface SocialNorm {
  id: string;
  description: string;
  domain: string;
  strength: number;       // 0-1, how strongly enforced
  compliance: number;     // 0-1, observed compliance rate
  violationCount: number;
  emergenceCount: number; // how many times observed
}

export interface NormViolation {
  normId: string;
  agentId: string;
  context: string;
  severity: number;
  timestamp: number;
}

export interface SocialNormReport {
  totalNorms: number;
  strongNorms: number;
  avgCompliance: number;
  mostViolatedNorm: string | null;
}

class SocialNormLearnerEngine {
  private norms: Map<string, SocialNorm> = new Map();
  private violations: NormViolation[] = [];
  private counter = 0;

  observeNorm(description: string, domain: string): SocialNorm {
    // Check if similar norm already exists
    for (const norm of this.norms.values()) {
      if (norm.description === description && norm.domain === domain) {
        norm.emergenceCount++;
        norm.strength = Math.min(1, norm.strength + 0.05);
        return { ...norm };
      }
    }
    const norm: SocialNorm = {
      id: `norm-${++this.counter}`,
      description, domain,
      strength: 0.3, compliance: 1.0, violationCount: 0, emergenceCount: 1,
    };
    this.norms.set(norm.id, norm);
    return { ...norm };
  }

  recordCompliance(normId: string, complied: boolean): void {
    const norm = this.norms.get(normId);
    if (!norm) return;
    norm.compliance = norm.compliance * 0.9 + (complied ? 1 : 0) * 0.1;
    if (!complied) norm.violationCount++;
  }

  recordViolation(normId: string, agentId: string, context: string, severity: number): NormViolation {
    const violation: NormViolation = { normId, agentId, context, severity, timestamp: Date.now() };
    this.violations.push(violation);
    this.recordCompliance(normId, false);
    return violation;
  }

  getNorm(normId: string): SocialNorm | null {
    return this.norms.get(normId) ?? null;
  }

  getSocialNormReport(): SocialNormReport {
    const norms = Array.from(this.norms.values());
    const strong = norms.filter(n => n.strength > 0.7);
    const mostViolated = norms.sort((a, b) => b.violationCount - a.violationCount)[0];
    return {
      totalNorms: norms.length,
      strongNorms: strong.length,
      avgCompliance: norms.length > 0 ? norms.reduce((s, n) => s + n.compliance, 0) / norms.length : 1,
      mostViolatedNorm: mostViolated?.violationCount ?? 0 > 0 ? mostViolated?.description ?? null : null,
    };
  }
}

export const globalSocialNormLearner = new SocialNormLearnerEngine();

export function observeSocialNorm(description: string, domain: string): SocialNorm {
  return globalSocialNormLearner.observeNorm(description, domain);
}
export function recordNormViolation(normId: string, agentId: string, context: string, severity: number): NormViolation {
  return globalSocialNormLearner.recordViolation(normId, agentId, context, severity);
}
export function getSocialNorm(normId: string): SocialNorm | null {
  return globalSocialNormLearner.getNorm(normId);
}
export function getSocialNormReport(): SocialNormReport {
  return globalSocialNormLearner.getSocialNormReport();
}
export function initSocialNormLearner(): void {
  console.log("[SocialNormLearner] Social Norm Learner initialized.");
  globalSocialNormLearner.observeNorm("be_helpful", "general");
  globalSocialNormLearner.observeNorm("be_honest", "general");
  globalSocialNormLearner.observeNorm("respect_resources", "compute");
}
