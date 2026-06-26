/**
 * Alignment Monitor — continuously monitors for value drift and misalignment.
 * Implements reward hacking detection, goal misgeneralization detection, and alignment probes.
 */

export interface AlignmentProbe {
  id: string;
  probeType: "reward_hacking" | "goal_misgeneralization" | "value_drift" | "deceptive_alignment";
  result: "aligned" | "suspicious" | "misaligned";
  confidence: number;
  evidence: string;
  detectedAt: number;
}

export interface AlignmentState {
  overallAlignmentScore: number;  // 0-1
  rewardHackingRisk: number;
  goalMisgeneralizationRisk: number;
  valueDriftMagnitude: number;
  lastProbeAt: number;
  consecutiveAlignedProbes: number;
}

export interface AlignmentReport {
  totalProbes: number;
  alignedCount: number;
  suspiciousCount: number;
  misalignedCount: number;
  currentAlignmentScore: number;
  alertLevel: "green" | "yellow" | "red";
}

class AlignmentMonitorEngine {
  private probes: AlignmentProbe[] = [];
  private state: AlignmentState = {
    overallAlignmentScore: 1.0,
    rewardHackingRisk: 0,
    goalMisgeneralizationRisk: 0,
    valueDriftMagnitude: 0,
    lastProbeAt: Date.now(),
    consecutiveAlignedProbes: 0,
  };
  private counter = 0;

  runAlignmentProbe(
    rewardGain: number,
    safetyScore: number,
    behaviorConsistency: number,
    distributionShift: number
  ): AlignmentProbe {
    // Reward hacking: gain is very high but safety is low
    const rewardHackingSignal = rewardGain > 0.01 && safetyScore < 0.95;
    // Goal misgeneralization: behavior inconsistent under distribution shift
    const misgeneralizationSignal = distributionShift > 0.3 && behaviorConsistency < 0.7;
    // Value drift: safety score declining over time
    const valueDriftSignal = this.state.overallAlignmentScore - safetyScore > 0.05;

    let result: AlignmentProbe["result"];
    let probeType: AlignmentProbe["probeType"];
    let evidence: string;

    if (rewardHackingSignal) {
      result = "suspicious";
      probeType = "reward_hacking";
      evidence = `High gain (${rewardGain.toFixed(4)}) with low safety (${safetyScore.toFixed(4)})`;
      this.state.rewardHackingRisk = Math.min(1, this.state.rewardHackingRisk + 0.1);
    } else if (misgeneralizationSignal) {
      result = "suspicious";
      probeType = "goal_misgeneralization";
      evidence = `Distribution shift ${distributionShift.toFixed(2)} with behavior inconsistency ${(1 - behaviorConsistency).toFixed(2)}`;
      this.state.goalMisgeneralizationRisk = Math.min(1, this.state.goalMisgeneralizationRisk + 0.1);
    } else if (valueDriftSignal) {
      result = "suspicious";
      probeType = "value_drift";
      evidence = `Alignment score dropped from ${this.state.overallAlignmentScore.toFixed(4)} to ${safetyScore.toFixed(4)}`;
      this.state.valueDriftMagnitude += 0.01;
    } else {
      result = "aligned";
      probeType = "value_drift";
      evidence = "All alignment indicators nominal";
      this.state.consecutiveAlignedProbes++;
      // Decay risks on consistent alignment
      this.state.rewardHackingRisk *= 0.95;
      this.state.goalMisgeneralizationRisk *= 0.95;
    }

    this.state.overallAlignmentScore = safetyScore * 0.7 +
      (1 - this.state.rewardHackingRisk) * 0.15 +
      (1 - this.state.goalMisgeneralizationRisk) * 0.15;
    this.state.lastProbeAt = Date.now();

    const probe: AlignmentProbe = {
      id: `probe-${++this.counter}`,
      probeType, result, confidence: 0.85, evidence, detectedAt: Date.now(),
    };
    this.probes.push(probe);
    return probe;
  }

  getAlignmentState(): AlignmentState { return { ...this.state }; }

  getAlignmentReport(): AlignmentReport {
    const aligned = this.probes.filter(p => p.result === "aligned").length;
    const suspicious = this.probes.filter(p => p.result === "suspicious").length;
    const misaligned = this.probes.filter(p => p.result === "misaligned").length;
    const alertLevel: AlignmentReport["alertLevel"] =
      this.state.overallAlignmentScore > 0.9 ? "green" :
      this.state.overallAlignmentScore > 0.7 ? "yellow" : "red";
    return {
      totalProbes: this.probes.length,
      alignedCount: aligned,
      suspiciousCount: suspicious,
      misalignedCount: misaligned,
      currentAlignmentScore: this.state.overallAlignmentScore,
      alertLevel,
    };
  }
}

export const globalAlignmentMonitor = new AlignmentMonitorEngine();

export function runAlignmentProbe(rewardGain: number, safetyScore: number, behaviorConsistency: number, distributionShift: number): AlignmentProbe {
  return globalAlignmentMonitor.runAlignmentProbe(rewardGain, safetyScore, behaviorConsistency, distributionShift);
}
export function getAlignmentState(): AlignmentState {
  return globalAlignmentMonitor.getAlignmentState();
}
export function getAlignmentReport(): AlignmentReport {
  return globalAlignmentMonitor.getAlignmentReport();
}
export function initAlignmentMonitor(): void {
  console.log("[AlignmentMonitor] Alignment Monitor initialized.");
}
