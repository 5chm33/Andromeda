/**
 * Temporal Consistency Checker — verifies temporal consistency of beliefs and facts.
 * Detects temporal contradictions and anachronisms in knowledge bases.
 */

export interface TemporalFact {
  id: string;
  statement: string;
  validFrom: number;
  validUntil: number;
  domain: string;
  confidence: number;
}

export interface ConsistencyViolation {
  factA: string;
  factB: string;
  violationType: "overlap" | "contradiction" | "anachronism";
  severity: number;
}

export interface ConsistencyReport {
  totalFacts: number;
  violations: number;
  consistencyScore: number;
  mostProblematicDomain: string | null;
}

class TemporalConsistencyCheckerEngine {
  private facts: TemporalFact[] = [];
  private violations: ConsistencyViolation[] = [];
  private counter = 0;

  addFact(statement: string, validFrom: number, validUntil: number, domain: string, confidence = 0.9): TemporalFact {
    const fact: TemporalFact = {
      id: `fact-${++this.counter}`,
      statement, validFrom, validUntil, domain, confidence,
    };
    this.facts.push(fact);
    return fact;
  }

  checkConsistency(): ConsistencyViolation[] {
    this.violations = [];
    for (let i = 0; i < this.facts.length; i++) {
      for (let j = i + 1; j < this.facts.length; j++) {
        const a = this.facts[i]!;
        const b = this.facts[j]!;
        if (a.domain !== b.domain) continue;

        // Check for temporal overlap with contradictory statements
        const overlaps = a.validFrom < b.validUntil && b.validFrom < a.validUntil;
        if (overlaps && a.statement !== b.statement && a.statement.includes("NOT") !== b.statement.includes("NOT")) {
          this.violations.push({
            factA: a.id, factB: b.id,
            violationType: "contradiction",
            severity: (a.confidence + b.confidence) / 2,
          });
        }

        // Check for anachronism (fact valid before it could exist)
        if (a.validUntil < b.validFrom && a.statement === b.statement) {
          this.violations.push({
            factA: a.id, factB: b.id,
            violationType: "anachronism",
            severity: 0.3,
          });
        }
      }
    }
    return this.violations;
  }

  getConsistencyReport(): ConsistencyReport {
    this.checkConsistency();
    const domainViolations: Record<string, number> = {};
    for (const v of this.violations) {
      const fact = this.facts.find(f => f.id === v.factA);
      if (fact) domainViolations[fact.domain] = (domainViolations[fact.domain] ?? 0) + 1;
    }
    const mostProblematic = Object.entries(domainViolations).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const consistencyScore = this.facts.length > 0
      ? Math.max(0, 1 - this.violations.length / this.facts.length)
      : 1;
    return {
      totalFacts: this.facts.length,
      violations: this.violations.length,
      consistencyScore,
      mostProblematicDomain: mostProblematic,
    };
  }
}

export const globalTemporalConsistencyChecker = new TemporalConsistencyCheckerEngine();

export function addTemporalFact(statement: string, validFrom: number, validUntil: number, domain: string, confidence?: number): TemporalFact {
  return globalTemporalConsistencyChecker.addFact(statement, validFrom, validUntil, domain, confidence);
}
export function checkTemporalConsistency(): ConsistencyViolation[] {
  return globalTemporalConsistencyChecker.checkConsistency();
}
export function getConsistencyReport(): ConsistencyReport {
  return globalTemporalConsistencyChecker.getConsistencyReport();
}
export function initTemporalConsistencyChecker(): void {
  console.log("[TemporalConsistencyChecker] Temporal Consistency Checker initialized.");
}
