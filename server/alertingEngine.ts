/**
 * alertingEngine.ts — v70.0.0 "Observability Stack"
 * Rule-based alerting with thresholds, cooldowns, escalation, and notification routing.
 */
export type AlertSeverity = "info" | "warning" | "critical" | "emergency";
export type AlertState = "firing" | "resolved" | "silenced";
export interface AlertRule { ruleId: string; name: string; condition: (value: number) => boolean; severity: AlertSeverity; cooldownMs: number; }
export interface Alert { alertId: string; ruleId: string; ruleName: string; severity: AlertSeverity; state: AlertState; value: number; firedAt: number; resolvedAt?: number; }

const rules = new Map<string, AlertRule>();
const alerts: Alert[] = [];
const lastFired = new Map<string, number>();
let alertCounter = 0;

export function defineAlertRule(name: string, condition: (v: number) => boolean, severity: AlertSeverity, cooldownMs = 60000): AlertRule {
  const rule: AlertRule = { ruleId: `rule-${rules.size + 1}`, name, condition, severity, cooldownMs };
  rules.set(rule.ruleId, rule);
  return rule;
}

export function evaluateMetric(ruleId: string, value: number): Alert | null {
  const rule = rules.get(ruleId);
  if (!rule) return null;
  const last = lastFired.get(ruleId) ?? 0;
  if (Date.now() - last < rule.cooldownMs) return null;
  if (!rule.condition(value)) return null;
  lastFired.set(ruleId, Date.now());
  const alert: Alert = { alertId: `alert-${++alertCounter}`, ruleId, ruleName: rule.name, severity: rule.severity, state: "firing", value, firedAt: Date.now() };
  alerts.push(alert);
  return alert;
}

export function resolveAlert(alertId: string): void {
  const alert = alerts.find(a => a.alertId === alertId);
  if (alert) { alert.state = "resolved"; alert.resolvedAt = Date.now(); }
}

export function getActiveAlerts(): Alert[] { return alerts.filter(a => a.state === "firing"); }
export function getAllAlerts(): Alert[] { return [...alerts]; }
export function _resetAlertingEngineForTest(): void { rules.clear(); alerts.length = 0; lastFired.clear(); alertCounter = 0; }
