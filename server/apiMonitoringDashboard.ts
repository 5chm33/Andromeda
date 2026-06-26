/**
 * apiMonitoringDashboard.ts — v54.0.0
 *
 * Aggregates real-time API metrics into a dashboard view:
 * uptime, error rates, latency trends, and alert thresholds.
 */

export interface ApiMetricSnapshot {
  apiId: string;
  timestamp: number;
  requestCount: number;
  errorCount: number;
  avgLatencyMs: number;
  p99LatencyMs: number;
  uptimePercent: number;
}

export interface AlertRule {
  ruleId: string;
  apiId: string;
  metric: "errorRate" | "latency" | "uptime";
  threshold: number;
  operator: "gt" | "lt";
  severity: "warning" | "critical";
}

export interface ActiveAlert {
  alertId: string;
  ruleId: string;
  apiId: string;
  message: string;
  severity: "warning" | "critical";
  triggeredAt: number;
  resolvedAt?: number;
}

export interface DashboardView {
  generatedAt: number;
  apis: Array<{
    apiId: string;
    latestSnapshot?: ApiMetricSnapshot;
    errorRate: number;
    activeAlerts: ActiveAlert[];
    status: "healthy" | "degraded" | "down";
  }>;
  totalActiveAlerts: number;
}

const snapshots = new Map<string, ApiMetricSnapshot[]>();
const alertRules = new Map<string, AlertRule>();
const activeAlerts = new Map<string, ActiveAlert>();
let alertCounter = 0;
let ruleCounter = 0;

export function recordMetricSnapshot(snapshot: Omit<ApiMetricSnapshot, "timestamp">): ApiMetricSnapshot {
  const full: ApiMetricSnapshot = { ...snapshot, timestamp: Date.now() };
  if (!snapshots.has(snapshot.apiId)) snapshots.set(snapshot.apiId, []);
  const apiSnaps = snapshots.get(snapshot.apiId)!;
  apiSnaps.push(full);
  if (apiSnaps.length > 100) apiSnaps.shift(); // keep last 100
  evaluateAlerts(full);
  return full;
}

export function addAlertRule(rule: Omit<AlertRule, "ruleId">): AlertRule {
  const full: AlertRule = { ruleId: `rule-${++ruleCounter}`, ...rule };
  alertRules.set(full.ruleId, full);
  return full;
}

export function getDashboardView(): DashboardView {
  const apiIds = Array.from(snapshots.keys());
  const apis = apiIds.map(apiId => {
    const apiSnaps = snapshots.get(apiId) ?? [];
    const latest = apiSnaps[apiSnaps.length - 1];
    const errorRate = latest ? latest.errorCount / Math.max(latest.requestCount, 1) : 0;
    const apiAlerts = Array.from(activeAlerts.values()).filter(a => a.apiId === apiId && !a.resolvedAt);
    const hasCritical = apiAlerts.some(a => a.severity === "critical");
    const hasWarning = apiAlerts.some(a => a.severity === "warning");
    const status: "healthy" | "degraded" | "down" = hasCritical ? "down" : hasWarning ? "degraded" : "healthy";
    return { apiId, latestSnapshot: latest, errorRate, activeAlerts: apiAlerts, status };
  });

  return {
    generatedAt: Date.now(),
    apis,
    totalActiveAlerts: Array.from(activeAlerts.values()).filter(a => !a.resolvedAt).length,
  };
}

export function resolveAlert(alertId: string): boolean {
  const alert = activeAlerts.get(alertId);
  if (!alert) return false;
  alert.resolvedAt = Date.now();
  return true;
}

function evaluateAlerts(snapshot: ApiMetricSnapshot): void {
  for (const rule of alertRules.values()) {
    if (rule.apiId !== snapshot.apiId) continue;
    let value: number;
    if (rule.metric === "errorRate") value = snapshot.errorCount / Math.max(snapshot.requestCount, 1);
    else if (rule.metric === "latency") value = snapshot.avgLatencyMs;
    else value = snapshot.uptimePercent;

    const triggered = rule.operator === "gt" ? value > rule.threshold : value < rule.threshold;
    if (triggered) {
      const alertId = `alert-${++alertCounter}`;
      activeAlerts.set(alertId, {
        alertId,
        ruleId: rule.ruleId,
        apiId: snapshot.apiId,
        message: `${rule.metric} ${rule.operator} ${rule.threshold} (actual: ${value.toFixed(3)})`,
        severity: rule.severity,
        triggeredAt: Date.now(),
      });
    }
  }
}

export function _resetMonitoringDashboardForTest(): void {
  snapshots.clear();
  alertRules.clear();
  activeAlerts.clear();
  alertCounter = 0;
  ruleCounter = 0;
}
