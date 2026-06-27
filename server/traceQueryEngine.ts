/**
 * traceQueryEngine.ts — v80.0.0 "Distributed Tracing & Observability"
 * Queries stored traces by service, operation, duration, and error status.
 */
export interface TraceRecord {
  traceId: string;
  rootService: string;
  rootOperation: string;
  startTime: number;
  durationMs: number;
  spanCount: number;
  hasErrors: boolean;
  services: string[];
  tags: Record<string, string>;
}

export interface TraceQuery {
  service?: string;
  operation?: string;
  minDurationMs?: number;
  maxDurationMs?: number;
  hasErrors?: boolean;
  fromTime?: number;
  toTime?: number;
  tags?: Record<string, string>;
  limit?: number;
}

export interface QueryResult {
  traces: TraceRecord[];
  totalFound: number;
  queryDurationMs: number;
}

const traceStore: TraceRecord[] = [];

export function indexTrace(record: TraceRecord): void {
  traceStore.push(record);
}

export function queryTraces(query: TraceQuery): QueryResult {
  const start = Date.now();
  let results = traceStore.filter(t => {
    if (query.service && !t.services.includes(query.service)) return false;
    if (query.operation && t.rootOperation !== query.operation) return false;
    if (query.minDurationMs !== undefined && t.durationMs < query.minDurationMs) return false;
    if (query.maxDurationMs !== undefined && t.durationMs > query.maxDurationMs) return false;
    if (query.hasErrors !== undefined && t.hasErrors !== query.hasErrors) return false;
    if (query.fromTime !== undefined && t.startTime < query.fromTime) return false;
    if (query.toTime !== undefined && t.startTime > query.toTime) return false;
    if (query.tags) {
      for (const [k, v] of Object.entries(query.tags)) {
        if (t.tags[k] !== v) return false;
      }
    }
    return true;
  });

  const totalFound = results.length;
  if (query.limit) results = results.slice(0, query.limit);

  return { traces: results, totalFound, queryDurationMs: Date.now() - start };
}

export function getTraceCount(): number { return traceStore.length; }
export function _resetTraceQueryEngineForTest(): void { traceStore.length = 0; }
