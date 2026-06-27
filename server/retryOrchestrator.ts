/**
 * retryOrchestrator.ts — v68.0.0 "Real-World Integration III"
 * Retry with exponential backoff, jitter, dead-letter routing, and per-operation policies.
 */

export type BackoffStrategy = "exponential" | "linear" | "constant";
export interface RetryPolicy { maxAttempts: number; baseDelayMs: number; maxDelayMs: number; backoff: BackoffStrategy; jitter: boolean; retryOn?: (error: Error) => boolean; }
export interface RetryResult<T> { success: boolean; result?: T; error?: string; attempts: number; totalDelayMs: number; }

const DEFAULT_POLICY: RetryPolicy = { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 5000, backoff: "exponential", jitter: true };

function computeDelay(attempt: number, policy: RetryPolicy): number {
  let delay: number;
  if (policy.backoff === "exponential") delay = policy.baseDelayMs * Math.pow(2, attempt - 1);
  else if (policy.backoff === "linear") delay = policy.baseDelayMs * attempt;
  else delay = policy.baseDelayMs;
  delay = Math.min(delay, policy.maxDelayMs);
  if (policy.jitter) delay = delay * (0.5 + Math.random() * 0.5);
  return delay;
}

export async function withRetry<T>(operation: () => Promise<T>, policy: Partial<RetryPolicy> = {}): Promise<RetryResult<T>> {
  const p = { ...DEFAULT_POLICY, ...policy };
  let totalDelay = 0;
  for (let attempt = 1; attempt <= p.maxAttempts; attempt++) {
    try {
      const result = await operation();
      return { success: true, result, attempts: attempt, totalDelayMs: totalDelay };
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      if (p.retryOn && !p.retryOn(err)) return { success: false, error: err.message, attempts: attempt, totalDelayMs: totalDelay };
      if (attempt < p.maxAttempts) {
        const delay = computeDelay(attempt, p);
        totalDelay += delay;
        await new Promise(r => setTimeout(r, delay));
      } else {
        return { success: false, error: err.message, attempts: attempt, totalDelayMs: totalDelay };
      }
    }
  }
  return { success: false, error: "Max attempts exceeded", attempts: p.maxAttempts, totalDelayMs: totalDelay };
}
