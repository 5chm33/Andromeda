/**
 * Energy Profiler — profiles and optimizes energy consumption of AI operations.
 * Tracks compute-energy tradeoffs and implements green AI strategies.
 */

export interface EnergyProfile {
  operationId: string;
  operationType: string;
  estimatedFlops: number;
  energyJoules: number;
  carbonGrams: number;
  efficiency: number;  // flops per joule
  timestamp: number;
}

export interface EnergyBudget {
  dailyJoules: number;
  usedJoules: number;
  remainingJoules: number;
  utilizationRate: number;
}

export interface EnergyReport {
  totalOperations: number;
  totalEnergyJoules: number;
  totalCarbonGrams: number;
  avgEfficiency: number;
  mostExpensiveOperation: string;
}

class EnergyProfilerEngine {
  private profiles: EnergyProfile[] = [];
  private budget: EnergyBudget = {
    dailyJoules: 1000,
    usedJoules: 0,
    remainingJoules: 1000,
    utilizationRate: 0,
  };
  private counter = 0;
  private readonly CARBON_INTENSITY = 0.4; // gCO2/Wh (global avg)
  private readonly JOULES_PER_GFLOP = 0.001; // ~1mJ per GFLOP (modern GPU)

  profileOperation(operationType: string, estimatedFlops: number): EnergyProfile {
    const energyJoules = estimatedFlops * this.JOULES_PER_GFLOP;
    const carbonGrams = (energyJoules / 3600) * this.CARBON_INTENSITY;
    const efficiency = energyJoules > 0 ? estimatedFlops / energyJoules : 0;

    this.budget.usedJoules += energyJoules;
    this.budget.remainingJoules = Math.max(0, this.budget.dailyJoules - this.budget.usedJoules);
    this.budget.utilizationRate = this.budget.usedJoules / this.budget.dailyJoules;

    const profile: EnergyProfile = {
      operationId: `op-${++this.counter}`,
      operationType, estimatedFlops, energyJoules, carbonGrams, efficiency,
      timestamp: Date.now(),
    };
    this.profiles.push(profile);
    return profile;
  }

  getEnergyBudget(): EnergyBudget { return { ...this.budget }; }

  getEnergyReport(): EnergyReport {
    const mostExpensive = this.profiles.reduce(
      (max, p) => p.energyJoules > (max?.energyJoules ?? 0) ? p : max,
      this.profiles[0]
    );
    return {
      totalOperations: this.profiles.length,
      totalEnergyJoules: this.profiles.reduce((s, p) => s + p.energyJoules, 0),
      totalCarbonGrams: this.profiles.reduce((s, p) => s + p.carbonGrams, 0),
      avgEfficiency: this.profiles.length > 0
        ? this.profiles.reduce((s, p) => s + p.efficiency, 0) / this.profiles.length
        : 0,
      mostExpensiveOperation: mostExpensive?.operationType ?? "none",
    };
  }
}

export const globalEnergyProfiler = new EnergyProfilerEngine();

export function profileOperation(operationType: string, estimatedFlops: number): EnergyProfile {
  return globalEnergyProfiler.profileOperation(operationType, estimatedFlops);
}
export function getEnergyBudget(): EnergyBudget { return globalEnergyProfiler.getEnergyBudget(); }
export function getEnergyReport(): EnergyReport { return globalEnergyProfiler.getEnergyReport(); }
export function initEnergyProfiler(): void {
  console.log("[EnergyProfiler] Energy Profiler initialized.");
}
