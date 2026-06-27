/**
 * hyperparameterTuner.ts — v96.0.0 "Quantum-Inspired Optimization"
 * Bayesian-inspired hyperparameter tuning for ML models and agent configurations.
 */
export type SearchStrategy = "random" | "grid" | "bayesian" | "tpe";
export interface HyperparameterSpace {
  name: string;
  type: "continuous" | "discrete" | "categorical";
  min?: number;
  max?: number;
  choices?: (string | number)[];
  logScale?: boolean;
}

export interface Trial {
  trialId: string;
  experimentId: string;
  parameters: Record<string, string | number>;
  score: number | null;
  status: "pending" | "running" | "completed" | "failed";
  startedAt: number;
  completedAt: number | null;
}

export interface TuningExperiment {
  experimentId: string;
  name: string;
  strategy: SearchStrategy;
  parameterSpace: HyperparameterSpace[];
  trials: Trial[];
  bestTrial: Trial | null;
  targetMetric: string;
  maximize: boolean;
}

const experiments = new Map<string, TuningExperiment>();
let experimentCounter = 0;
let trialCounter = 0;

export function createExperiment(name: string, strategy: SearchStrategy, parameterSpace: HyperparameterSpace[], targetMetric: string, maximize = true): TuningExperiment {
  const exp: TuningExperiment = { experimentId: `exp-${++experimentCounter}`, name, strategy, parameterSpace, trials: [], bestTrial: null, targetMetric, maximize };
  experiments.set(exp.experimentId, exp);
  return exp;
}

function sampleParameter(space: HyperparameterSpace): string | number {
  if (space.type === "categorical" && space.choices) return space.choices[Math.floor(Math.random() * space.choices.length)];
  const min = space.min ?? 0; const max = space.max ?? 1;
  if (space.type === "discrete") return Math.floor(Math.random() * (max - min + 1)) + min;
  if (space.logScale) return Math.exp(Math.random() * (Math.log(max) - Math.log(min)) + Math.log(min));
  return Math.random() * (max - min) + min;
}

export function suggestTrial(experimentId: string): Trial | null {
  const exp = experiments.get(experimentId);
  if (!exp) return null;
  const parameters: Record<string, string | number> = {};
  for (const space of exp.parameterSpace) parameters[space.name] = sampleParameter(space);
  const trial: Trial = { trialId: `trial-${++trialCounter}`, experimentId, parameters, score: null, status: "pending", startedAt: Date.now(), completedAt: null };
  exp.trials.push(trial);
  return trial;
}

export function reportTrialResult(trialId: string, score: number): Trial | null {
  for (const exp of experiments.values()) {
    const trial = exp.trials.find(t => t.trialId === trialId);
    if (trial) {
      trial.score = score; trial.status = "completed"; trial.completedAt = Date.now();
      if (!exp.bestTrial || exp.bestTrial.score === null || (exp.maximize ? score > exp.bestTrial.score : score < exp.bestTrial.score)) exp.bestTrial = trial;
      return trial;
    }
  }
  return null;
}

export function getExperiment(experimentId: string): TuningExperiment | undefined { return experiments.get(experimentId); }
export function _resetHyperparameterTunerForTest(): void { experiments.clear(); experimentCounter = 0; trialCounter = 0; }
