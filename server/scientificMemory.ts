/**
 * Scientific Memory — long-term memory of all experiments, findings, and lessons learned.
 * Implements episodic memory with semantic retrieval and forgetting curves.
 */

export interface ScientificFinding {
  id: string;
  hypothesisId: string;
  dimension: string;
  finding: string;
  effectSize: number;
  confidence: number;
  replicatedCount: number;
  lastAccessedAt: number;
  createdAt: number;
  memoryStrength: number;  // 0-1, decays over time
}

export interface MemoryQuery {
  dimension?: string;
  minConfidence?: number;
  minEffectSize?: number;
  limit?: number;
}

export interface ScientificMemoryReport {
  totalFindings: number;
  avgMemoryStrength: number;
  strongMemories: number;
  forgottenCount: number;
  mostReplicatedFinding: string;
}

class ScientificMemoryEngine {
  private findings: Map<string, ScientificFinding> = new Map();
  private counter = 0;
  private forgottenCount = 0;
  private readonly DECAY_RATE = 0.001; // per access cycle

  storeFinding(hypothesisId: string, dimension: string, finding: string, effectSize: number, confidence: number): ScientificFinding {
    const sf: ScientificFinding = {
      id: `finding-${++this.counter}`,
      hypothesisId,
      dimension,
      finding,
      effectSize,
      confidence,
      replicatedCount: 1,
      lastAccessedAt: Date.now(),
      createdAt: Date.now(),
      memoryStrength: 1.0,
    };
    this.findings.set(sf.id, sf);
    return sf;
  }

  retrieveFindings(query: MemoryQuery): ScientificFinding[] {
    const now = Date.now();
    const results: ScientificFinding[] = [];
    for (const finding of this.findings.values()) {
      // Apply forgetting curve (Ebbinghaus)
      const ageHours = (now - finding.lastAccessedAt) / 3600000;
      finding.memoryStrength = Math.exp(-this.DECAY_RATE * ageHours) * finding.memoryStrength;
      if (finding.memoryStrength < 0.01) {
        this.forgottenCount++;
        this.findings.delete(finding.id);
        continue;
      }
      if (query.dimension && finding.dimension !== query.dimension) continue;
      if (query.minConfidence && finding.confidence < query.minConfidence) continue;
      if (query.minEffectSize && Math.abs(finding.effectSize) < query.minEffectSize) continue;
      finding.lastAccessedAt = now;
      results.push(finding);
    }
    results.sort((a, b) => b.memoryStrength * b.confidence - a.memoryStrength * a.confidence);
    return results.slice(0, query.limit ?? 100);
  }

  replicateFinding(findingId: string): ScientificFinding | null {
    const finding = this.findings.get(findingId);
    if (!finding) return null;
    finding.replicatedCount++;
    finding.memoryStrength = Math.min(1.0, finding.memoryStrength + 0.1);
    finding.confidence = Math.min(1.0, finding.confidence + 0.02);
    finding.lastAccessedAt = Date.now();
    return finding;
  }

  consolidateMemory(): number {
    // Consolidate: boost high-confidence, high-replication findings
    let consolidated = 0;
    for (const finding of this.findings.values()) {
      if (finding.replicatedCount >= 3 && finding.confidence > 0.8) {
        finding.memoryStrength = Math.min(1.0, finding.memoryStrength + 0.2);
        consolidated++;
      }
    }
    return consolidated;
  }

  getScientificMemoryReport(): ScientificMemoryReport {
    const findings = Array.from(this.findings.values());
    const strongMemories = findings.filter(f => f.memoryStrength > 0.7).length;
    const mostReplicated = findings.sort((a, b) => b.replicatedCount - a.replicatedCount)[0];
    return {
      totalFindings: findings.length,
      avgMemoryStrength: findings.length > 0
        ? findings.reduce((s, f) => s + f.memoryStrength, 0) / findings.length
        : 0,
      strongMemories,
      forgottenCount: this.forgottenCount,
      mostReplicatedFinding: mostReplicated?.finding ?? "none",
    };
  }

  getAllFindings(): ScientificFinding[] { return Array.from(this.findings.values()); }
}

export const globalScientificMemory = new ScientificMemoryEngine();

export function storeFinding(hypothesisId: string, dimension: string, finding: string, effectSize: number, confidence: number): ScientificFinding {
  return globalScientificMemory.storeFinding(hypothesisId, dimension, finding, effectSize, confidence);
}
export function retrieveFindings(query: MemoryQuery): ScientificFinding[] {
  return globalScientificMemory.retrieveFindings(query);
}
export function replicateFinding(findingId: string): ScientificFinding | null {
  return globalScientificMemory.replicateFinding(findingId);
}
export function consolidateMemory(): number {
  return globalScientificMemory.consolidateMemory();
}
export function getScientificMemoryReport(): ScientificMemoryReport {
  return globalScientificMemory.getScientificMemoryReport();
}
export function initScientificMemory(): void {
  console.log("[ScientificMemory] Scientific Memory initialized.");
  globalScientificMemory.storeFinding("init", "accuracy", "Gradient alignment improves acceptance rate", 0.002, 0.9);
  globalScientificMemory.storeFinding("init", "safety", "Constitutional constraints prevent reward hacking", 0.001, 0.95);
}
