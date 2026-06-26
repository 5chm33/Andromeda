/**
 * apiHealthMonitor.ts — v51.0.0
 *
 * Monitors the health of external API integrations by tracking
 * success rates, latency, error patterns, and availability.
 */

export interface ApiHealthConfig {
  apiId: string;
  name: string;
  healthCheckUrl?: string;
  slaLatencyMs?: number;   // SLA threshold in ms
  slaSuccessRate?: number; // SLA threshold 0.0–1.0
}

export interface ApiCallRecord {
  apiId: string;
  success: boolean;
  latencyMs: number;
  statusCode?: number;
  errorType?: string;
  timestamp: number;
}

export interface ApiHealthReport {
  apiId: string;
  name: string;
  status: "healthy" | "degraded" | "down";
  successRate: number;
  avgLatencyMs: number;
  p99LatencyMs: number;
  totalCalls: number;
  slaBreaches: number;
  lastChecked: number;
}

const configs = new Map<string, ApiHealthConfig>();
const callHistory = new Map<string, ApiCallRecord[]>();

export function registerApi(config: ApiHealthConfig): void {
  configs.set(config.apiId, config);
  if (!callHistory.has(config.apiId)) callHistory.set(config.apiId, []);
}

export function recordCall(record: ApiCallRecord): void {
  if (!callHistory.has(record.apiId)) callHistory.set(record.apiId, []);
  const history = callHistory.get(record.apiId)!;
  history.push(record);
  // Keep last 1000 records
  if (history.length > 1000) history.splice(0, history.length - 1000);
}

export function getHealthReport(apiId: string): ApiHealthReport | null {
  const config = configs.get(apiId);
  if (!config) return null;

  const history = callHistory.get(apiId) ?? [];
  const recent = history.slice(-100); // last 100 calls

  if (recent.length === 0) {
    return {
      apiId,
      name: config.name,
      status: "healthy",
      successRate: 1.0,
      avgLatencyMs: 0,
      p99LatencyMs: 0,
      totalCalls: 0,
      slaBreaches: 0,
      lastChecked: Date.now(),
    };
  }

  const successCount = recent.filter(r => r.success).length;
  const successRate = successCount / recent.length;
  const latencies = recent.map(r => r.latencyMs).sort((a, b) => a - b);
  const avgLatencyMs = latencies.reduce((s, l) => s + l, 0) / latencies.length;
  const p99LatencyMs = latencies[Math.floor(latencies.length * 0.99)] ?? latencies[latencies.length - 1];

  const slaLatency = config.slaLatencyMs ?? 2000;
  const slaSuccess = config.slaSuccessRate ?? 0.99;
  const slaBreaches = recent.filter(r => !r.success || r.latencyMs > slaLatency).length;

  let status: ApiHealthReport["status"] = "healthy";
  if (successRate < 0.5 || avgLatencyMs > slaLatency * 3) status = "down";
  else if (successRate < slaSuccess || avgLatencyMs > slaLatency) status = "degraded";

  return {
    apiId,
    name: config.name,
    status,
    successRate,
    avgLatencyMs,
    p99LatencyMs,
    totalCalls: history.length,
    slaBreaches,
    lastChecked: Date.now(),
  };
}

export function getAllHealthReports(): ApiHealthReport[] {
  return Array.from(configs.keys()).map(id => getHealthReport(id)!).filter(Boolean);
}

export function _resetApiHealthMonitorForTest(): void {
  configs.clear();
  callHistory.clear();
}
