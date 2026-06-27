import { createLogger } from "./logger.js";
const log = createLogger("ApiCircuitBreaker");
/**
 * apiCircuitBreaker.ts — v79.0.0 "API Gateway & Integration"
 * Implements the circuit breaker pattern for upstream API calls to prevent cascade failures.
 */
export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitBreakerConfig {
  circuitId: string;
  name: string;
  failureThreshold: number;
  successThreshold: number;
  timeoutMs: number;
}

export interface CircuitBreakerStatus {
  circuitId: string;
  name: string;
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureAt: number | null;
  lastStateChangeAt: number;
  totalRequests: number;
  totalFailures: number;
}

const circuits = new Map<string, CircuitBreakerStatus & { config: CircuitBreakerConfig }>();

export function registerCircuit(config: CircuitBreakerConfig): void {
  circuits.set(config.circuitId, {
    ...config,
    config,
    state: "closed",
    failureCount: 0,
    successCount: 0,
    lastFailureAt: null,
    lastStateChangeAt: Date.now(),
    totalRequests: 0,
    totalFailures: 0,
  });
  log.info(`[ApiCircuitBreaker] Registered circuit: ${config.name}`);
}

export function canExecute(circuitId: string, now = Date.now()): boolean {
  const circuit = circuits.get(circuitId);
  if (!circuit) return true;

  if (circuit.state === "open") {
    if (now - circuit.lastStateChangeAt >= circuit.config.timeoutMs) {
      circuit.state = "half_open";
      circuit.lastStateChangeAt = now;
      log.info(`[ApiCircuitBreaker] Circuit ${circuit.name} → half_open`);
      return true;
    }
    return false;
  }
  return true;
}

export function recordSuccess(circuitId: string): void {
  const circuit = circuits.get(circuitId);
  if (!circuit) return;
  circuit.totalRequests++;
  circuit.successCount++;

  if (circuit.state === "half_open") {
    if (circuit.successCount >= circuit.config.successThreshold) {
      circuit.state = "closed";
      circuit.failureCount = 0;
      circuit.successCount = 0;
      circuit.lastStateChangeAt = Date.now();
      log.info(`[ApiCircuitBreaker] Circuit ${circuit.name} → closed`);
    }
  } else {
    circuit.failureCount = 0;
  }
}

export function recordFailure(circuitId: string): void {
  const circuit = circuits.get(circuitId);
  if (!circuit) return;
  circuit.totalRequests++;
  circuit.totalFailures++;
  circuit.failureCount++;
  circuit.lastFailureAt = Date.now();

  if ((circuit.state === "closed" || circuit.state === "half_open") && circuit.failureCount >= circuit.config.failureThreshold) {
    circuit.state = "open";
    circuit.successCount = 0;
    circuit.lastStateChangeAt = Date.now();
    log.info(`[ApiCircuitBreaker] Circuit ${circuit.name} → open after ${circuit.failureCount} failures`);
  }
}

export function getCircuitStatus(circuitId: string): CircuitBreakerStatus | undefined {
  const c = circuits.get(circuitId);
  if (!c) return undefined;
  const { config, ...status } = c;
  return status;
}

export function getAllCircuits(): CircuitBreakerStatus[] {
  return [...circuits.values()].map(({ config, ...status }) => status);
}

export function _resetApiCircuitBreakerForTest(): void { circuits.clear(); }
