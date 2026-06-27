/**
 * metaLearner.ts — v90.0.0 "Adaptive Learning & Meta-Learning"
 * Meta-learning system that learns how to learn — tracks task performance across episodes
 * and adapts hyperparameters for faster convergence on new tasks.
 */
export interface MetaTask {
  taskId: string;
  name: string;
  taskType: string;
  supportExamples: Array<{ input: Record<string, number>; label: string }>;
  queryExamples: Array<{ input: Record<string, number>; label: string }>;
}

export interface MetaEpisode {
  episodeId: string;
  taskId: string;
  initialAccuracy: number;
  finalAccuracy: number;
  adaptationSteps: number;
  learningRate: number;
  improvementRate: number;
  completedAt: number;
}

export interface MetaModel {
  modelId: string;
  name: string;
  episodes: MetaEpisode[];
  avgAdaptationSteps: number;
  avgImprovementRate: number;
  bestLearningRate: number;
  taskTypePerformance: Record<string, { avgAccuracy: number; count: number }>;
}

const models = new Map<string, MetaModel>();
let modelCounter = 0;
let episodeCounter = 0;

export function createMetaModel(name: string): MetaModel {
  const model: MetaModel = {
    modelId: `meta-${++modelCounter}`,
    name, episodes: [],
    avgAdaptationSteps: 0,
    avgImprovementRate: 0,
    bestLearningRate: 0.01,
    taskTypePerformance: {},
  };
  models.set(model.modelId, model);
  return model;
}

export function recordEpisode(modelId: string, task: MetaTask, initialAccuracy: number, finalAccuracy: number, adaptationSteps: number, learningRate: number): MetaEpisode | null {
  const model = models.get(modelId);
  if (!model) return null;

  const improvementRate = adaptationSteps > 0 ? (finalAccuracy - initialAccuracy) / adaptationSteps : 0;
  const episode: MetaEpisode = {
    episodeId: `ep-${++episodeCounter}`,
    taskId: task.taskId,
    initialAccuracy, finalAccuracy, adaptationSteps, learningRate, improvementRate,
    completedAt: Date.now(),
  };
  model.episodes.push(episode);

  // Update model statistics
  model.avgAdaptationSteps = model.episodes.reduce((s, e) => s + e.adaptationSteps, 0) / model.episodes.length;
  model.avgImprovementRate = model.episodes.reduce((s, e) => s + e.improvementRate, 0) / model.episodes.length;

  // Track best learning rate (highest improvement rate)
  const bestEp = model.episodes.reduce((best, e) => e.improvementRate > best.improvementRate ? e : best, model.episodes[0]);
  model.bestLearningRate = bestEp.learningRate;

  // Update task type performance
  if (!model.taskTypePerformance[task.taskType]) model.taskTypePerformance[task.taskType] = { avgAccuracy: 0, count: 0 };
  const tp = model.taskTypePerformance[task.taskType];
  tp.avgAccuracy = (tp.avgAccuracy * tp.count + finalAccuracy) / (tp.count + 1);
  tp.count++;

  return episode;
}

export function recommendLearningRate(modelId: string, taskType: string): number {
  const model = models.get(modelId);
  if (!model || model.episodes.length === 0) return 0.01;
  const typeEpisodes = model.episodes.filter(e => e.improvementRate > 0);
  if (typeEpisodes.length === 0) return model.bestLearningRate;
  return typeEpisodes.reduce((best, e) => e.improvementRate > best.improvementRate ? e : best).learningRate;
}

export function getMetaModel(modelId: string): MetaModel | undefined { return models.get(modelId); }
export function _resetMetaLearnerForTest(): void { models.clear(); modelCounter = 0; episodeCounter = 0; }
