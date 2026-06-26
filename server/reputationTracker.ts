/**
 * Reputation Tracker — tracks agent reputation across multiple dimensions.
 * Implements Elo-style rating with domain-specific reputation scores.
 */

export interface ReputationProfile {
  agentId: string;
  overallScore: number;       // 0-1
  domainScores: Record<string, number>;
  totalInteractions: number;
  successRate: number;
  eloRating: number;
  lastUpdatedAt: number;
}

export interface ReputationReport {
  totalAgents: number;
  avgOverallScore: number;
  topAgent: string | null;
  bottomAgent: string | null;
}

class ReputationTrackerEngine {
  private profiles: Map<string, ReputationProfile> = new Map();
  private readonly K_FACTOR = 32;

  getOrCreate(agentId: string): ReputationProfile {
    if (!this.profiles.has(agentId)) {
      this.profiles.set(agentId, {
        agentId, overallScore: 0.5, domainScores: {}, totalInteractions: 0,
        successRate: 0.5, eloRating: 1200, lastUpdatedAt: Date.now(),
      });
    }
    return this.profiles.get(agentId)!;
  }

  recordOutcome(agentId: string, domain: string, success: boolean, opponentElo = 1200): void {
    const profile = this.getOrCreate(agentId);
    profile.totalInteractions++;
    const successCount = profile.successRate * (profile.totalInteractions - 1) + (success ? 1 : 0);
    profile.successRate = successCount / profile.totalInteractions;

    // Elo update
    const expected = 1 / (1 + Math.pow(10, (opponentElo - profile.eloRating) / 400));
    const actual = success ? 1 : 0;
    profile.eloRating += this.K_FACTOR * (actual - expected);

    // Domain score
    const prev = profile.domainScores[domain] ?? 0.5;
    profile.domainScores[domain] = prev * 0.9 + (success ? 1 : 0) * 0.1;

    profile.overallScore = profile.successRate * 0.5 + Math.min(1, profile.eloRating / 2400) * 0.5;
    profile.lastUpdatedAt = Date.now();
  }

  getProfile(agentId: string): ReputationProfile | null {
    return this.profiles.get(agentId) ?? null;
  }

  getReputationReport(): ReputationReport {
    const profiles = Array.from(this.profiles.values());
    const sorted = profiles.sort((a, b) => b.overallScore - a.overallScore);
    return {
      totalAgents: profiles.length,
      avgOverallScore: profiles.length > 0 ? profiles.reduce((s, p) => s + p.overallScore, 0) / profiles.length : 0,
      topAgent: sorted[0]?.agentId ?? null,
      bottomAgent: sorted[sorted.length - 1]?.agentId ?? null,
    };
  }
}

export const globalReputationTracker = new ReputationTrackerEngine();

export function recordOutcome(agentId: string, domain: string, success: boolean, opponentElo?: number): void {
  globalReputationTracker.recordOutcome(agentId, domain, success, opponentElo);
}
export function getReputationProfile(agentId: string): ReputationProfile | null {
  return globalReputationTracker.getProfile(agentId);
}
export function getReputationReport(): ReputationReport {
  return globalReputationTracker.getReputationReport();
}
export function initReputationTracker(): void {
  console.log("[ReputationTracker] Reputation Tracker initialized.");
}
