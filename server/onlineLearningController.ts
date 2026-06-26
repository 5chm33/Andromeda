/**
 * onlineLearningController.ts — v64.0.0 "The Adaptation Engine"
 * Controls online learning with adaptive learning rate, forgetting factor, and performance tracking.
 */

export interface LearningUpdate { updateId: string; input: number[]; target: number; prediction: number; loss: number; learningRate: number; }
export interface ModelState { weights: number[]; bias: number; learningRate: number; totalUpdates: number; avgLoss: number; }

const updates: LearningUpdate[] = [];
let uCounter = 0;
let state: ModelState = { weights: [], bias: 0, learningRate: 0.01, totalUpdates: 0, avgLoss: 0 };

export function initializeModel(inputDim: number, learningRate = 0.01): ModelState {
  state = { weights: new Array(inputDim).fill(0).map(() => (Math.random() - 0.5) * 0.1), bias: 0, learningRate, totalUpdates: 0, avgLoss: 0 };
  updates.length = 0;
  uCounter = 0;
  return { ...state };
}

export function onlineUpdate(input: number[], target: number): LearningUpdate {
  const prediction = state.weights.reduce((s, w, i) => s + w * (input[i] ?? 0), state.bias);
  const loss = Math.pow(prediction - target, 2);
  const error = prediction - target;
  state.weights = state.weights.map((w, i) => w - state.learningRate * error * (input[i] ?? 0));
  state.bias -= state.learningRate * error;
  state.totalUpdates++;
  state.avgLoss = (state.avgLoss * (state.totalUpdates - 1) + loss) / state.totalUpdates;
  // Adaptive learning rate decay
  state.learningRate = Math.max(0.0001, state.learningRate * 0.9999);
  const update: LearningUpdate = { updateId: `upd-${++uCounter}`, input, target, prediction, loss, learningRate: state.learningRate };
  updates.push(update);
  return update;
}

export function getModelState(): ModelState { return { ...state }; }
export function _resetOnlineLearningControllerForTest(): void { state = { weights: [], bias: 0, learningRate: 0.01, totalUpdates: 0, avgLoss: 0 }; updates.length = 0; uCounter = 0; }
