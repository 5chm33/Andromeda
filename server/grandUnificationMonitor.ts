/**
 * grandUnificationMonitor.ts — v55.0.0 "The Grand Unification"
 *
 * The apex monitoring module that integrates signals from all Andromeda
 * sub-systems into a single unified health and intelligence report.
 * This is the "consciousness" layer — the system watching itself.
 */

export interface SubsystemStatus {
  subsystemId: string;
  name: string;
  healthy: boolean;
  lastCheckAt: number;
  metrics: Record<string, number>;
  alerts: string[];
}

export interface UnifiedIntelligenceReport {
  reportId: string;
  version: string;
  generatedAt: number;
  overallHealthScore: number;    // 0.0–1.0
  intelligenceScore: number;     // 0.0–1.0 (composite capability score)
  autonomyScore: number;         // 0.0–1.0 (how self-directed the system is)
  subsystems: SubsystemStatus[];
  activeAlerts: string[];
  recommendations: string[];
  trajectory: "ascending" | "stable" | "declining";
  cyclesSinceLastImprovement: number;
}

export interface SystemEvent {
  eventId: string;
  subsystemId: string;
  eventType: "improvement" | "degradation" | "anomaly" | "milestone" | "alert";
  description: string;
  magnitude: number;   // 0.0–1.0
  timestamp: number;
}

const subsystems = new Map<string, SubsystemStatus>();
const events: SystemEvent[] = [];
const reports: UnifiedIntelligenceReport[] = [];
let reportCounter = 0;
let eventCounter = 0;
let cyclesSinceImprovement = 0;

export function registerSubsystem(id: string, name: string): SubsystemStatus {
  const status: SubsystemStatus = {
    subsystemId: id,
    name,
    healthy: true,
    lastCheckAt: Date.now(),
    metrics: {},
    alerts: [],
  };
  subsystems.set(id, status);
  return status;
}

export function updateSubsystemMetrics(subsystemId: string, metrics: Record<string, number>, alerts: string[] = []): boolean {
  const sub = subsystems.get(subsystemId);
  if (!sub) return false;
  sub.metrics = { ...sub.metrics, ...metrics };
  sub.alerts = alerts;
  sub.healthy = alerts.length === 0;
  sub.lastCheckAt = Date.now();
  return true;
}

export function recordSystemEvent(subsystemId: string, eventType: SystemEvent["eventType"], description: string, magnitude: number): SystemEvent {
  const event: SystemEvent = {
    eventId: `sevt-${++eventCounter}`,
    subsystemId,
    eventType,
    description,
    magnitude: Math.max(0, Math.min(1, magnitude)),
    timestamp: Date.now(),
  };
  events.push(event);

  if (eventType === "improvement") {
    cyclesSinceImprovement = 0;
  } else {
    cyclesSinceImprovement++;
  }

  return event;
}

export function generateUnifiedReport(version: string): UnifiedIntelligenceReport {
  const allSubs = Array.from(subsystems.values());
  const healthySubs = allSubs.filter(s => s.healthy).length;
  const overallHealthScore = allSubs.length > 0 ? healthySubs / allSubs.length : 1.0;

  const allAlerts = allSubs.flatMap(s => s.alerts.map(a => `[${s.name}] ${a}`));

  // Intelligence score: based on recent improvement events
  const recentEvents = events.filter(e => Date.now() - e.timestamp < 3600000);
  const improvements = recentEvents.filter(e => e.eventType === "improvement");
  const intelligenceScore = Math.min(1.0, 0.5 + improvements.length * 0.05);

  // Autonomy score: based on how many subsystems are self-managing
  const autonomyScore = Math.min(1.0, allSubs.length > 0 ? (allSubs.length / 50) : 0);

  // Trajectory
  const recentDegradations = recentEvents.filter(e => e.eventType === "degradation").length;
  const trajectory: UnifiedIntelligenceReport["trajectory"] =
    improvements.length > recentDegradations ? "ascending" :
    recentDegradations > improvements.length ? "declining" : "stable";

  // Recommendations
  const recommendations: string[] = [];
  if (overallHealthScore < 0.9) recommendations.push("Investigate unhealthy subsystems");
  if (cyclesSinceImprovement > 10) recommendations.push("No improvement in recent cycles — consider new learning strategies");
  if (allAlerts.length > 5) recommendations.push("High alert volume — review alert thresholds");
  if (autonomyScore < 0.5) recommendations.push("Expand autonomous subsystem coverage");

  const report: UnifiedIntelligenceReport = {
    reportId: `report-${++reportCounter}`,
    version,
    generatedAt: Date.now(),
    overallHealthScore,
    intelligenceScore,
    autonomyScore,
    subsystems: allSubs,
    activeAlerts: allAlerts,
    recommendations,
    trajectory,
    cyclesSinceLastImprovement: cyclesSinceImprovement,
  };
  reports.push(report);
  return report;
}

export function getReportHistory(): UnifiedIntelligenceReport[] {
  return [...reports];
}

export function getSystemEvents(subsystemId?: string, limit = 20): SystemEvent[] {
  const filtered = subsystemId ? events.filter(e => e.subsystemId === subsystemId) : events;
  return filtered.slice(-limit);
}

export function _resetGrandUnificationMonitorForTest(): void {
  subsystems.clear();
  events.length = 0;
  reports.length = 0;
  reportCounter = 0;
  eventCounter = 0;
  cyclesSinceImprovement = 0;
}
