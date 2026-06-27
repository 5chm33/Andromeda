import { createLogger } from "./logger.js";
const log = createLogger("AnonymizationPipeline");
/**
 * anonymizationPipeline.ts — v74.0.0 "Privacy & Data Protection"
 * Applies k-anonymity and pseudonymization techniques to datasets.
 */
export interface DataRow { [key: string]: string | number | boolean; }
export type AnonymizationTechnique = "pseudonymize" | "generalize" | "suppress" | "noise";

export interface AnonymizationConfig {
  field: string;
  technique: AnonymizationTechnique;
  kValue?: number;
  noiseRange?: number;
  generalizationMap?: Record<string, string>;
}

export interface AnonymizationResult {
  pipelineId: string;
  inputRows: number;
  outputRows: number;
  anonymizedFields: string[];
  technique: string;
  suppressedRows: number;
}

const pipelineHistory: AnonymizationResult[] = [];
let pipelineCounter = 0;

function pseudonymize(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) { hash = (hash * 31 + value.charCodeAt(i)) >>> 0; }
  return `pseudo-${hash.toString(16)}`;
}

export function runAnonymizationPipeline(rows: DataRow[], configs: AnonymizationConfig[]): { rows: DataRow[]; result: AnonymizationResult } {
  let processedRows = rows.map(row => ({ ...row }));
  let suppressedRows = 0;
  const anonymizedFields: string[] = [];

  for (const config of configs) {
    anonymizedFields.push(config.field);
    if (config.technique === "pseudonymize") {
      processedRows = processedRows.map(row => {
        const val = row[config.field];
        return { ...row, [config.field]: val !== undefined ? pseudonymize(String(val)) : val };
      });
    } else if (config.technique === "generalize" && config.generalizationMap) {
      const map = config.generalizationMap;
      processedRows = processedRows.map(row => {
        const val = String(row[config.field] ?? "");
        return { ...row, [config.field]: map[val] ?? val };
      });
    } else if (config.technique === "suppress") {
      const before = processedRows.length;
      processedRows = processedRows.filter(row => row[config.field] !== undefined && row[config.field] !== "");
      suppressedRows += before - processedRows.length;
    } else if (config.technique === "noise" && config.noiseRange) {
      const range = config.noiseRange;
      processedRows = processedRows.map(row => {
        const val = Number(row[config.field]);
        if (!isNaN(val)) return { ...row, [config.field]: val + (Math.random() * 2 - 1) * range };
        return row;
      });
    }
  }

  const result: AnonymizationResult = {
    pipelineId: `anon-pipeline-${++pipelineCounter}`,
    inputRows: rows.length,
    outputRows: processedRows.length,
    anonymizedFields,
    technique: configs.map(c => c.technique).join(", "),
    suppressedRows,
  };
  pipelineHistory.push(result);
  log.info(`[AnonymizationPipeline] Pipeline ${result.pipelineId}: ${rows.length} → ${processedRows.length} rows`);
  return { rows: processedRows, result };
}

export function getPipelineHistory(): AnonymizationResult[] { return [...pipelineHistory]; }
export function _resetAnonymizationPipelineForTest(): void { pipelineHistory.length = 0; pipelineCounter = 0; }
