/**
 * spanProcessor.ts — v80.0.0 "Distributed Tracing & Observability"
 * Processes spans through enrichment, filtering, and batching pipelines.
 */
export interface SpanEnrichment {
  key: string;
  value: string;
}

export interface ProcessedSpan {
  spanId: string;
  traceId: string;
  operationName: string;
  service: string;
  durationMs: number | null;
  enrichments: SpanEnrichment[];
  filtered: boolean;
  processedAt: number;
}

export interface ProcessorConfig {
  enrichments: SpanEnrichment[];
  filterPredicate: ((span: { operationName: string; service: string; durationMs: number | null }) => boolean) | null;
  batchSize: number;
}

let config: ProcessorConfig = { enrichments: [], filterPredicate: null, batchSize: 100 };
const processedBatches: ProcessedSpan[][] = [];
let currentBatch: ProcessedSpan[] = [];

export function configureProcessor(newConfig: Partial<ProcessorConfig>): void {
  config = { ...config, ...newConfig };
}

export function processSpan(span: { spanId: string; traceId: string; operationName: string; service: string; durationMs: number | null }): ProcessedSpan {
  const filtered = config.filterPredicate ? !config.filterPredicate(span) : false;
  const processed: ProcessedSpan = {
    spanId: span.spanId,
    traceId: span.traceId,
    operationName: span.operationName,
    service: span.service,
    durationMs: span.durationMs,
    enrichments: [...config.enrichments],
    filtered,
    processedAt: Date.now(),
  };

  if (!filtered) {
    currentBatch.push(processed);
    if (currentBatch.length >= config.batchSize) {
      processedBatches.push([...currentBatch]);
      currentBatch = [];
    }
  }

  return processed;
}

export function flushBatch(): ProcessedSpan[] {
  if (currentBatch.length > 0) {
    processedBatches.push([...currentBatch]);
    const flushed = [...currentBatch];
    currentBatch = [];
    return flushed;
  }
  return [];
}

export function getProcessedBatches(): ProcessedSpan[][] { return [...processedBatches]; }
export function getCurrentBatch(): ProcessedSpan[] { return [...currentBatch]; }
export function _resetSpanProcessorForTest(): void { config = { enrichments: [], filterPredicate: null, batchSize: 100 }; processedBatches.length = 0; currentBatch = []; }
