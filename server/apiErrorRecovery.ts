/**
 * apiErrorRecovery.ts — v52.0.0
 *
 * Implements intelligent error recovery strategies for API failures:
 * exponential backoff, circuit breaking, fallback responses, and retry budgets.
 */

export type RecoveryStrategy = "retry" | "fallback" | "circuit-break" | "ignore";

export interface ErrorRecoveryConfig {
  apiId: string;
  maxRetries: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
  retryOn: number[];       // HTTP status codes to retry
  circuitBreakerThreshold: number;  // failures before opening circuit
  fallbackValue?: unknown;
}

export interface RecoveryDecision {
  strategy: RecoveryStrategy;
  retryAfterMs: number;
  attempt: number;
  reason: string;
}

interface CircuitState {
  failures: number;
  lastFailure: number;
  open: boolean;
  openedAt?: number;
}

const configs = new Map<string, ErrorRecoveryConfig>();
const circuits = new Map<string, CircuitState>();
const retryCounts = new Map<string, number>();

const CIRCUIT_RESET_MS = 30_000; // 30 seconds

export function configureRecovery(config: ErrorRecoveryConfig): void {
  configs.set(config.apiId, config);
  if (!circuits.has(config.apiId)) {
    circuits.set(config.apiId, { failures: 0, lastFailure: 0, open: false });
  }
}

export function decideRecovery(apiId: string, statusCode: number, attempt: number): RecoveryDecision {
  const config = configs.get(apiId);
  if (!config) {
    return { strategy: "ignore", retryAfterMs: 0, attempt, reason: "No recovery config" };
  }

  const circuit = circuits.get(apiId)!;

  // Check if circuit is open
  if (circuit.open) {
    const elapsed = Date.now() - (circuit.openedAt ?? 0);
    if (elapsed > CIRCUIT_RESET_MS) {
      circuit.open = false;
      circuit.failures = 0;
    } else {
      return { strategy: "circuit-break", retryAfterMs: CIRCUIT_RESET_MS - elapsed, attempt, reason: "Circuit breaker open" };
    }
  }

  // Record failure
  circuit.failures++;
  circuit.lastFailure = Date.now();

  if (circuit.failures >= config.circuitBreakerThreshold) {
    circuit.open = true;
    circuit.openedAt = Date.now();
    return { strategy: "circuit-break", retryAfterMs: CIRCUIT_RESET_MS, attempt, reason: `Circuit opened after ${circuit.failures} failures` };
  }

  // Check if retryable
  if (config.retryOn.includes(statusCode) && attempt < config.maxRetries) {
    const backoff = Math.min(config.baseBackoffMs * Math.pow(2, attempt), config.maxBackoffMs);
    return { strategy: "retry", retryAfterMs: backoff, attempt: attempt + 1, reason: `Retryable status ${statusCode}` };
  }

  // Use fallback if available
  if (config.fallbackValue !== undefined) {
    return { strategy: "fallback", retryAfterMs: 0, attempt, reason: "Max retries exceeded, using fallback" };
  }

  return { strategy: "ignore", retryAfterMs: 0, attempt, reason: "Non-retryable error" };
}

export function recordSuccess(apiId: string): void {
  const circuit = circuits.get(apiId);
  if (circuit) {
    circuit.failures = Math.max(0, circuit.failures - 1);
    if (circuit.open) circuit.open = false;
  }
  retryCounts.delete(apiId);
}

export function isCircuitOpen(apiId: string): boolean {
  const circuit = circuits.get(apiId);
  if (!circuit) return false;
  if (circuit.open && Date.now() - (circuit.openedAt ?? 0) > CIRCUIT_RESET_MS) {
    circuit.open = false;
    return false;
  }
  return circuit.open;
}

export function _resetErrorRecoveryForTest(): void {
  configs.clear();
  circuits.clear();
  retryCounts.clear();
}
