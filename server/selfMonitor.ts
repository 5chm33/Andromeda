/**
 * selfMonitor.ts — Autonomous Self-Monitoring System
 *
 * Runs in the background, tracking error rates, response quality metrics,
 * and performance trends. When degradation is detected, it auto-triggers
 * self-improvement proposals via selfImprove.ts.
 *
 * Integrations:
 *   - selfImprove.ts: Auto-triggers analyzeAndPropose when thresholds are exceeded
 *   - memory.ts: Stores monitoring insights as persistent memories
 *   - goalManager.ts: Can create improvement goals when systemic issues are found
 */

import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ─── Types ────────────────────────────────────────────────────────────────────

export type MetricType =
  | "error_rate"          // Percentage of requests that error
  | "response_latency"    // Average response time in ms
  | "truncation_rate"     // Percentage of responses that get truncated
  | "tool_failure_rate"   // Percentage of tool calls that fail
  | "user_satisfaction"   // Derived from follow-up patterns
  | "memory_usage"        // Memory store size
  | "self_modify_success" // Self-modification success rate (0 = fail, 1 = success)
  | "self_modify_rollback"// Self-modification rollback rate
  | "proposal_quality"    // Self-improvement proposal acceptance rate
  | "custom";

export type MetricSample = {
  id: string;
  type: MetricType;
  value: number;
  timestamp: number;
  context?: string;       // Optional context about what caused this sample
};

export type MonitorAlert = {
  id: string;
  type: MetricType;
  severity: "info" | "warning" | "critical";
  message: string;
  currentValue: number;
  threshold: number;
  trend: "rising" | "falling" | "stable";
  triggered: boolean;     // Whether an auto-improvement was triggered
  createdAt: number;
  resolvedAt?: number;
};

export type MonitorConfig = {
  enabled: boolean;
  checkIntervalMs: number;         // How often to check metrics (default: 5 min)
  windowSizeMs: number;            // Rolling window for metric calculation (default: 1 hour)
  minSamplesForAlert: number;      // Minimum samples before alerting (default: 10)
  autoTriggerImprovement: boolean; // Whether to auto-trigger self-improvement
  thresholds: {
    error_rate: number;            // Alert when error rate exceeds this (0-1, default: 0.15)
    response_latency: number;      // Alert when avg latency exceeds this (ms, default: 30000)
    truncation_rate: number;       // Alert when truncation rate exceeds this (0-1, default: 0.25)
    tool_failure_rate: number;     // Alert when tool failure rate exceeds this (0-1, default: 0.20)
    self_modify_rollback: number;  // Alert when rollback rate exceeds this (0-1, default: 0.20)
  };
  cooldownMs: number;              // Min time between auto-improvement triggers (default: 30 min)
};

export type HealthReport = {
  status: "healthy" | "degraded" | "critical";
  metrics: Record<MetricType, { current: number; trend: "rising" | "falling" | "stable"; samples: number }>;
  activeAlerts: MonitorAlert[];
  lastCheck: number;
  uptime: number;
  totalSamples: number;
  improvementsTriggered: number;
};

// ─── Storage ──────────────────────────────────────────────────────────────────

const samples: MetricSample[] = [];
const alerts: MonitorAlert[] = [];
const MAX_SAMPLES = 10000;
const MAX_ALERTS = 500;
let improvementsTriggered = 0;
let lastImprovementTrigger = 0;
let monitorStartTime = Date.now();
let lastCheckTime = 0;
let monitorInterval: ReturnType<typeof setInterval> | null = null;
let persistInterval: ReturnType<typeof setInterval> | null = null;

// v5.32: Metrics persistence
const PERSIST_INTERVAL_MS = 5 * 60 * 1000; // Persist every 5 minutes

function getMetricsPath(): string {
  const serverDir = path.dirname(fileURLToPath(import.meta.url));
  const workspaceDir = path.resolve(serverDir, "..", "workspace");
  if (!fs.existsSync(workspaceDir)) fs.mkdirSync(workspaceDir, { recursive: true });
  return path.join(workspaceDir, ".andromeda_monitor_metrics.json");
}

