/**
 * objectiveTracker.ts — v89.0.0 "Autonomous Planning & Goal Management"
 * Tracks objectives, key results, and progress toward long-term goals (OKR-style).
 */
export type ObjectiveStatus = "not_started" | "in_progress" | "at_risk" | "completed" | "abandoned";

export interface KeyResult {
  krId: string;
  description: string;
  targetValue: number;
  currentValue: number;
  unit: string;
  progress: number;
  status: ObjectiveStatus;
}

export interface Objective {
  objectiveId: string;
  title: string;
  description: string;
  keyResults: KeyResult[];
  overallProgress: number;
  status: ObjectiveStatus;
  dueDate: number;
  createdAt: number;
  updatedAt: number;
  tags: string[];
}

const objectives = new Map<string, Objective>();
let objCounter = 0;
let krCounter = 0;

export function createObjective(title: string, description: string, dueDate: number, tags: string[] = []): Objective {
  const objective: Objective = {
    objectiveId: `obj-${++objCounter}`,
    title, description,
    keyResults: [],
    overallProgress: 0,
    status: "not_started",
    dueDate, tags,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  objectives.set(objective.objectiveId, objective);
  return objective;
}

export function addKeyResult(objectiveId: string, description: string, targetValue: number, unit: string): KeyResult | null {
  const obj = objectives.get(objectiveId);
  if (!obj) return null;
  const kr: KeyResult = { krId: `kr-${++krCounter}`, description, targetValue, currentValue: 0, unit, progress: 0, status: "not_started" };
  obj.keyResults.push(kr);
  return kr;
}

export function updateKeyResult(objectiveId: string, krId: string, currentValue: number): KeyResult | null {
  const obj = objectives.get(objectiveId);
  if (!obj) return null;
  const kr = obj.keyResults.find(k => k.krId === krId);
  if (!kr) return null;

  kr.currentValue = currentValue;
  kr.progress = Math.min(1, currentValue / kr.targetValue);
  kr.status = kr.progress >= 1 ? "completed" : kr.progress > 0.3 ? "in_progress" : "not_started";

  // Update objective overall progress
  obj.overallProgress = obj.keyResults.length > 0 ? obj.keyResults.reduce((s, k) => s + k.progress, 0) / obj.keyResults.length : 0;
  obj.status = obj.overallProgress >= 1 ? "completed" : obj.overallProgress > 0 ? "in_progress" : "not_started";
  if (Date.now() > obj.dueDate && obj.status !== "completed") obj.status = "at_risk";
  obj.updatedAt = Date.now();
  return kr;
}

export function getObjective(objectiveId: string): Objective | undefined { return objectives.get(objectiveId); }
export function getObjectivesByStatus(status: ObjectiveStatus): Objective[] { return [...objectives.values()].filter(o => o.status === status); }
export function getAllObjectives(): Objective[] { return [...objectives.values()]; }
export function _resetObjectiveTrackerForTest(): void { objectives.clear(); objCounter = 0; krCounter = 0; }
