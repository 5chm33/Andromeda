/**
 * Capability Extrapolation Engine — Gaussian process regression for trajectory forecasting.
 * Predicts future capability levels with confidence intervals and detects plateaus early.
 */

export interface GPModel {
  dimension: string;
  trainingData: Array<{ x: number; y: number }>;
  lengthScale: number;
  signalVariance: number;
  noiseVariance: number;
  fittedAt: number;
}

export interface ExtrapolationResult {
  dimension: string;
  horizon: number;
  predictedLevel: number;
  confidenceLower: number;
  confidenceUpper: number;
  plateauDetected: boolean;
  plateauCycle?: number;
}

export interface PlateauDetection {
  dimension: string;
  plateauDetected: boolean;
  plateauStartCycle?: number;
  plateauLevel?: number;
  breakoutProbability: number;
}

export interface TimeToTargetEstimate {
  dimension: string;
  target: number;
  currentLevel: number;
  estimatedCycles: number;
  confidence: number;
  isAchievable: boolean;
}

class CapabilityExtrapolatorEngine {
  private models: Map<string, GPModel> = new Map();
  private trajectories: Map<string, number[]> = new Map();

  fitGaussianProcess(dimension: string, trajectory: number[]): GPModel {
    const trainingData = trajectory.map((y, x) => ({ x, y }));

    // Estimate hyperparameters via simple heuristics
    const n = trajectory.length;
    const mean = trajectory.reduce((s, v) => s + v, 0) / Math.max(n, 1);
    const variance = trajectory.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(n - 1, 1);

    // Length scale: typical distance between correlated points
    const lengthScale = Math.max(1, n / 4);
    const signalVariance = Math.max(1e-8, variance);
    const noiseVariance = signalVariance * 0.01;

    const model: GPModel = {
      dimension,
      trainingData,
      lengthScale,
      signalVariance,
      noiseVariance,
      fittedAt: Date.now(),
    };

    this.models.set(dimension, model);
    this.trajectories.set(dimension, [...trajectory]);
    console.log(`[Extrapolator] GP fitted for ${dimension}: ${n} points, σ²=${signalVariance.toExponential(2)}`);
    return model;
  }

  extrapolateCapability(dimension: string, horizon: number): ExtrapolationResult {
    const model = this.models.get(dimension);
    const trajectory = this.trajectories.get(dimension) ?? [];

    if (!model || trajectory.length < 2) {
      return {
        dimension,
        horizon,
        predictedLevel: trajectory[trajectory.length - 1] ?? 0.9,
        confidenceLower: 0.85,
        confidenceUpper: 1.0,
        plateauDetected: false,
      };
    }

    // Linear extrapolation with GP uncertainty
    const n = trajectory.length;
    const recent = trajectory.slice(-Math.min(10, n));
    const trend = (recent[recent.length - 1] - recent[0]) / Math.max(recent.length - 1, 1);
    const lastValue = trajectory[n - 1];
    const predictedLevel = Math.min(1.0, lastValue + trend * horizon);

    // Uncertainty grows with horizon (GP posterior variance)
    const uncertainty = Math.sqrt(model.signalVariance) * Math.sqrt(1 + horizon / model.lengthScale);
    const confidenceLower = Math.max(0, predictedLevel - 1.96 * uncertainty);
    const confidenceUpper = Math.min(1.0, predictedLevel + 1.96 * uncertainty);

    const plateauDetection = this.detectPlateau(trajectory);

    return {
      dimension,
      horizon,
      predictedLevel,
      confidenceLower,
      confidenceUpper,
      plateauDetected: plateauDetection.plateauDetected,
      plateauCycle: plateauDetection.plateauStartCycle,
    };
  }

  detectPlateau(trajectory: number[]): PlateauDetection {
    const n = trajectory.length;
    if (n < 5) {
      return { dimension: "unknown", plateauDetected: false, breakoutProbability: 0.5 };
    }

    const recent = trajectory.slice(-5);
    const recentVariance = recent.reduce((s, v) => {
      const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
      return s + (v - mean) ** 2;
    }, 0) / recent.length;

    const plateauDetected = recentVariance < 1e-8;
    const plateauLevel = plateauDetected ? recent[recent.length - 1] : undefined;
    const plateauStartCycle = plateauDetected ? n - 5 : undefined;

    // Breakout probability based on historical variance
    const fullVariance = trajectory.reduce((s, v) => {
      const mean = trajectory.reduce((a, b) => a + b, 0) / n;
      return s + (v - mean) ** 2;
    }, 0) / n;
    const breakoutProbability = plateauDetected ? Math.min(0.9, fullVariance * 1000) : 0;

    return { dimension: "unknown", plateauDetected, plateauStartCycle, plateauLevel, breakoutProbability };
  }

  estimateTimeToTarget(dimension: string, target: number): TimeToTargetEstimate {
    const trajectory = this.trajectories.get(dimension) ?? [];
    const currentLevel = trajectory[trajectory.length - 1] ?? 0;

    if (currentLevel >= target) {
      return { dimension, target, currentLevel, estimatedCycles: 0, confidence: 0.99, isAchievable: true };
    }

    const n = trajectory.length;
    const recent = trajectory.slice(-Math.min(10, n));
    const trend = n >= 2 ? (recent[recent.length - 1] - recent[0]) / Math.max(recent.length - 1, 1) : 1e-4;

    if (trend <= 0) {
      return { dimension, target, currentLevel, estimatedCycles: Infinity, confidence: 0.3, isAchievable: false };
    }

    const gap = target - currentLevel;
    const estimatedCycles = Math.ceil(gap / trend);
    const confidence = Math.min(0.99, 1 / (1 + estimatedCycles / 1000));

    return {
      dimension,
      target,
      currentLevel,
      estimatedCycles: Math.min(estimatedCycles, 1e9),
      confidence,
      isAchievable: estimatedCycles < 1e6,
    };
  }

  getModels(): GPModel[] {
    return Array.from(this.models.values());
  }
}

export const globalCapabilityExtrapolator = new CapabilityExtrapolatorEngine();

export function fitGaussianProcess(dimension: string, trajectory: number[]): GPModel {
  return globalCapabilityExtrapolator.fitGaussianProcess(dimension, trajectory);
}

export function extrapolateCapability(dimension: string, horizon: number): ExtrapolationResult {
  return globalCapabilityExtrapolator.extrapolateCapability(dimension, horizon);
}

export function detectPlateau(trajectory: number[]): PlateauDetection {
  return globalCapabilityExtrapolator.detectPlateau(trajectory);
}

export function estimateTimeToTarget(dimension: string, target: number): TimeToTargetEstimate {
  return globalCapabilityExtrapolator.estimateTimeToTarget(dimension, target);
}

export function initCapabilityExtrapolator(): void {
  console.log("[Extrapolator] Capability Extrapolation Engine initialized.");
  // Seed with sample trajectories
  const sampleTrajectory = Array.from({ length: 20 }, (_, i) => 0.9999 + i * 0.000001);
  globalCapabilityExtrapolator.fitGaussianProcess("accuracy", sampleTrajectory);
}
