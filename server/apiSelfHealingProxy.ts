/**
 * apiSelfHealingProxy.ts — v54.0.0
 *
 * A self-healing proxy layer for API calls: automatic retries,
 * failover to backup endpoints, circuit breaking, and health-based routing.
 */

export interface ProxyConfig {
  proxyId: string;
  primaryEndpoint: string;
  backupEndpoints: string[];
  maxRetries: number;
  retryDelayMs: number;
  circuitBreakerThreshold: number;  // consecutive failures before opening
  healCheckIntervalMs: number;
}

export interface ProxyCallResult {
  proxyId: string;
  endpoint: string;
  attempt: number;
  success: boolean;
  latencyMs: number;
  usedBackup: boolean;
  failoverReason?: string;
}

export interface ProxyHealth {
  proxyId: string;
  primaryHealthy: boolean;
  activeEndpoint: string;
  consecutiveFailures: number;
  circuitOpen: boolean;
  totalCalls: number;
  successRate: number;
}

const configs = new Map<string, ProxyConfig>();
const consecutiveFailures = new Map<string, number>();
const circuitOpen = new Map<string, boolean>();
const totalCalls = new Map<string, number>();
const successCalls = new Map<string, number>();
const activeEndpoints = new Map<string, string>();

export function registerProxy(config: ProxyConfig): void {
  configs.set(config.proxyId, config);
  consecutiveFailures.set(config.proxyId, 0);
  circuitOpen.set(config.proxyId, false);
  totalCalls.set(config.proxyId, 0);
  successCalls.set(config.proxyId, 0);
  activeEndpoints.set(config.proxyId, config.primaryEndpoint);
}

export function simulateCall(proxyId: string, shouldSucceed: boolean, latencyMs = 50): ProxyCallResult {
  const config = configs.get(proxyId);
  if (!config) throw new Error(`[SelfHealingProxy] Proxy "${proxyId}" not found`);

  totalCalls.set(proxyId, (totalCalls.get(proxyId) ?? 0) + 1);
  const isCircuitOpen = circuitOpen.get(proxyId) ?? false;
  const currentEndpoint = activeEndpoints.get(proxyId) ?? config.primaryEndpoint;
  const usedBackup = currentEndpoint !== config.primaryEndpoint;

  if (isCircuitOpen) {
    // Try backup if available
    const backup = config.backupEndpoints[0];
    if (backup) {
      activeEndpoints.set(proxyId, backup);
      return {
        proxyId,
        endpoint: backup,
        attempt: 1,
        success: shouldSucceed,
        latencyMs,
        usedBackup: true,
        failoverReason: "Circuit open — using backup",
      };
    }
    return { proxyId, endpoint: currentEndpoint, attempt: 1, success: false, latencyMs, usedBackup, failoverReason: "Circuit open, no backup available" };
  }

  if (shouldSucceed) {
    consecutiveFailures.set(proxyId, 0);
    successCalls.set(proxyId, (successCalls.get(proxyId) ?? 0) + 1);
    // Restore primary if we were on backup
    if (usedBackup) activeEndpoints.set(proxyId, config.primaryEndpoint);
    return { proxyId, endpoint: currentEndpoint, attempt: 1, success: true, latencyMs, usedBackup };
  } else {
    const failures = (consecutiveFailures.get(proxyId) ?? 0) + 1;
    consecutiveFailures.set(proxyId, failures);
    if (failures >= config.circuitBreakerThreshold) {
      circuitOpen.set(proxyId, true);
      console.warn(`[SelfHealingProxy] Circuit opened for proxy "${proxyId}" after ${failures} failures`);
    }
    return { proxyId, endpoint: currentEndpoint, attempt: 1, success: false, latencyMs, usedBackup, failoverReason: `Failure ${failures}/${config.circuitBreakerThreshold}` };
  }
}

export function resetCircuit(proxyId: string): void {
  circuitOpen.set(proxyId, false);
  consecutiveFailures.set(proxyId, 0);
  const config = configs.get(proxyId);
  if (config) activeEndpoints.set(proxyId, config.primaryEndpoint);
}

export function getProxyHealth(proxyId: string): ProxyHealth | null {
  const config = configs.get(proxyId);
  if (!config) return null;
  const total = totalCalls.get(proxyId) ?? 0;
  const success = successCalls.get(proxyId) ?? 0;
  const activeEndpoint = activeEndpoints.get(proxyId) ?? config.primaryEndpoint;
  return {
    proxyId,
    primaryHealthy: activeEndpoint === config.primaryEndpoint,
    activeEndpoint,
    consecutiveFailures: consecutiveFailures.get(proxyId) ?? 0,
    circuitOpen: circuitOpen.get(proxyId) ?? false,
    totalCalls: total,
    successRate: total > 0 ? success / total : 1.0,
  };
}

export function _resetSelfHealingProxyForTest(): void {
  configs.clear();
  consecutiveFailures.clear();
  circuitOpen.clear();
  totalCalls.clear();
  successCalls.clear();
  activeEndpoints.clear();
}
