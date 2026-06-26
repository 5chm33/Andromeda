/**
 * apiRecommendationEngine.ts — v54.0.0
 *
 * Recommends APIs, endpoints, and integration patterns based on
 * task requirements, usage history, and capability matching.
 */

export interface ApiCapabilityProfile {
  apiId: string;
  name: string;
  capabilities: string[];
  domains: string[];
  avgLatencyMs: number;
  costPerCall: number;
  reliabilityScore: number;  // 0.0–1.0
}

export interface RecommendationRequest {
  requiredCapabilities: string[];
  preferredDomains?: string[];
  maxLatencyMs?: number;
  maxCostPerCall?: number;
  minReliability?: number;
}

export interface ApiRecommendation {
  apiId: string;
  name: string;
  score: number;
  matchedCapabilities: string[];
  reasons: string[];
}

const profiles = new Map<string, ApiCapabilityProfile>();

export function registerApiProfile(profile: ApiCapabilityProfile): void {
  profiles.set(profile.apiId, profile);
}

export function getRecommendations(request: RecommendationRequest): ApiRecommendation[] {
  const recommendations: ApiRecommendation[] = [];

  for (const profile of profiles.values()) {
    const matchedCapabilities = request.requiredCapabilities.filter(cap =>
      profile.capabilities.some(c => c.toLowerCase().includes(cap.toLowerCase()))
    );

    if (matchedCapabilities.length === 0) continue;

    // Apply filters
    if (request.maxLatencyMs && profile.avgLatencyMs > request.maxLatencyMs) continue;
    if (request.maxCostPerCall && profile.costPerCall > request.maxCostPerCall) continue;
    if (request.minReliability && profile.reliabilityScore < request.minReliability) continue;

    const reasons: string[] = [];
    let score = matchedCapabilities.length / request.requiredCapabilities.length;

    // Domain bonus
    if (request.preferredDomains) {
      const domainMatch = request.preferredDomains.some(d => profile.domains.includes(d));
      if (domainMatch) { score += 0.2; reasons.push("Matches preferred domain"); }
    }

    // Reliability bonus
    score += profile.reliabilityScore * 0.3;
    if (profile.reliabilityScore > 0.95) reasons.push("High reliability");

    // Cost bonus
    if (profile.costPerCall < 0.001) reasons.push("Low cost");

    reasons.push(`Matches ${matchedCapabilities.length}/${request.requiredCapabilities.length} required capabilities`);

    recommendations.push({
      apiId: profile.apiId,
      name: profile.name,
      score: Math.min(1.0, score),
      matchedCapabilities,
      reasons,
    });
  }

  return recommendations.sort((a, b) => b.score - a.score);
}

export function _resetRecommendationEngineForTest(): void {
  profiles.clear();
}
