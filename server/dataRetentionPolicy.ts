import { createLogger } from "./logger.js";
const log = createLogger("DataRetentionPolicy");
/**
 * dataRetentionPolicy.ts — v74.0.0 "Privacy & Data Protection"
 * Manages data retention schedules and enforces deletion of expired records.
 */
export interface RetentionRule {
  ruleId: string;
  dataType: string;
  retentionDays: number;
  autoDelete: boolean;
  legalBasis: string;
}

export interface DataRecord {
  recordId: string;
  dataType: string;
  createdAt: number;
  expiresAt: number;
  deleted: boolean;
}

const rules: RetentionRule[] = [];
const records: DataRecord[] = [];
let ruleCounter = 0;
let recordCounter = 0;

export function addRetentionRule(dataType: string, retentionDays: number, autoDelete: boolean, legalBasis: string): RetentionRule {
  const rule: RetentionRule = { ruleId: `rule-${++ruleCounter}`, dataType, retentionDays, autoDelete, legalBasis };
  rules.push(rule);
  return rule;
}

export function registerDataRecord(dataType: string): DataRecord {
  const rule = rules.find(r => r.dataType === dataType);
  const retentionDays = rule?.retentionDays ?? 30;
  const record: DataRecord = {
    recordId: `record-${++recordCounter}`, dataType, createdAt: Date.now(),
    expiresAt: Date.now() + retentionDays * 86400000, deleted: false,
  };
  records.push(record);
  return record;
}

export function enforceRetention(nowMs = Date.now()): { deleted: number; retained: number } {
  let deleted = 0;
  let retained = 0;
  for (const record of records) {
    if (!record.deleted && record.expiresAt <= nowMs) {
      const rule = rules.find(r => r.dataType === record.dataType);
      if (rule?.autoDelete !== false) { record.deleted = true; deleted++; }
    } else if (!record.deleted) { retained++; }
  }
  log.info(`[DataRetentionPolicy] Enforcement run: ${deleted} deleted, ${retained} retained.`);
  return { deleted, retained };
}

export function getRetentionRules(): RetentionRule[] { return [...rules]; }
export function getDataRecords(): DataRecord[] { return [...records]; }
export function _resetDataRetentionPolicyForTest(): void { rules.length = 0; records.length = 0; ruleCounter = 0; recordCounter = 0; }
