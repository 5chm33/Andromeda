/**
 * Trust Builder — builds and manages trust relationships between agents.
 * Implements beta-distribution trust models and trust propagation.
 */

export interface TrustRelationship {
  trustorId: string;
  trusteeId: string;
  alpha: number;  // positive interactions
  beta: number;   // negative interactions
  trustScore: number;  // alpha / (alpha + beta)
  confidence: number;  // based on total interactions
  lastUpdatedAt: number;
}

export interface TrustReport {
  totalRelationships: number;
  avgTrustScore: number;
  highTrustPairs: number;
  lowTrustPairs: number;
}

class TrustBuilderEngine {
  private relationships: Map<string, TrustRelationship> = new Map();

  private _key(trustorId: string, trusteeId: string): string {
    return `${trustorId}:${trusteeId}`;
  }

  updateTrust(trustorId: string, trusteeId: string, positive: boolean): TrustRelationship {
    const key = this._key(trustorId, trusteeId);
    let rel = this.relationships.get(key);
    if (!rel) {
      rel = { trustorId, trusteeId, alpha: 1, beta: 1, trustScore: 0.5, confidence: 0, lastUpdatedAt: Date.now() };
      this.relationships.set(key, rel);
    }
    if (positive) rel.alpha += 1;
    else rel.beta += 1;
    rel.trustScore = rel.alpha / (rel.alpha + rel.beta);
    rel.confidence = Math.min(1, (rel.alpha + rel.beta - 2) / 100);
    rel.lastUpdatedAt = Date.now();
    return { ...rel };
  }

  getTrust(trustorId: string, trusteeId: string): TrustRelationship | null {
    return this.relationships.get(this._key(trustorId, trusteeId)) ?? null;
  }

  getTrustReport(): TrustReport {
    const rels = Array.from(this.relationships.values());
    return {
      totalRelationships: rels.length,
      avgTrustScore: rels.length > 0 ? rels.reduce((s, r) => s + r.trustScore, 0) / rels.length : 0,
      highTrustPairs: rels.filter(r => r.trustScore > 0.7).length,
      lowTrustPairs: rels.filter(r => r.trustScore < 0.3).length,
    };
  }
}

export const globalTrustBuilder = new TrustBuilderEngine();

export function updateTrust(trustorId: string, trusteeId: string, positive: boolean): TrustRelationship {
  return globalTrustBuilder.updateTrust(trustorId, trusteeId, positive);
}
export function getTrust(trustorId: string, trusteeId: string): TrustRelationship | null {
  return globalTrustBuilder.getTrust(trustorId, trusteeId);
}
export function getTrustReport(): TrustReport {
  return globalTrustBuilder.getTrustReport();
}
export function initTrustBuilder(): void {
  console.log("[TrustBuilder] Trust Builder initialized.");
}
