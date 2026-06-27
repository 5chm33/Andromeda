/**
 * circuitBreakerV68.ts — v68.0.0 "Real-World Integration III"
 * Circuit breaker with closed/open/half-open states, failure threshold, and auto-recovery.
 */

export type CircuitState = "closed" | "open" | "half-open";
export interface CircuitBreakerConfig { name: string; failureThreshold: number; successThreshold: number; timeoutMs: number; halfOpenMaxCalls: number; }
export interface CircuitBreakerStats { state: CircuitState; failures: number; successes: number; lastFailureAt?: number; totalCalls: number; }

const breakers = new Map<string, { config: CircuitBreakerConfig; stats: CircuitBreakerStats; halfOpenCalls: number }>();

export function createCircuitBreaker(config: CircuitBreakerConfig): void {
  breakers.set(config.name, { config, stats: { state: "closed", failures: 0, successes: 0, totalCalls: 0 }, halfOpenCalls: 0 });
}

export async function callWithCircuitBreaker<T>(name: string, operation: () => Promise<T>): Promise<T> {
  const cb = breakers.get(name);
  if (!cb) throw new Error(`[CircuitBreaker] Not found: ${name}`);
  const { config, stats } = cb;
  if (stats.state === "open") {
    const elapsed = Date.now() - (stats.lastFailureAt ?? 0);
    if (elapsed >= config.timeoutMs) { stats.state = "half-open"; cb.halfOpenCalls = 0; }
    else throw new Error(`[CircuitBreaker] Circuit open: ${name}`);
  }
  if (stats.state === "half-open" && cb.halfOpenCalls >= config.halfOpenMaxCalls) throw new Error(`[CircuitBreaker] Half-open limit reached: ${name}`);
  if (stats.state === "half-open") cb.halfOpenCalls++;
  stats.totalCalls++;
  try {
    const result = await operation();
    stats.successes++;
    stats.failures = 0;
    if (stats.state === "half-open" && stats.successes >= config.successThreshold) { stats.state = "closed"; cb.halfOpenCalls = 0; }
    return result;
  } catch (e: unknown) {
    stats.failures++;
    stats.lastFailureAt = Date.now();
    if (stats.failures >= config.failureThreshold) stats.state = "open";
    throw e;
  }
}

export function getCircuitStats(name: string): CircuitBreakerStats | null { return breakers.get(name)?.stats ?? null; }
export function _resetCircuitBreakersForTest(): void { breakers.clear(); }
