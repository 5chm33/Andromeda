/**
 * memoryConsolidator.ts — v58.0.0 "The Memory Palace"
 * Consolidates working memory into long-term storage using sleep-like replay cycles.
 */

export interface ConsolidationRecord { recordId: string; itemsConsolidated: number; strengthGained: number; timestamp: number; }
const consolidationLog: ConsolidationRecord[] = [];
let recCounter = 0;

export function consolidateMemories(workingItems: Array<{ content: string; attentionWeight: number }>, threshold = 0.4): ConsolidationRecord {
  const eligible = workingItems.filter(i => i.attentionWeight >= threshold);
  const strengthGained = eligible.reduce((s, i) => s + i.attentionWeight, 0);
  const record: ConsolidationRecord = { recordId: `cons-${++recCounter}`, itemsConsolidated: eligible.length, strengthGained, timestamp: Date.now() };
  consolidationLog.push(record);
  return record;
}

export function getConsolidationLog(): ConsolidationRecord[] { return [...consolidationLog]; }
export function _resetMemoryConsolidatorForTest(): void { consolidationLog.length = 0; recCounter = 0; }
