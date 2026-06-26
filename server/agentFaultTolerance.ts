/**
 * agentFaultTolerance.ts — v48.0.0
 *
 * Circuit breaker, retry logic, and failover management for sub-agent operations.
 */

export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreaker {
  agentId: string;
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureAt: number;
  openedAt?: number;
  threshold: number;      // failures before opening
  resetTimeoutMs: number; // ms before trying half-open
}

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  backoffMultiplier: number;
  maxDelayMs: number;
}

const breakers = new Map<string, CircuitBreaker>();

export function registerCircuitBreaker(agentId: string, threshold = 5, resetTimeoutMs = 30000): CircuitBreaker {
  const cb: CircuitBreaker = {
    agentId, state: "closed", failureCount: 0, successCount: 0,
    lastFailureAt: 0, threshold, resetTimeoutMs,
  };
  breakers.set(agentId, cb);
  return cb;
}

export function recordSuccess(agentId: string): void {
  const cb = breakers.get(agentId);
  if (!cb) return;
  cb.successCount++;
  if (cb.state === "half-open") {
    cb.state = "closed";
    cb.failureCount = 0;
    console.log(`[FaultTolerance] Circuit for ${agentId} closed after recovery.`);
  }
}

export function recordFailure(agentId: string): void {
  const cb = breakers.get(agentId);
  if (!cb) return;
  cb.failureCount++;
  cb.lastFailureAt = Date.now();
  if (cb.state === "closed" && cb.failureCount >= cb.threshold) {
    cb.state = "open";
    cb.openedAt = Date.now();
    console.log(`[FaultTolerance] Circuit for ${agentId} opened after ${cb.failureCount} failures.`);
  } else if (cb.state === "half-open") {
    cb.state = "open";
    cb.openedAt = Date.now();
  }
}

export function canCall(agentId: string): boolean {
  const cb = breakers.get(agentId);
  if (!cb) return true; // no breaker = allow
  if (cb.state === "closed") return true;
  if (cb.state === "open") {
    const elapsed = Date.now() - (cb.openedAt ?? 0);
    if (elapsed >= cb.resetTimeoutMs) {
      cb.state = "half-open";
      return true;
    }
    return false;
  }
  return true; // half-open: allow one probe
}

export function getCircuitState(agentId: string): CircuitState | null {
  return breakers.get(agentId)?.state ?? null;
}

export function calculateRetryDelay(attempt: number, policy: RetryPolicy): number {
  const delay = policy.baseDelayMs * Math.pow(policy.backoffMultiplier, attempt - 1);
  return Math.min(delay, policy.maxDelayMs);
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy,
  agentId?: string
): Promise<T> {
  let lastError: Error = new Error("Unknown error");
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    if (agentId && !canCall(agentId)) throw new Error(`Circuit open for ${agentId}`);
    try {
      const result = await fn();
      if (agentId) recordSuccess(agentId);
      return result;
    } catch (e) {
      lastError = e as Error;
      if (agentId) recordFailure(agentId);
      if (attempt < policy.maxAttempts) {
        const delay = calculateRetryDelay(attempt, policy);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

export function _resetFaultToleranceForTest(): void {
  breakers.clear();
}