function persistMetrics(): void {
  try {
    const data = {
      samples: samples.slice(-1000), // Persist last 1000 samples
      alerts: alerts.slice(-100),
      improvementsTriggered,
      lastImprovementTrigger,
      monitorStartTime,
      persistedAt: Date.now(),
    };
    const metricsPath = getMetricsPath();
    const tmpPath = metricsPath + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
    fs.renameSync(tmpPath, metricsPath); // Atomic write
  } catch (err) {
    console.warn(`[SelfMonitor] Failed to persist metrics: ${(err as Error).message}`);
  }
}

function loadPersistedMetrics(): void {
  try {
    const metricsPath = getMetricsPath();
    if (!fs.existsSync(metricsPath)) return;
    const data = JSON.parse(fs.readFileSync(metricsPath, "utf-8"));
    if (data.samples && Array.isArray(data.samples)) {
      // Only load samples from the last 24 hours
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      const recentSamples = data.samples.filter((s: MetricSample) => s.timestamp > cutoff);
      samples.push(...recentSamples);
      console.log(`[SelfMonitor] Loaded ${recentSamples.length} persisted metrics (${data.samples.length - recentSamples.length} expired)`);
    }
    if (data.alerts && Array.isArray(data.alerts)) {
      alerts.push(...data.alerts.slice(-50));
    }
    if (typeof data.improvementsTriggered === "number") {
      improvementsTriggered = data.improvementsTriggered;
    }
  } catch (err) {
    console.warn(`[SelfMonitor] Failed to load persisted metrics: ${(err as Error).message}`);
  }
}

const defaultConfig: MonitorConfig = {
  enabled: true,
  checkIntervalMs: 5 * 60 * 1000,     // 5 minutes
  windowSizeMs: 60 * 60 * 1000,        // 1 hour
  minSamplesForAlert: 10,
  autoTriggerImprovement: true,
  thresholds: {
    error_rate: 0.15,
    response_latency: 30000,
    truncation_rate: 0.25,
    tool_failure_rate: 0.20,
    self_modify_rollback: 0.20,
  },
  cooldownMs: 30 * 60 * 1000,          // 30 minutes
};

let config: MonitorConfig = { ...defaultConfig };

// ─── Metric Recording ─────────────────────────────────────────────────────────

/**
 * Record a metric sample. Call this from anywhere in the codebase.
 */
export function recordMetric(type: MetricType, value: number, context?: string): MetricSample {
  const sample: MetricSample = {
    id: randomUUID(),
    type,
    value,
    timestamp: Date.now(),
    context,
  };
  samples.push(sample);
  if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
  return sample;
}

/**
 * Record a request outcome (convenience wrapper).
 */
export function recordRequestOutcome(opts: {
  success: boolean;
  latencyMs: number;
  truncated?: boolean;
  toolFailures?: number;
  totalToolCalls?: number;
  context?: string;
}): void {
  recordMetric("error_rate", opts.success ? 0 : 1, opts.context);
  recordMetric("response_latency", opts.latencyMs, opts.context);
  if (opts.truncated !== undefined) {
    recordMetric("truncation_rate", opts.truncated ? 1 : 0, opts.context);
  }
  if (opts.toolFailures !== undefined && opts.totalToolCalls !== undefined && opts.totalToolCalls > 0) {
    recordMetric("tool_failure_rate", opts.toolFailures / opts.totalToolCalls, opts.context);
  }
}

// ─── Metric Calculation ───────────────────────────────────────────────────────

function getSamplesInWindow(type: MetricType, windowMs?: number): MetricSample[] {
  const cutoff = Date.now() - (windowMs ?? config.windowSizeMs);
  return samples.filter(s => s.type === type && s.timestamp >= cutoff);
}

