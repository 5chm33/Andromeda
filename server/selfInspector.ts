/**
 * selfInspector.ts — v92.0.0 "Recursive Self-Improvement & Introspection"
 * Introspection system that examines the agent's own internal state, capabilities, and limitations.
 */
export interface CapabilityReport {
  reportId: string;
  agentId: string;
  capabilities: Record<string, { level: number; confidence: number; lastAssessed: number }>;
  limitations: string[];
  knowledgeGaps: string[];
  overallScore: number;
  generatedAt: number;
}

export interface IntrospectionLog {
  logId: string;
  agentId: string;
  question: string;
  reflection: string;
  confidence: number;
  timestamp: number;
}

const reports: CapabilityReport[] = [];
const logs: IntrospectionLog[] = [];
let reportCounter = 0;
let logCounter = 0;

export function assessCapabilities(agentId: string, capabilities: Record<string, { level: number; confidence: number }>): CapabilityReport {
  const limitations: string[] = [];
  const knowledgeGaps: string[] = [];

  for (const [cap, data] of Object.entries(capabilities)) {
    if (data.level < 0.3) limitations.push(`Low proficiency in ${cap}`);
    if (data.confidence < 0.4) knowledgeGaps.push(`Uncertain about ${cap}`);
  }

  const capValues = Object.values(capabilities);
  const overallScore = capValues.length > 0 ? capValues.reduce((s, c) => s + c.level * c.confidence, 0) / capValues.length : 0;

  const report: CapabilityReport = {
    reportId: `cr-${++reportCounter}`,
    agentId,
    capabilities: Object.fromEntries(Object.entries(capabilities).map(([k, v]) => [k, { ...v, lastAssessed: Date.now() }])),
    limitations, knowledgeGaps, overallScore,
    generatedAt: Date.now(),
  };
  reports.push(report);
  return report;
}

export function reflect(agentId: string, question: string, reflection: string, confidence: number): IntrospectionLog {
  const log: IntrospectionLog = { logId: `il-${++logCounter}`, agentId, question, reflection, confidence, timestamp: Date.now() };
  logs.push(log);
  return log;
}

export function getLatestReport(agentId: string): CapabilityReport | null { return [...reports].reverse().find(r => r.agentId === agentId) ?? null; }
export function getReflections(agentId: string): IntrospectionLog[] { return logs.filter(l => l.agentId === agentId); }
export function _resetSelfInspectorForTest(): void { reports.length = 0; logs.length = 0; reportCounter = 0; logCounter = 0; }
