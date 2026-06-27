/**
 * experimentTracker.ts — v77.0.0 "Feature Flags & Experimentation"
 * Tracks experiment lifecycle events: creation, activation, pausing, and completion.
 */
export type ExperimentLifecycleStatus = "draft" | "running" | "paused" | "completed" | "archived";

export interface ExperimentRecord {
  recordId: string;
  experimentId: string;
  name: string;
  hypothesis: string;
  status: ExperimentLifecycleStatus;
  startedAt: number | null;
  completedAt: number | null;
  owner: string;
  tags: string[];
  notes: string[];
}

const records = new Map<string, ExperimentRecord>();
let recordCounter = 0;

export function trackExperiment(experimentId: string, name: string, hypothesis: string, owner: string, tags: string[] = []): ExperimentRecord {
  const record: ExperimentRecord = {
    recordId: `exp-record-${++recordCounter}`,
    experimentId, name, hypothesis, status: "draft",
    startedAt: null, completedAt: null, owner, tags, notes: [],
  };
  records.set(experimentId, record);
  return record;
}

export function updateExperimentStatus(experimentId: string, status: ExperimentLifecycleStatus, note?: string): boolean {
  const record = records.get(experimentId);
  if (!record) return false;
  record.status = status;
  if (status === "running" && !record.startedAt) record.startedAt = Date.now();
  if (status === "completed" || status === "archived") record.completedAt = Date.now();
  if (note) record.notes.push(`[${new Date().toISOString()}] ${note}`);
  return true;
}

export function addNote(experimentId: string, note: string): boolean {
  const record = records.get(experimentId);
  if (!record) return false;
  record.notes.push(`[${new Date().toISOString()}] ${note}`);
  return true;
}

export function getExperimentRecord(experimentId: string): ExperimentRecord | undefined { return records.get(experimentId); }
export function getAllExperimentRecords(): ExperimentRecord[] { return [...records.values()]; }
export function getRunningExperiments(): ExperimentRecord[] { return [...records.values()].filter(r => r.status === "running"); }
export function _resetExperimentTrackerForTest(): void { records.clear(); recordCounter = 0; }
