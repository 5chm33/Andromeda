/**
 * retryManager.ts — v84.0.0 "Workflow & Task Automation"
 * Manages retry policies with exponential backoff, jitter, and dead-letter routing.
 */
export type BackoffStrategy = "fixed" | "exponential" | "linear";

export interface RetryPolicy {
  policyId: string;
  name: string;
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffStrategy: BackoffStrategy;
  jitterPercent: number;
  retryableErrors: string[];
}

export interface RetryAttempt {
  attemptId: string;
  operationId: string;
  attemptNumber: number;
  delayMs: number;
  scheduledAt: number;
  outcome: "success" | "failure" | "pending";
  error: string | null;
}

const policies = new Map<string, RetryPolicy>();
const attempts: RetryAttempt[] = [];
let policyCounter = 0;
let attemptCounter = 0;

export function createRetryPolicy(name: string, params: Omit<RetryPolicy, "policyId" | "name">): RetryPolicy {
  const policy: RetryPolicy = { policyId: `rp-${++policyCounter}`, name, ...params };
  policies.set(policy.policyId, policy);
  return policy;
}

export function computeDelay(policyId: string, attemptNumber: number): number {
  const policy = policies.get(policyId);
  if (!policy) return 0;

  let delay: number;
  if (policy.backoffStrategy === "fixed") {
    delay = policy.baseDelayMs;
  } else if (policy.backoffStrategy === "exponential") {
    delay = policy.baseDelayMs * Math.pow(2, attemptNumber - 1);
  } else {
    delay = policy.baseDelayMs * attemptNumber;
  }

  delay = Math.min(delay, policy.maxDelayMs);

  // Add jitter
  const jitter = delay * (policy.jitterPercent / 100) * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(delay + jitter));
}

export function shouldRetry(policyId: string, attemptNumber: number, error: string): boolean {
  const policy = policies.get(policyId);
  if (!policy) return false;
  if (attemptNumber >= policy.maxAttempts) return false;
  if (policy.retryableErrors.length > 0 && !policy.retryableErrors.some(e => error.includes(e))) return false;
  return true;
}

export function recordAttempt(operationId: string, attemptNumber: number, delayMs: number, outcome: RetryAttempt["outcome"], error: string | null = null): RetryAttempt {
  const attempt: RetryAttempt = {
    attemptId: `attempt-${++attemptCounter}`,
    operationId, attemptNumber, delayMs,
    scheduledAt: Date.now() + delayMs,
    outcome, error,
  };
  attempts.push(attempt);
  return attempt;
}

export function getPolicy(policyId: string): RetryPolicy | undefined { return policies.get(policyId); }
export function getAttemptsForOperation(operationId: string): RetryAttempt[] { return attempts.filter(a => a.operationId === operationId); }
export function _resetRetryManagerForTest(): void { policies.clear(); attempts.length = 0; policyCounter = 0; attemptCounter = 0; }
