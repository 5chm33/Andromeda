/**
 * jobQueue.ts — v84.0.0 "Workflow & Task Automation"
 * Priority-based job queue with concurrency control and job lifecycle management.
 */
export type JobStatus = "queued" | "processing" | "completed" | "failed" | "cancelled";
export type JobPriority = "critical" | "high" | "normal" | "low";

const PRIORITY_ORDER: Record<JobPriority, number> = { critical: 0, high: 1, normal: 2, low: 3 };

export interface Job {
  jobId: string;
  type: string;
  payload: Record<string, unknown>;
  priority: JobPriority;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  enqueuedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  result: unknown;
  error: string | null;
}

const queue: Job[] = [];
const processing = new Map<string, Job>();
const completed: Job[] = [];
let jobCounter = 0;

export function enqueue(type: string, payload: Record<string, unknown>, priority: JobPriority = "normal", maxAttempts = 3): Job {
  const job: Job = {
    jobId: `job-${++jobCounter}`,
    type, payload, priority,
    status: "queued",
    attempts: 0,
    maxAttempts,
    enqueuedAt: Date.now(),
    startedAt: null,
    completedAt: null,
    result: null,
    error: null,
  };
  queue.push(job);
  queue.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || a.enqueuedAt - b.enqueuedAt);
  return job;
}

export function dequeue(): Job | null {
  const job = queue.shift();
  if (!job) return null;
  job.status = "processing";
  job.startedAt = Date.now();
  job.attempts++;
  processing.set(job.jobId, job);
  return job;
}

export function completeJob(jobId: string, result: unknown = null): boolean {
  const job = processing.get(jobId);
  if (!job) return false;
  job.status = "completed";
  job.completedAt = Date.now();
  job.result = result;
  processing.delete(jobId);
  completed.push(job);
  return true;
}

export function failJob(jobId: string, error: string): boolean {
  const job = processing.get(jobId);
  if (!job) return false;
  job.error = error;
  processing.delete(jobId);
  if (job.attempts < job.maxAttempts) {
    job.status = "queued";
    queue.push(job);
    queue.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || a.enqueuedAt - b.enqueuedAt);
  } else {
    job.status = "failed";
    completed.push(job);
  }
  return true;
}

export function getQueueDepth(): number { return queue.length; }
export function getProcessingCount(): number { return processing.size; }
export function getCompletedJobs(): Job[] { return [...completed]; }
export function getJob(jobId: string): Job | undefined { return queue.find(j => j.jobId === jobId) ?? processing.get(jobId) ?? completed.find(j => j.jobId === jobId); }
export function _resetJobQueueForTest(): void { queue.length = 0; processing.clear(); completed.length = 0; jobCounter = 0; }
