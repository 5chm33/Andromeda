/**
 * dataPipelineEngine.ts — v69.0.0 "Data Pipeline"
 * ETL pipeline with source connectors, transformers, sinks, and lineage tracking.
 */
export type PipelineStage = "extract" | "transform" | "load";
export interface PipelineStep { name: string; stage: PipelineStage; fn: (data: unknown) => Promise<unknown>; }
export interface PipelineResult { pipelineId: string; inputCount: number; outputCount: number; stages: string[]; durationMs: number; success: boolean; error?: string; lineage: string[]; }

const pipelines = new Map<string, PipelineStep[]>();
const results: PipelineResult[] = [];
let pipelineCounter = 0;

export function definePipeline(name: string, steps: PipelineStep[]): void { pipelines.set(name, steps); }

export async function runPipeline(name: string, input: unknown[]): Promise<PipelineResult> {
  const steps = pipelines.get(name);
  if (!steps) throw new Error(`[DataPipeline] Pipeline not found: ${name}`);
  const start = Date.now();
  const result: PipelineResult = { pipelineId: `pipe-${++pipelineCounter}`, inputCount: input.length, outputCount: 0, stages: steps.map(s => s.name), durationMs: 0, success: false, lineage: [] };
  results.push(result);
  try {
    let data: unknown = input;
    for (const step of steps) {
      result.lineage.push(`${step.stage}:${step.name}`);
      data = await step.fn(data);
    }
    result.outputCount = Array.isArray(data) ? data.length : 1;
    result.success = true;
  } catch (e: unknown) { result.error = e instanceof Error ? e.message : String(e); }
  result.durationMs = Date.now() - start;
  return result;
}

export function getPipelineResults(): PipelineResult[] { return [...results]; }
export function _resetDataPipelineForTest(): void { pipelines.clear(); results.length = 0; pipelineCounter = 0; }
