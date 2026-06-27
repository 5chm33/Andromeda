/**
 * graphQueryEngine.ts — v85.0.0 "Knowledge Graph & Reasoning"
 * Executes structured graph queries with pattern matching and aggregation.
 */
export interface GraphPattern {
  subject?: string;
  predicate?: string;
  object?: string;
  nodeType?: string;
}

export interface GraphQueryResult {
  matches: Array<{ subject: string; predicate: string; object: string; weight: number }>;
  count: number;
  executionTimeMs: number;
}

export interface AggregationResult {
  groupBy: string;
  groups: Record<string, number>;
  total: number;
}

// In-memory triple store
const triples: Array<{ subject: string; predicate: string; object: string; weight: number; nodeType: string }> = [];

export function insertTriple(subject: string, predicate: string, object: string, weight = 1, nodeType = "entity"): void {
  triples.push({ subject, predicate, object, weight, nodeType });
}

export function queryPattern(pattern: GraphPattern): GraphQueryResult {
  const start = Date.now();
  const matches = triples.filter(t =>
    (!pattern.subject || t.subject === pattern.subject) &&
    (!pattern.predicate || t.predicate === pattern.predicate) &&
    (!pattern.object || t.object === pattern.object) &&
    (!pattern.nodeType || t.nodeType === pattern.nodeType)
  ).map(t => ({ subject: t.subject, predicate: t.predicate, object: t.object, weight: t.weight }));

  return { matches, count: matches.length, executionTimeMs: Date.now() - start };
}

export function queryChain(startSubject: string, predicates: string[]): string[] {
  let current = [startSubject];
  for (const predicate of predicates) {
    const next: string[] = [];
    for (const subject of current) {
      const found = triples.filter(t => t.subject === subject && t.predicate === predicate).map(t => t.object);
      next.push(...found);
    }
    current = [...new Set(next)];
    if (current.length === 0) break;
  }
  return current;
}

export function aggregateByPredicate(): AggregationResult {
  const groups: Record<string, number> = {};
  for (const t of triples) {
    groups[t.predicate] = (groups[t.predicate] ?? 0) + 1;
  }
  return { groupBy: "predicate", groups, total: triples.length };
}

export function aggregateBySubject(subject: string): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const t of triples.filter(t => t.subject === subject)) {
    if (!result[t.predicate]) result[t.predicate] = [];
    result[t.predicate].push(t.object);
  }
  return result;
}

export function getTripleCount(): number { return triples.length; }
export function _resetGraphQueryEngineForTest(): void { triples.length = 0; }
