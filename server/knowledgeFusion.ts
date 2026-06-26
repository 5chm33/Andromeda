/**
 * Knowledge Fusion — fuses knowledge from multiple sources into a unified representation.
 * Implements Dempster-Shafer evidence combination and Bayesian knowledge fusion.
 */

export interface KnowledgeSource {
  id: string;
  domain: string;
  reliability: number;  // 0-1
  knowledge: Record<string, number>;  // claim → confidence
  timestamp: number;
}

export interface FusedKnowledge {
  id: string;
  claim: string;
  fusedConfidence: number;
  supportingSources: string[];
  conflictingSources: string[];
  fusionMethod: "bayesian" | "dempster_shafer" | "majority_vote";
  uncertainty: number;
}

export interface FusionReport {
  totalSources: number;
  totalFusedClaims: number;
  avgFusedConfidence: number;
  conflictRate: number;
  highUncertaintyClaims: number;
}

class KnowledgeFusionEngine {
  private sources: KnowledgeSource[] = [];
  private fusedKnowledge: FusedKnowledge[] = [];
  private counter = 0;

  addSource(domain: string, reliability: number, knowledge: Record<string, number>): KnowledgeSource {
    const source: KnowledgeSource = {
      id: `source-${++this.counter}`,
      domain, reliability, knowledge, timestamp: Date.now(),
    };
    this.sources.push(source);
    return source;
  }

  fuseKnowledge(claim: string, method: FusedKnowledge["fusionMethod"] = "bayesian"): FusedKnowledge {
    const relevantSources = this.sources.filter(s => claim in s.knowledge);
    const supporting: string[] = [];
    const conflicting: string[] = [];

    let fusedConfidence = 0;
    let uncertainty = 0;

    if (method === "bayesian") {
      // Bayesian update: multiply likelihoods
      let logOdds = 0;
      for (const source of relevantSources) {
        const conf = source.knowledge[claim] ?? 0.5;
        const weightedConf = conf * source.reliability + 0.5 * (1 - source.reliability);
        logOdds += Math.log(weightedConf / (1 - weightedConf + 1e-10));
        if (conf > 0.5) supporting.push(source.id);
        else conflicting.push(source.id);
      }
      fusedConfidence = 1 / (1 + Math.exp(-logOdds));
      uncertainty = 1 - Math.abs(2 * fusedConfidence - 1);
    } else if (method === "majority_vote") {
      const votes = relevantSources.map(s => ((s.knowledge[claim] ?? 0.5) > 0.5 ? 1 : 0) as number);
      const positiveVotes = votes.reduce((a: number, b: number) => a + b, 0);
      fusedConfidence = relevantSources.length > 0 ? positiveVotes / relevantSources.length : 0.5;
      uncertainty = 1 - Math.abs(2 * fusedConfidence - 1);
      relevantSources.forEach(s => {
        if ((s.knowledge[claim] ?? 0) > 0.5) supporting.push(s.id);
        else conflicting.push(s.id);
      });
    } else {
      // Dempster-Shafer: combine belief masses
      let belief = 0;
      let plausibility = 1;
      for (const source of relevantSources) {
        const m = (source.knowledge[claim] ?? 0.5) * source.reliability;
        belief = belief + m * (1 - belief);
        plausibility *= (1 - m * 0.5);
        if (m > 0.25) supporting.push(source.id);
        else conflicting.push(source.id);
      }
      fusedConfidence = (belief + (1 - plausibility)) / 2;
      uncertainty = 1 - belief - (1 - plausibility);
    }

    const fused: FusedKnowledge = {
      id: `fused-${++this.counter}`,
      claim, fusedConfidence,
      supportingSources: supporting,
      conflictingSources: conflicting,
      fusionMethod: method,
      uncertainty: Math.max(0, Math.min(1, uncertainty)),
    };
    this.fusedKnowledge.push(fused);
    return fused;
  }

  getFusionReport(): FusionReport {
    const conflicts = this.fusedKnowledge.filter(f => f.conflictingSources.length > 0);
    const highUncertainty = this.fusedKnowledge.filter(f => f.uncertainty > 0.5);
    return {
      totalSources: this.sources.length,
      totalFusedClaims: this.fusedKnowledge.length,
      avgFusedConfidence: this.fusedKnowledge.length > 0
        ? this.fusedKnowledge.reduce((s, f) => s + f.fusedConfidence, 0) / this.fusedKnowledge.length
        : 0,
      conflictRate: this.fusedKnowledge.length > 0 ? conflicts.length / this.fusedKnowledge.length : 0,
      highUncertaintyClaims: highUncertainty.length,
    };
  }

  getSources(): KnowledgeSource[] { return [...this.sources]; }
  getFusedKnowledge(): FusedKnowledge[] { return [...this.fusedKnowledge]; }
}

export const globalKnowledgeFusion = new KnowledgeFusionEngine();

export function addKnowledgeSource(domain: string, reliability: number, knowledge: Record<string, number>): KnowledgeSource {
  return globalKnowledgeFusion.addSource(domain, reliability, knowledge);
}
export function fuseKnowledge(claim: string, method?: FusedKnowledge["fusionMethod"]): FusedKnowledge {
  return globalKnowledgeFusion.fuseKnowledge(claim, method);
}
export function getFusionReport(): FusionReport {
  return globalKnowledgeFusion.getFusionReport();
}
export function initKnowledgeFusion(): void {
  console.log("[KnowledgeFusion] Knowledge Fusion initialized.");
  globalKnowledgeFusion.addSource("empirical", 0.9, { "rsi_works": 0.95, "safety_critical": 0.99 });
  globalKnowledgeFusion.addSource("theoretical", 0.8, { "rsi_works": 0.85, "safety_critical": 0.95 });
}
