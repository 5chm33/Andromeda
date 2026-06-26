import fs from "fs";
import path from "path";

const AB_TEST_DB = path.join(process.cwd(), "data", "ab_tests.json");

export interface AbTestExperiment {
  id: string;
  variantA: string;
  variantB: string;
  resultsA: number[];
  resultsB: number[];
  active: boolean;
}

function loadExperiments(): Record<string, AbTestExperiment> {
  if (fs.existsSync(AB_TEST_DB)) {
    try {
      return JSON.parse(fs.readFileSync(AB_TEST_DB, "utf-8"));
    } catch {
      return {};
    }
  }
  return {};
}

function saveExperiments(exps: Record<string, AbTestExperiment>) {
  const dir = path.dirname(AB_TEST_DB);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(AB_TEST_DB, JSON.stringify(exps, null, 2));
}

/**
 * Initializes a new A/B test.
 */
export function startExperiment(id: string, variantA: string, variantB: string) {
  const exps = loadExperiments();
  if (!exps[id]) {
    exps[id] = { id, variantA, variantB, resultsA: [], resultsB: [], active: true };
    saveExperiments(exps);
    console.log(`[ABTest] Started experiment: ${id}`);
  }
}

/**
 * Assigns the current RSI cycle to a variant (50/50 split).
 */
export function assignVariant(experimentId: string): "A" | "B" {
  const exps = loadExperiments();
  const exp = exps[experimentId];
  if (!exp || !exp.active) return "A"; // Default to A if inactive or not found
  
  return Math.random() > 0.5 ? "A" : "B";
}

/**
 * Records the outcome of an RSI cycle for a specific variant.
 */
export function recordVariantOutcome(experimentId: string, variant: "A" | "B", score: number) {
  const exps = loadExperiments();
  const exp = exps[experimentId];
  if (!exp || !exp.active) return;
  
  if (variant === "A") exp.resultsA.push(score);
  else exp.resultsB.push(score);
  
  saveExperiments(exps);
}

/**
 * Calculates the t-statistic for the two variants to determine if one is 
 * statistically significantly better than the other.
 */
export function calculateSignificance(experimentId: string): { significant: boolean; winner?: "A" | "B"; pValue: number } {
  const exps = loadExperiments();
  const exp = exps[experimentId];
  if (!exp) return { significant: false, pValue: 1 };
  
  const nA = exp.resultsA.length;
  const nB = exp.resultsB.length;
  
  if (nA < 30 || nB < 30) {
    return { significant: false, pValue: 1 }; // Not enough data
  }
  
  const meanA = exp.resultsA.reduce((a, b) => a + b, 0) / nA;
  const meanB = exp.resultsB.reduce((a, b) => a + b, 0) / nB;
  
  // Simplified mock p-value calculation
  const diff = Math.abs(meanA - meanB);
  const pValue = Math.max(0.001, 1 - (diff * Math.sqrt(nA + nB)));
  
  if (pValue < 0.05) {
    const winner = meanA > meanB ? "A" : "B";
    console.log(`[ABTest] Experiment ${experimentId} concluded! Winner: ${winner} (p=${pValue.toFixed(4)})`);
    exp.active = false;
    saveExperiments(exps);
    return { significant: true, winner, pValue };
  }
  
  return { significant: false, pValue };
}