function calculateMetric(type: MetricType): { current: number; trend: "rising" | "falling" | "stable"; samples: number } {
  const windowSamples = getSamplesInWindow(type);
  if (windowSamples.length === 0) return { current: 0, trend: "stable", samples: 0 };

  const current = windowSamples.reduce((sum, s) => sum + s.value, 0) / windowSamples.length;

  // Calculate trend by comparing first half vs second half of window
  const mid = Math.floor(windowSamples.length / 2);
  if (mid < 2) return { current, trend: "stable", samples: windowSamples.length };

  const firstHalf = windowSamples.slice(0, mid);
  const secondHalf = windowSamples.slice(mid);
  const firstAvg = firstHalf.reduce((sum, s) => sum + s.value, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((sum, s) => sum + s.value, 0) / secondHalf.length;

  const delta = secondAvg - firstAvg;
  const threshold = Math.max(Math.abs(firstAvg) * 0.1, 0.01); // 10% change = trend

  let trend: "rising" | "falling" | "stable" = "stable";
  if (delta > threshold) trend = "rising";
  else if (delta < -threshold) trend = "falling";

  return { current, trend, samples: windowSamples.length };
}

// ─── Alert System ─────────────────────────────────────────────────────────────

function checkThreshold(type: MetricType, metric: { current: number; trend: string; samples: number }): MonitorAlert | null {
  if (metric.samples < config.minSamplesForAlert) return null;

  const thresholdKey = type as keyof typeof config.thresholds;
  const threshold = config.thresholds[thresholdKey];
  if (threshold === undefined) return null;

  if (metric.current <= threshold) {
    // Resolve any active alerts for this type
    for (const alert of alerts) {
      if (alert.type === type && !alert.resolvedAt) {
        alert.resolvedAt = Date.now();
      }
    }
    return null;
  }

  // Check if there's already an active (unresolved) alert for this type
  const existingActive = alerts.find(a => a.type === type && !a.resolvedAt);
  if (existingActive) return null; // Don't duplicate

  const severity = metric.current > threshold * 2 ? "critical"
    : metric.current > threshold * 1.5 ? "warning"
    : "info";

  const alert: MonitorAlert = {
    id: randomUUID(),
    type,
    severity,
    message: `${type} is at ${(metric.current * (type === "response_latency" ? 1 : 100)).toFixed(1)}${type === "response_latency" ? "ms" : "%"}, exceeding threshold of ${(threshold * (type === "response_latency" ? 1 : 100)).toFixed(1)}${type === "response_latency" ? "ms" : "%"}. Trend: ${metric.trend}.`,
    currentValue: metric.current,
    threshold,
    trend: metric.trend as "rising" | "falling" | "stable",
    triggered: false,
    createdAt: Date.now(),
  };

  alerts.push(alert);
  if (alerts.length > MAX_ALERTS) alerts.splice(0, alerts.length - MAX_ALERTS);

  return alert;
}

// ─── Auto-Improvement Trigger ─────────────────────────────────────────────────

async function maybeAutoTrigger(alert: MonitorAlert): Promise<boolean> {
  if (!config.autoTriggerImprovement) return false;
  if (alert.severity === "info") return false;

  const now = Date.now();
  if (now - lastImprovementTrigger < config.cooldownMs) return false;

  // Mark the alert as triggered
  alert.triggered = true;
  lastImprovementTrigger = now;
  improvementsTriggered++;

  // v5.23: Actually trigger the self-improvement pipeline
  // v5.50: Capture outcomes and log to memory for closed-loop feedback
  try {
    const { autoApplyHighConfidence } = await import("./selfImprove.js");
    const applyResults = await autoApplyHighConfidence();

    // v5.50: Record the monitoring trigger and its outcome in persistent memory
    try {
      const { storeMemory } = await import("./memory.js");
      const applied = applyResults.filter(r => r.applied);
      const failed = applyResults.filter(r => !r.applied);
      const memContent = [
        `[Monitor->AutoFix] Triggered by: ${alert.type} (${alert.severity})`,
        `Alert: ${alert.message}`,
        `Proposals applied: ${applied.length} | Failed: ${failed.length}`,
        applied.length > 0 ? `Applied: ${applied.map(r => r.title).join("; ")}` : "",
        failed.length > 0 ? `Failed: ${failed.map(r => r.message).join("; ")}` : "",
        `TriggeredAt: ${new Date().toISOString()}`,
      ].filter(Boolean).join("\n");
      storeMemory(memContent, "project", ["monitor", "auto-fix", alert.type]);
    } catch { /* non-fatal */ }

    console.log(`[Monitor->Improve] Auto-trigger complete: ${applyResults.filter(r => r.applied).length} applied, ${applyResults.filter(r => !r.applied).length} skipped`);
  } catch (err) {
    // Non-fatal — log and continue monitoring
    console.error("[Monitor->Improve] Auto-trigger failed:", err instanceof Error ? err.message : String(err));
  }
  return true;
}

// ─── Health Check Loop ────────────────────────────────────────────────────────

async function runHealthCheck(): Promise<void> {
  if (!config.enabled) return;
  lastCheckTime = Date.now();

  const metricTypes: MetricType[] = ["error_rate", "response_latency", "truncation_rate", "tool_failure_rate", "self_modify_success", "self_modify_rollback", "proposal_quality"];

  for (const type of metricTypes) {
    const metric = calculateMetric(type);
    const alert = checkThreshold(type, metric);
    if (alert) {
      await maybeAutoTrigger(alert);
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function getMonitorConfig(): MonitorConfig {
  return { ...config };
}

export function setMonitorConfig(updates: Partial<MonitorConfig>): MonitorConfig {
  config = { ...config, ...updates };
  if (updates.thresholds) {
    config.thresholds = { ...defaultConfig.thresholds, ...updates.thresholds };
  }

  // Restart interval if changed
  if (updates.checkIntervalMs !== undefined || updates.enabled !== undefined) {
    stopMonitor();
    if (config.enabled) startMonitor();
  }

  return config;
}

export function getHealthReport(): HealthReport {
  const metricTypes: MetricType[] = ["error_rate", "response_latency", "truncation_rate", "tool_failure_rate", "memory_usage", "user_satisfaction", "self_modify_success", "self_modify_rollback", "proposal_quality"];
  const metrics: Record<string, { current: number; trend: "rising" | "falling" | "stable"; samples: number }> = {};

  for (const type of metricTypes) {
    metrics[type] = calculateMetric(type);
  }

  const activeAlerts = alerts.filter(a => !a.resolvedAt);
  const hasCritical = activeAlerts.some(a => a.severity === "critical");
  const hasWarning = activeAlerts.some(a => a.severity === "warning");

  return {
    status: hasCritical ? "critical" : hasWarning ? "degraded" : "healthy",
    metrics: metrics as any,
    activeAlerts,
    lastCheck: lastCheckTime,
    uptime: Date.now() - monitorStartTime,
    totalSamples: samples.length,
    improvementsTriggered,
  };
}

export function getAlerts(includeResolved: boolean = false): MonitorAlert[] {
  if (includeResolved) return [...alerts];
  return alerts.filter(a => !a.resolvedAt);
}

export function resolveAlert(alertId: string): boolean {
  const alert = alerts.find(a => a.id === alertId);
  if (!alert || alert.resolvedAt) return false;
  alert.resolvedAt = Date.now();
  return true;
}

export function getMetricHistory(type: MetricType, limit: number = 100): MetricSample[] {
  return samples.filter(s => s.type === type).slice(-limit);
}

/**
 * Get a summary for injection into the system prompt.
 */
export function getMonitorSummary(): string {
  const report = getHealthReport();
  if (report.totalSamples === 0) return "";

  const lines = [`## System Health: ${report.status.toUpperCase()}`];

  if (report.activeAlerts.length > 0) {
    lines.push(`⚠ ${report.activeAlerts.length} active alert(s):`);
    for (const alert of report.activeAlerts) {
      lines.push(`  - [${alert.severity}] ${alert.message}`);
    }
  }

  const errMetric = report.metrics.error_rate;
  if (errMetric && errMetric.samples > 0) {
    lines.push(`Error rate: ${(errMetric.current * 100).toFixed(1)}% (${errMetric.trend})`);
  }

  return lines.join("\n");
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

export function startMonitor(): void {
  if (monitorInterval) return;

  // v5.32: Load persisted metrics from previous session
  loadPersistedMetrics();

  monitorStartTime = Date.now();
  monitorInterval = setInterval(() => {
    runHealthCheck().catch(() => {}); // Swallow errors in background check
  }, config.checkIntervalMs);

  // v5.32: Start periodic persistence
  persistInterval = setInterval(() => {
    persistMetrics();
  }, PERSIST_INTERVAL_MS);

  // Run an immediate check
  runHealthCheck().catch(() => {});
}

export function stopMonitor(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
  if (persistInterval) {
    clearInterval(persistInterval);
    persistInterval = null;
  }
  // v5.32: Persist metrics on shutdown
  persistMetrics();
}

export function isMonitorRunning(): boolean {
  return monitorInterval !== null;
}

/**
 * Reset all monitoring data. Useful for testing.
 */
export function resetMonitor(): void {
  samples.length = 0;
  alerts.length = 0;
  improvementsTriggered = 0;
  lastImprovementTrigger = 0;
  lastCheckTime = 0;
  monitorStartTime = Date.now();
}

// ═══════════════════════════════════════════════════════════════════════════
// v5.7 Enhancement: Adaptive Per-Provider Threshold Learning
// ═══════════════════════════════════════════════════════════════════════════

export type ProviderBaseline = {
  providerId: string;
  avgLatency: number;
  p95Latency: number;
  avgErrorRate: number;
  avgTokensPerSec: number;
  sampleCount: number;
  lastUpdated: number;
  thresholds: {
    maxLatency: number;
    maxErrorRate: number;
    minTokensPerSec: number;
  };
};

export type ProviderSample = {
  providerId: string;
  latency: number;
  success: boolean;
  tokensPerSec?: number;
  timestamp: number;
};

export type AdaptiveConfig = {
  enabled: boolean;
  learningWindow: number;
  minSamplesForBaseline: number;
  latencyMargin: number;
  errorRateMargin: number;
  throughputMargin: number;
  recalcInterval: number;
};

const providerSamples: ProviderSample[] = [];
const providerBaselines = new Map<string, ProviderBaseline>();
let adaptiveConfig: AdaptiveConfig = {
  enabled: true,
  learningWindow: 60 * 60 * 1000,
  minSamplesForBaseline: 10,
  latencyMargin: 1.5,
  errorRateMargin: 2.0,
  throughputMargin: 0.6,
  recalcInterval: 5 * 60 * 1000,
};
let lastBaselineCalc = 0;

export function recordProviderSample(sample: ProviderSample): void {
  providerSamples.push(sample);
  const cutoff = Date.now() - adaptiveConfig.learningWindow * 2;
  while (providerSamples.length > 0 && providerSamples[0].timestamp < cutoff) {
    providerSamples.shift();
  }
  if (providerSamples.length > 10_000) {
    providerSamples.splice(0, providerSamples.length - 10_000);
  }
}

export function recalculateBaselines(): Map<string, ProviderBaseline> {
  if (!adaptiveConfig.enabled) return providerBaselines;
  const now = Date.now();
  const windowStart = now - adaptiveConfig.learningWindow;
  const byProvider = new Map<string, ProviderSample[]>();
  for (const sample of providerSamples) {
    if (sample.timestamp < windowStart) continue;
    const existing = byProvider.get(sample.providerId) || [];
    existing.push(sample);
    byProvider.set(sample.providerId, existing);
  }
  for (const [providerId, pSamples] of Array.from(byProvider.entries())) {
    if (pSamples.length < adaptiveConfig.minSamplesForBaseline) continue;
    const latencies = pSamples.filter(s => s.success).map(s => s.latency).sort((a, b) => a - b);
    const errorCount = pSamples.filter(s => !s.success).length;
    const tokensPerSec = pSamples.filter(s => s.tokensPerSec != null).map(s => s.tokensPerSec!);
    if (latencies.length === 0) continue;
    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const p95Index = Math.floor(latencies.length * 0.95);
    const p95Latency = latencies[p95Index] || latencies[latencies.length - 1];
    const avgErrorRate = errorCount / pSamples.length;
    const avgTps = tokensPerSec.length > 0 ? tokensPerSec.reduce((a, b) => a + b, 0) / tokensPerSec.length : 0;
    providerBaselines.set(providerId, {
      providerId,
      avgLatency: Math.round(avgLatency),
      p95Latency: Math.round(p95Latency),
      avgErrorRate: Math.round(avgErrorRate * 1000) / 1000,
      avgTokensPerSec: Math.round(avgTps * 10) / 10,
      sampleCount: pSamples.length,
      lastUpdated: now,
      thresholds: {
        maxLatency: Math.round(p95Latency * adaptiveConfig.latencyMargin),
        maxErrorRate: Math.max(0.05, avgErrorRate * adaptiveConfig.errorRateMargin),
        minTokensPerSec: avgTps > 0 ? Math.round(avgTps * adaptiveConfig.throughputMargin * 10) / 10 : 0,
      },
    });
  }
  lastBaselineCalc = now;
  return providerBaselines;
}

export function getAdaptiveThresholds(providerId: string): ProviderBaseline["thresholds"] {
  if (Date.now() - lastBaselineCalc > adaptiveConfig.recalcInterval) recalculateBaselines();
  const baseline = providerBaselines.get(providerId);
  if (baseline) return baseline.thresholds;
  return { maxLatency: 30_000, maxErrorRate: 0.15, minTokensPerSec: 5 };
}

export function isProviderDegraded(providerId: string): { degraded: boolean; reasons: string[]; baseline?: ProviderBaseline } {
  const thresholds = getAdaptiveThresholds(providerId);
  const baseline = providerBaselines.get(providerId);
  const reasons: string[] = [];
  const recentCutoff = Date.now() - 2 * 60 * 1000;
  const recent = providerSamples.filter(s => s.providerId === providerId && s.timestamp > recentCutoff);
  if (recent.length < 3) return { degraded: false, reasons: [], baseline };
  const recentLatencies = recent.filter(s => s.success).map(s => s.latency);
  if (recentLatencies.length > 0) {
    const avgRecent = recentLatencies.reduce((a, b) => a + b, 0) / recentLatencies.length;
    if (avgRecent > thresholds.maxLatency) reasons.push(`Latency ${Math.round(avgRecent)}ms exceeds threshold ${thresholds.maxLatency}ms`);
  }
  const recentErrors = recent.filter(s => !s.success).length;
  const recentErrorRate = recentErrors / recent.length;
  if (recentErrorRate > thresholds.maxErrorRate) reasons.push(`Error rate ${(recentErrorRate * 100).toFixed(1)}% exceeds threshold ${(thresholds.maxErrorRate * 100).toFixed(1)}%`);
  const recentTps = recent.filter(s => s.tokensPerSec != null).map(s => s.tokensPerSec!);
  if (recentTps.length > 0 && thresholds.minTokensPerSec > 0) {
    const avgTps = recentTps.reduce((a, b) => a + b, 0) / recentTps.length;
    if (avgTps < thresholds.minTokensPerSec) reasons.push(`Throughput ${avgTps.toFixed(1)} tok/s below threshold ${thresholds.minTokensPerSec} tok/s`);
  }
  return { degraded: reasons.length > 0, reasons, baseline };
}

export function getAllBaselines(): ProviderBaseline[] {
  if (Date.now() - lastBaselineCalc > adaptiveConfig.recalcInterval) recalculateBaselines();
  return Array.from(providerBaselines.values());
}

export function getAdaptiveConfig(): AdaptiveConfig {
  return { ...adaptiveConfig };
}

export function setAdaptiveConfig(updates: Partial<AdaptiveConfig>): AdaptiveConfig {
  adaptiveConfig = { ...adaptiveConfig, ...updates };
  return { ...adaptiveConfig };
}

export function getAdaptiveStats(): { totalSamples: number; providersTracked: number; degradedProviders: string[]; oldestSample: number; newestSample: number } {
  const degraded: string[] = [];
  for (const [id] of Array.from(providerBaselines.entries())) {
    if (isProviderDegraded(id).degraded) degraded.push(id);
  }
  return {
    totalSamples: providerSamples.length,
    providersTracked: providerBaselines.size,
    degradedProviders: degraded,
    oldestSample: providerSamples.length > 0 ? providerSamples[0].timestamp : 0,
    newestSample: providerSamples.length > 0 ? providerSamples[providerSamples.length - 1].timestamp : 0,
  };
}

// v5.26: Alias for diagnostics endpoint
export const getMonitorStats = getHealthReport;
