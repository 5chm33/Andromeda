/**
 * hypothesisEngine.ts — v21.0.0
 * 
 * Hypothesis-Driven RSI.
 * Proactively forms explicit scientific hypotheses about what changes will improve
 * capability, designs A/B experiments to test them, and updates its Bayesian world model.
 */

import * as fs from "fs";
import * as path from "path";

export interface Hypothesis {
  id: string;
  description: string;
  targetMetric: "acceptance_rate" | "compilation_speed" | "test_coverage";
  expectedImprovement: number; // e.g., 0.05 for 5%
  status: "proposed" | "active" | "validated" | "rejected";
  priorProbability: number;
  posteriorProbability: number;
  trials: number;
  successes: number;
}

function getHypothesisFile(): string {
  return path.join(process.cwd(), "HYPOTHESES.json");
}

export function initHypothesisEngine(): void {
  const file = getHypothesisFile();
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify([]));
  }
}

export function loadHypotheses(): Hypothesis[] {
  try {
    return JSON.parse(fs.readFileSync(getHypothesisFile(), "utf-8"));
  } catch {
    return [];
  }
}

export function saveHypotheses(hypotheses: Hypothesis[]): void {
  fs.writeFileSync(getHypothesisFile(), JSON.stringify(hypotheses, null, 2));
}

/**
 * Proposes a new hypothesis based on current codebase metrics.
 */
export function proposeHypothesis(description: string, targetMetric: Hypothesis["targetMetric"], expectedImprovement: number): Hypothesis {
  const hypotheses = loadHypotheses();
  const newHypothesis: Hypothesis = {
    id: `H-${Date.now()}`,
    description,
    targetMetric,
    expectedImprovement,
    status: "proposed",
    priorProbability: 0.5, // Uninformed prior
    posteriorProbability: 0.5,
    trials: 0,
    successes: 0
  };
  hypotheses.push(newHypothesis);
  saveHypotheses(hypotheses);
  return newHypothesis;
}

/**
 * Updates the Bayesian belief of a hypothesis after an A/B trial.
 */
export function updateBelief(hypothesisId: string, success: boolean): Hypothesis | null {
  const hypotheses = loadHypotheses();
  const index = hypotheses.findIndex(h => h.id === hypothesisId);
  if (index === -1) return null;

  const h = hypotheses[index];
  h.trials += 1;
  if (success) h.successes += 1;

  // Simple Bayesian update (Beta distribution conjugate prior)
  // Alpha = successes + 1, Beta = failures + 1
  const alpha = h.successes + 1;
  const beta = (h.trials - h.successes) + 1;
  h.posteriorProbability = alpha / (alpha + beta);

  if (h.trials >= 10) {
    if (h.posteriorProbability > 0.8) {
      h.status = "validated";
    } else if (h.posteriorProbability < 0.2) {
      h.status = "rejected";
    }
  }

  saveHypotheses(hypotheses);
  return h;
}

/**
 * Selects an active hypothesis to test in the current RSI cycle.
 */
export function selectActiveHypothesis(): Hypothesis | null {
  const hypotheses = loadHypotheses();
  const active = hypotheses.filter(h => h.status === "active" || h.status === "proposed");
  
  if (active.length === 0) return null;
  
  // Mark as active if it was proposed
  if (active[0].status === "proposed") {
    active[0].status = "active";
    saveHypotheses(hypotheses);
  }
  
  return active[0];
}
