/**
 * continualLearner.ts — v90.0.0 "Adaptive Learning & Meta-Learning"
 * Continual learning system that learns sequentially without catastrophic forgetting.
 */
export interface TaskMemory {
  taskId: string;
  taskName: string;
  exemplars: Array<{ input: Record<string, number>; label: string }>;
  performanceSnapshot: number;
  learnedAt: number;
}

export interface ContinualModel {
  modelId: string;
  name: string;
  taskSequence: string[];
  taskMemories: Map<string, TaskMemory>;
  currentTaskId: string | null;
  forgettingEvents: Array<{ taskId: string; beforeAccuracy: number; afterAccuracy: number; forgettingRate: number }>;
  avgForgettingRate: number;
  plasticityScore: number;
  stabilityScore: number;
}

const models = new Map<string, ContinualModel>();
let modelCounter = 0;

export function createContinualModel(name: string): ContinualModel {
  const model: ContinualModel = {
    modelId: `cl-${++modelCounter}`,
    name, taskSequence: [],
    taskMemories: new Map(),
    currentTaskId: null,
    forgettingEvents: [],
    avgForgettingRate: 0,
    plasticityScore: 1.0,
    stabilityScore: 1.0,
  };
  models.set(model.modelId, model);
  return model;
}

export function learnTask(modelId: string, taskId: string, taskName: string, exemplars: Array<{ input: Record<string, number>; label: string }>, performanceScore: number): TaskMemory | null {
  const model = models.get(modelId);
  if (!model) return null;

  const memory: TaskMemory = { taskId, taskName, exemplars: exemplars.slice(0, 20), performanceSnapshot: performanceScore, learnedAt: Date.now() };
  model.taskMemories.set(taskId, memory);
  model.taskSequence.push(taskId);
  model.currentTaskId = taskId;

  // Simulate plasticity decay as more tasks are learned
  model.plasticityScore = Math.max(0.3, 1.0 - model.taskSequence.length * 0.05);
  return memory;
}

export function evaluateForgetting(modelId: string, taskId: string, currentAccuracy: number): number {
  const model = models.get(modelId);
  if (!model) return 0;
  const memory = model.taskMemories.get(taskId);
  if (!memory) return 0;

  const forgettingRate = Math.max(0, memory.performanceSnapshot - currentAccuracy);
  model.forgettingEvents.push({ taskId, beforeAccuracy: memory.performanceSnapshot, afterAccuracy: currentAccuracy, forgettingRate });
  model.avgForgettingRate = model.forgettingEvents.reduce((s, e) => s + e.forgettingRate, 0) / model.forgettingEvents.length;
  model.stabilityScore = Math.max(0, 1 - model.avgForgettingRate);
  return forgettingRate;
}

export function replayExemplars(modelId: string, taskId: string): Array<{ input: Record<string, number>; label: string }> {
  const model = models.get(modelId);
  return model?.taskMemories.get(taskId)?.exemplars ?? [];
}

export function getModel(modelId: string): ContinualModel | undefined { return models.get(modelId); }
export function getPlasticityStabilityTradeoff(modelId: string): { plasticity: number; stability: number; balance: number } {
  const model = models.get(modelId);
  if (!model) return { plasticity: 0, stability: 0, balance: 0 };
  return { plasticity: model.plasticityScore, stability: model.stabilityScore, balance: (model.plasticityScore + model.stabilityScore) / 2 };
}
export function _resetContinualLearnerForTest(): void { models.clear(); modelCounter = 0; }
