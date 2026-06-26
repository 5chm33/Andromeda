/**
 * memoryRetrievalOptimizer.ts — v58.0.0 "The Memory Palace"
 * Optimizes memory retrieval using cue-based indexing and spreading activation.
 */

export interface RetrievalCue { cue: string; strength: number; }
export interface RetrievalResult { memoryId: string; content: string; relevanceScore: number; retrievalTime: number; }

const index = new Map<string, Array<{ memoryId: string; content: string }>>();
let queryCounter = 0;

export function indexMemory(memoryId: string, content: string, cues: string[]): void {
  for (const cue of cues) {
    const key = cue.toLowerCase();
    if (!index.has(key)) index.set(key, []);
    index.get(key)!.push({ memoryId, content });
  }
}

export function retrieveByAssociation(cues: RetrievalCue[], limit = 5): RetrievalResult[] {
  queryCounter++;
  const start = Date.now();
  const scores = new Map<string, { content: string; score: number }>();
  for (const { cue, strength } of cues) {
    const matches = index.get(cue.toLowerCase()) ?? [];
    for (const m of matches) {
      const prev = scores.get(m.memoryId) ?? { content: m.content, score: 0 };
      scores.set(m.memoryId, { content: m.content, score: prev.score + strength });
    }
  }
  return Array.from(scores.entries())
    .map(([memoryId, { content, score }]) => ({ memoryId, content, relevanceScore: score, retrievalTime: Date.now() - start }))
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, limit);
}

export function getQueryCount(): number { return queryCounter; }
export function _resetMemoryRetrievalOptimizerForTest(): void { index.clear(); queryCounter = 0; }
