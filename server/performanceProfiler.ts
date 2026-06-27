/**
 * performanceProfiler.ts — v92.0.0 "Recursive Self-Improvement & Introspection"
 * Runtime performance profiler that measures execution time, memory, and call frequency.
 */
export interface ProfileEntry {
  entryId: string;
  functionName: string;
  callCount: number;
  totalTimeMs: number;
  avgTimeMs: number;
  minTimeMs: number;
  maxTimeMs: number;
  memoryDeltaBytes: number;
  lastCalledAt: number;
}

export interface ProfileSession {
  sessionId: string;
  name: string;
  entries: Map<string, ProfileEntry>;
  startedAt: number;
  endedAt: number | null;
  totalCallsRecorded: number;
}

const sessions = new Map<string, ProfileSession>();
let sessionCounter = 0;
let entryCounter = 0;

export function startSession(name: string): ProfileSession {
  const session: ProfileSession = { sessionId: `ps-${++sessionCounter}`, name, entries: new Map(), startedAt: Date.now(), endedAt: null, totalCallsRecorded: 0 };
  sessions.set(session.sessionId, session);
  return session;
}

export function record(sessionId: string, functionName: string, durationMs: number, memoryDeltaBytes = 0): ProfileEntry | null {
  const session = sessions.get(sessionId);
  if (!session) return null;

  let entry = session.entries.get(functionName);
  if (!entry) {
    entry = { entryId: `pe-${++entryCounter}`, functionName, callCount: 0, totalTimeMs: 0, avgTimeMs: 0, minTimeMs: Infinity, maxTimeMs: -Infinity, memoryDeltaBytes: 0, lastCalledAt: 0 };
    session.entries.set(functionName, entry);
  }

  entry.callCount++;
  entry.totalTimeMs += durationMs;
  entry.avgTimeMs = entry.totalTimeMs / entry.callCount;
  entry.minTimeMs = Math.min(entry.minTimeMs, durationMs);
  entry.maxTimeMs = Math.max(entry.maxTimeMs, durationMs);
  entry.memoryDeltaBytes += memoryDeltaBytes;
  entry.lastCalledAt = Date.now();
  session.totalCallsRecorded++;
  return entry;
}

export function endSession(sessionId: string): ProfileSession | null {
  const session = sessions.get(sessionId);
  if (!session) return null;
  session.endedAt = Date.now();
  return session;
}

export function getHotspots(sessionId: string, topN = 5): ProfileEntry[] {
  const session = sessions.get(sessionId);
  if (!session) return [];
  return [...session.entries.values()].sort((a, b) => b.totalTimeMs - a.totalTimeMs).slice(0, topN);
}

export function getSession(sessionId: string): ProfileSession | undefined { return sessions.get(sessionId); }
export function _resetPerformanceProfilerForTest(): void { sessions.clear(); sessionCounter = 0; entryCounter = 0; }
