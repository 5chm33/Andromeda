/**
 * logAnalyzer.ts — v70.0.0 "Observability Stack"
 * Structured log ingestion, parsing, pattern detection, and anomaly flagging.
 */
export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";
export interface LogEntry { logId: string; level: LogLevel; message: string; service: string; timestamp: number; fields: Record<string, unknown>; }
export interface LogPattern { pattern: string; count: number; lastSeen: number; level: LogLevel; }

const logs: LogEntry[] = [];
const patterns = new Map<string, LogPattern>();
let logCounter = 0;

export function ingestLog(level: LogLevel, message: string, service: string, fields: Record<string, unknown> = {}): LogEntry {
  const entry: LogEntry = { logId: `log-${++logCounter}`, level, message, service, timestamp: Date.now(), fields };
  logs.push(entry);
  // Pattern detection: normalize numbers and UUIDs
  const normalized = message.replace(/\d+/g, "N").replace(/[0-9a-f-]{36}/gi, "UUID");
  if (!patterns.has(normalized)) patterns.set(normalized, { pattern: normalized, count: 0, lastSeen: 0, level });
  const p = patterns.get(normalized)!;
  p.count++;
  p.lastSeen = Date.now();
  return entry;
}

export function queryLogs(filter: { level?: LogLevel; service?: string; since?: number; search?: string }): LogEntry[] {
  return logs.filter(l => {
    if (filter.level && l.level !== filter.level) return false;
    if (filter.service && l.service !== filter.service) return false;
    if (filter.since && l.timestamp < filter.since) return false;
    if (filter.search && !l.message.toLowerCase().includes(filter.search.toLowerCase())) return false;
    return true;
  });
}

export function getTopPatterns(n = 10): LogPattern[] {
  return [...patterns.values()].sort((a, b) => b.count - a.count).slice(0, n);
}

export function getErrorRate(windowMs = 60000): number {
  const since = Date.now() - windowMs;
  const recent = logs.filter(l => l.timestamp >= since);
  if (recent.length === 0) return 0;
  return recent.filter(l => l.level === "error" || l.level === "fatal").length / recent.length;
}

export function _resetLogAnalyzerForTest(): void { logs.length = 0; patterns.clear(); logCounter = 0; }
