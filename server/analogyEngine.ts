/**
 * Analogy Engine — finds structural analogies between domains for cross-domain transfer.
 * Implements structure-mapping theory (SMT) for analogical reasoning.
 */

export interface StructureMapping {
  id: string;
  sourceDomain: string;
  targetDomain: string;
  mappedElements: Array<{ source: string; target: string; confidence: number }>;
  systematicity: number;  // 0-1, how systematic the mapping is
  novelty: number;        // 0-1, how novel the analogy is
  utility: number;        // 0-1, how useful for transfer
}

export interface AnalogyCandidate {
  mapping: StructureMapping;
  score: number;
  transferableInsights: string[];
}

export interface AnalogyReport {
  totalAnalogiesFound: number;
  avgSystematicity: number;
  avgUtility: number;
  topDomainPairs: Array<[string, string]>;
}

class AnalogyEngineImpl {
  private mappings: StructureMapping[] = [];
  private counter = 0;

  findAnalogy(
    sourceDomain: string,
    targetDomain: string,
    sourceElements: string[],
    targetElements: string[]
  ): StructureMapping {
    const mappedElements: Array<{ source: string; target: string; confidence: number }> = [];

    // Simple structural alignment: match by position and semantic similarity
    const maxLen = Math.min(sourceElements.length, targetElements.length);
    for (let i = 0; i < maxLen; i++) {
      const src = sourceElements[i]!;
      const tgt = targetElements[i]!;
      // Confidence based on name similarity (simple heuristic)
      const similarity = this._nameSimilarity(src, tgt);
      mappedElements.push({ source: src, target: tgt, confidence: similarity });
    }

    const avgConfidence = mappedElements.length > 0
      ? mappedElements.reduce((s, m) => s + m.confidence, 0) / mappedElements.length
      : 0;

    const mapping: StructureMapping = {
      id: `analogy-${++this.counter}`,
      sourceDomain,
      targetDomain,
      mappedElements,
      systematicity: avgConfidence,
      novelty: sourceDomain !== targetDomain ? 0.8 : 0.2,
      utility: avgConfidence * 0.7 + (sourceDomain !== targetDomain ? 0.3 : 0),
    };
    this.mappings.push(mapping);
    return mapping;
  }

  private _nameSimilarity(a: string, b: string): number {
    const aLower = a.toLowerCase();
    const bLower = b.toLowerCase();
    if (aLower === bLower) return 1.0;
    // Jaccard similarity on character bigrams
    const bigrams = (s: string) => new Set(Array.from({ length: s.length - 1 }, (_, i) => s.slice(i, i + 2)));
    const aGrams = bigrams(aLower);
    const bGrams = bigrams(bLower);
    const intersection = [...aGrams].filter(g => bGrams.has(g)).length;
    const union = new Set([...aGrams, ...bGrams]).size;
    return union > 0 ? intersection / union : 0;
  }

  rankAnalogyCandidates(domain: string): AnalogyCandidate[] {
    return this.mappings
      .filter(m => m.sourceDomain === domain || m.targetDomain === domain)
      .map(m => ({
        mapping: m,
        score: m.systematicity * 0.4 + m.novelty * 0.3 + m.utility * 0.3,
        transferableInsights: m.mappedElements
          .filter(e => e.confidence > 0.5)
          .map(e => `${e.source} ≈ ${e.target}`),
      }))
      .sort((a, b) => b.score - a.score);
  }

  getAnalogyReport(): AnalogyReport {
    const domainPairCounts = new Map<string, number>();
    for (const m of this.mappings) {
      const key = `${m.sourceDomain}:${m.targetDomain}`;
      domainPairCounts.set(key, (domainPairCounts.get(key) ?? 0) + 1);
    }
    const topPairs = [...domainPairCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k]) => k.split(":") as [string, string]);
    return {
      totalAnalogiesFound: this.mappings.length,
      avgSystematicity: this.mappings.length > 0
        ? this.mappings.reduce((s, m) => s + m.systematicity, 0) / this.mappings.length
        : 0,
      avgUtility: this.mappings.length > 0
        ? this.mappings.reduce((s, m) => s + m.utility, 0) / this.mappings.length
        : 0,
      topDomainPairs: topPairs,
    };
  }
}

export const globalAnalogyEngine = new AnalogyEngineImpl();

export function findAnalogy(sourceDomain: string, targetDomain: string, sourceElements: string[], targetElements: string[]): StructureMapping {
  return globalAnalogyEngine.findAnalogy(sourceDomain, targetDomain, sourceElements, targetElements);
}
export function rankAnalogyCandidates(domain: string): AnalogyCandidate[] {
  return globalAnalogyEngine.rankAnalogyCandidates(domain);
}
export function getAnalogyReport(): AnalogyReport {
  return globalAnalogyEngine.getAnalogyReport();
}
export function initAnalogyEngine(): void {
  console.log("[AnalogyEngine] Analogy Engine initialized.");
  globalAnalogyEngine.findAnalogy("Biology", "AI",
    ["evolution", "selection", "mutation", "fitness"],
    ["training", "optimization", "perturbation", "loss"]
  );
}
