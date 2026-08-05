export interface PipelineStage {
  id: string;
  name: string;
  isActive: boolean;
  performanceScore: number;
  costWeight: number; // 1-10 scale
}

const pipelineStages: Record<string, PipelineStage> = {
  "adversarial_self_play": { id: "adversarial_self_play", name: "Adversarial Self-Play", isActive: true, performanceScore: 100, costWeight: 8 },
  "peer_review": { id: "peer_review", name: "Distributed Peer Review", isActive: true, performanceScore: 100, costWeight: 5 },
  "human_in_the_loop": { id: "human_in_the_loop", name: "Human Review", isActive: true, performanceScore: 100, costWeight: 10 },
  "causal_intervention": { id: "causal_intervention", name: "Causal Intervention", isActive: true, performanceScore: 100, costWeight: 3 }
};

/**
 * Evaluates the performance of a pipeline stage over the last N cycles.
 * If a stage is consistently passing with 100% resilience and high cost,
 * it may be temporarily suspended to save compute.
 */
export function evaluatePipelinePlasticity() {
  for (const [id, stage] of Object.entries(pipelineStages)) {
    if (stage.isActive && stage.performanceScore === 100 && stage.costWeight > 5) {
      // High cost, always passes -> temporary suspension
      console.log(`[Neuroplasticity] Suspending stage '${stage.name}' to save compute (performance is maxed).`);
      stage.isActive = false;
    } else if (!stage.isActive && stage.performanceScore < 95) {
      // Reactivate if performance drops
      console.log(`[Neuroplasticity] Reactivating stage '${stage.name}' due to performance drop.`);
      stage.isActive = true;
    }
  }
}

export function isStageActive(stageId: string): boolean {
  return pipelineStages[stageId]?.isActive ?? false;
}

export function recordStagePerformance(stageId: string, success: boolean) {
  const stage = pipelineStages[stageId];
  if (stage) {
    // Exponential moving average
    const alpha = 0.1;
    const value = success ? 100 : 0;
    stage.performanceScore = (alpha * value) + ((1 - alpha) * stage.performanceScore);
  }
}

export function getPipelineTopology() {
  return Object.values(pipelineStages).map(s => ({
    name: s.name,
    active: s.isActive,
    score: s.performanceScore.toFixed(1)
  }));
}
