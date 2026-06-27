/**
 * onlineLearner.ts — v90.0.0 "Adaptive Learning & Meta-Learning"
 * Online learning system that updates model weights incrementally from streaming data.
 */
export interface OnlineModel {
  modelId: string;
  name: string;
  weights: Record<string, number>;
  bias: number;
  learningRate: number;
  updateCount: number;
  cumulativeLoss: number;
  avgLoss: number;
  featureNames: string[];
}

export interface OnlineUpdate {
  updateId: string;
  modelId: string;
  input: Record<string, number>;
  trueLabel: number;
  prediction: number;
  loss: number;
  weightDeltas: Record<string, number>;
  timestamp: number;
}

const models = new Map<string, OnlineModel>();
const updateHistory: OnlineUpdate[] = [];
let modelCounter = 0;
let updateCounter = 0;

export function createOnlineModel(name: string, featureNames: string[], learningRate = 0.01): OnlineModel {
  const weights: Record<string, number> = {};
  for (const f of featureNames) weights[f] = 0;
  const model: OnlineModel = { modelId: `ol-${++modelCounter}`, name, weights, bias: 0, learningRate, updateCount: 0, cumulativeLoss: 0, avgLoss: 0, featureNames };
  models.set(model.modelId, model);
  return model;
}

export function predict(modelId: string, input: Record<string, number>): number {
  const model = models.get(modelId);
  if (!model) return 0;
  let score = model.bias;
  for (const f of model.featureNames) score += (model.weights[f] ?? 0) * (input[f] ?? 0);
  return 1 / (1 + Math.exp(-score)); // sigmoid
}

export function updateModel(modelId: string, input: Record<string, number>, trueLabel: number): OnlineUpdate | null {
  const model = models.get(modelId);
  if (!model) return null;

  const prediction = predict(modelId, input);
  const error = trueLabel - prediction;
  const loss = 0.5 * error * error;

  const weightDeltas: Record<string, number> = {};
  for (const f of model.featureNames) {
    const delta = model.learningRate * error * (input[f] ?? 0);
    model.weights[f] = (model.weights[f] ?? 0) + delta;
    weightDeltas[f] = delta;
  }
  model.bias += model.learningRate * error;
  model.updateCount++;
  model.cumulativeLoss += loss;
  model.avgLoss = model.cumulativeLoss / model.updateCount;

  const update: OnlineUpdate = {
    updateId: `upd-${++updateCounter}`,
    modelId, input, trueLabel, prediction, loss, weightDeltas,
    timestamp: Date.now(),
  };
  updateHistory.push(update);
  return update;
}

export function batchUpdate(modelId: string, examples: Array<{ input: Record<string, number>; label: number }>): number {
  let totalLoss = 0;
  for (const ex of examples) {
    const upd = updateModel(modelId, ex.input, ex.label);
    if (upd) totalLoss += upd.loss;
  }
  return examples.length > 0 ? totalLoss / examples.length : 0;
}

export function getModel(modelId: string): OnlineModel | undefined { return models.get(modelId); }
export function getUpdateHistory(modelId: string, limit = 50): OnlineUpdate[] { return updateHistory.filter(u => u.modelId === modelId).slice(-limit); }
export function _resetOnlineLearnerForTest(): void { models.clear(); updateHistory.length = 0; modelCounter = 0; updateCounter = 0; }
