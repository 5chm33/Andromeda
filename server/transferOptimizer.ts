/**
 * transferOptimizer.ts — v64.0.0 "The Adaptation Engine"
 * Optimizes transfer learning by selecting source tasks and fine-tuning strategies.
 */

export interface TransferTask { taskId: string; name: string; domain: string; performance: number; transferability: number; }
export interface TransferPlan { planId: string; targetTask: string; selectedSources: TransferTask[]; strategy: "full_finetune" | "feature_extraction" | "progressive"; estimatedGain: number; }

const tasks = new Map<string, TransferTask>();
const plans: TransferPlan[] = [];
let tCounter = 0, pCounter = 0;

export function registerTransferTask(name: string, domain: string, performance: number, transferability: number): TransferTask {
  const task: TransferTask = { taskId: `ttask-${++tCounter}`, name, domain, performance, transferability };
  tasks.set(name, task);
  return task;
}

export function planTransfer(targetTaskName: string, targetDomain: string): TransferPlan {
  const candidates = [...tasks.values()].filter(t => t.name !== targetTaskName);
  const scored = candidates.map(t => ({ task: t, score: t.transferability * (t.domain === targetDomain ? 1.5 : 0.8) * t.performance }));
  scored.sort((a, b) => b.score - a.score);
  const selected = scored.slice(0, 3).map(s => s.task);
  const avgTransferability = selected.length > 0 ? selected.reduce((s, t) => s + t.transferability, 0) / selected.length : 0;
  const strategy: TransferPlan["strategy"] = avgTransferability > 0.8 ? "feature_extraction" : avgTransferability > 0.5 ? "progressive" : "full_finetune";
  const estimatedGain = selected.reduce((s, t) => s + t.transferability * 0.1, 0);
  const plan: TransferPlan = { planId: `plan-${++pCounter}`, targetTask: targetTaskName, selectedSources: selected, strategy, estimatedGain };
  plans.push(plan);
  return plan;
}

export function getTransferPlans(): TransferPlan[] { return [...plans]; }
export function _resetTransferOptimizerForTest(): void { tasks.clear(); plans.length = 0; tCounter = 0; pCounter = 0; }
