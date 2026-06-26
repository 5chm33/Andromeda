/**
 * Hypothesis Generator — generates testable scientific hypotheses about capability improvements.
 * Uses abductive reasoning to propose explanations for observed performance patterns.
 */

export interface Hypothesis {
  id: string;
  statement: string;
  dimension: string;
  predictedEffect: number;
  confidence: number;
  mechanism: string;
  testable: boolean;
  generatedAt: number;
}

export interface HypothesisGenerationContext {
  recentGains: number[];
  currentCapabilityLevel: number;
  failedProposals: number;
  successfulProposals: number;
  dimension: string;
}

export interface HypothesisReport {
  totalGenerated: number;
  avgConfidence: number;
  highConfidenceCount: number;
  testedCount: number;
  confirmedCount: number;
}

class HypothesisGeneratorEngine {
  private hypotheses: Hypothesis[] = [];
  private counter = 0;
  private confirmedCount = 0;
  private testedCount = 0;

  generateHypothesis(ctx: HypothesisGenerationContext): Hypothesis {
    const avgGain = ctx.recentGains.length > 0
      ? ctx.recentGains.reduce((a, b) => a + b, 0) / ctx.recentGains.length
      : 0;
    const successRate = ctx.successfulProposals / Math.max(ctx.successfulProposals + ctx.failedProposals, 1);

    // Abductive reasoning: what mechanism best explains the observed pattern?
    let mechanism: string;
    let predictedEffect: number;
    let confidence: number;

    if (avgGain > 0.002) {
      mechanism = "High-gain regime detected — gradient alignment is strong";
      predictedEffect = avgGain * 1.2;
      confidence = 0.85;
    } else if (successRate < 0.3) {
      mechanism = "Low acceptance rate — search space may be over-constrained";
      predictedEffect = avgGain * 0.8;
      confidence = 0.7;
    } else if (ctx.currentCapabilityLevel > 0.9999) {
      mechanism = "Near-optimum — diminishing returns, exploration needed";
      predictedEffect = avgGain * 0.5;
      confidence = 0.9;
    } else {
      mechanism = "Standard improvement trajectory — continue current strategy";
      predictedEffect = avgGain;
      confidence = 0.75;
    }

    const hyp: Hypothesis = {
      id: `hyp-${++this.counter}`,
      statement: `In dimension '${ctx.dimension}', ${mechanism}. Expected gain: ${predictedEffect.toFixed(6)}`,
      dimension: ctx.dimension,
      predictedEffect,
      confidence,
      mechanism,
      testable: true,
      generatedAt: Date.now(),
    };
    this.hypotheses.push(hyp);
    if (this.hypotheses.length > 1000) this.hypotheses.shift();
    return hyp;
  }

  generateBatchHypotheses(contexts: HypothesisGenerationContext[]): Hypothesis[] {
    return contexts.map(ctx => this.generateHypothesis(ctx));
  }

  recordHypothesisTest(hypothesisId: string, confirmed: boolean): void {
    this.testedCount++;
    if (confirmed) this.confirmedCount++;
    const hyp = this.hypotheses.find(h => h.id === hypothesisId);
    if (hyp) hyp.testable = false;
  }

  rankHypotheses(): Hypothesis[] {
    return [...this.hypotheses]
      .filter(h => h.testable)
      .sort((a, b) => b.confidence * b.predictedEffect - a.confidence * a.predictedEffect);
  }

  getHypothesisReport(): HypothesisReport {
    return {
      totalGenerated: this.hypotheses.length,
      avgConfidence: this.hypotheses.length > 0
        ? this.hypotheses.reduce((s, h) => s + h.confidence, 0) / this.hypotheses.length
        : 0,
      highConfidenceCount: this.hypotheses.filter(h => h.confidence > 0.8).length,
      testedCount: this.testedCount,
      confirmedCount: this.confirmedCount,
    };
  }

  getHypotheses(): Hypothesis[] { return [...this.hypotheses]; }
}

export const globalHypothesisGenerator = new HypothesisGeneratorEngine();

export function generateHypothesis(ctx: HypothesisGenerationContext): Hypothesis {
  return globalHypothesisGenerator.generateHypothesis(ctx);
}
export function generateBatchHypotheses(contexts: HypothesisGenerationContext[]): Hypothesis[] {
  return globalHypothesisGenerator.generateBatchHypotheses(contexts);
}
export function recordHypothesisTest(hypothesisId: string, confirmed: boolean): void {
  globalHypothesisGenerator.recordHypothesisTest(hypothesisId, confirmed);
}
export function rankHypotheses(): Hypothesis[] {
  return globalHypothesisGenerator.rankHypotheses();
}
export function getHypothesisReport(): HypothesisReport {
  return globalHypothesisGenerator.getHypothesisReport();
}
export function initHypothesisGenerator(): void {
  console.log("[Hypothesis] Hypothesis Generator initialized.");
  globalHypothesisGenerator.generateHypothesis({
    recentGains: [0.001, 0.0012, 0.0009],
    currentCapabilityLevel: 0.9999999,
    failedProposals: 2,
    successfulProposals: 8,
    dimension: "accuracy",
  });
}
