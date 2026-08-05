/**
 * stigmergyEngine.ts — v99.0.0 "Collective Intelligence & Swarm Cognition"
 * Indirect coordination through environmental traces (stigmergy), inspired by ant colonies.
 */
export interface StigmergyTrace {
  traceId: string;
  agentId: string;
  position: { x: number; y: number };
  type: string;
  intensity: number;
  evaporationRate: number;
  createdAt: number;
  lastUpdatedAt: number;
}

export interface StigmergyField {
  fieldId: string;
  name: string;
  traces: Map<string, StigmergyTrace>;
  width: number;
  height: number;
  globalEvaporationRate: number;
}

const fields = new Map<string, StigmergyField>();
let fieldCounter = 0;
let traceCounter = 0;

export function createField(name: string, width: number, height: number, evaporationRate = 0.05): StigmergyField {
  const field: StigmergyField = { fieldId: `sf-${++fieldCounter}`, name, traces: new Map(), width, height, globalEvaporationRate: evaporationRate };
  fields.set(field.fieldId, field);
  return field;
}

export function depositTrace(fieldId: string, agentId: string, position: { x: number; y: number }, type: string, intensity: number): StigmergyTrace | null {
  const field = fields.get(fieldId);
  if (!field) return null;
  const trace: StigmergyTrace = { traceId: `st-${++traceCounter}`, agentId, position, type, intensity, evaporationRate: field.globalEvaporationRate, createdAt: Date.now(), lastUpdatedAt: Date.now() };
  field.traces.set(trace.traceId, trace);
  return trace;
}

export function evaporateField(fieldId: string): void {
  const field = fields.get(fieldId);
  if (!field) return;
  for (const [id, trace] of field.traces) {
    trace.intensity *= (1 - trace.evaporationRate);
    trace.lastUpdatedAt = Date.now();
    if (trace.intensity < 0.01) field.traces.delete(id);
  }
}

export function getTracesNear(fieldId: string, position: { x: number; y: number }, radius: number, type?: string): StigmergyTrace[] {
  const field = fields.get(fieldId);
  if (!field) return [];
  return [...field.traces.values()].filter(t => {
    if (type && t.type !== type) return false;
    const dx = t.position.x - position.x; const dy = t.position.y - position.y;
    return Math.sqrt(dx * dx + dy * dy) <= radius;
  });
}

export function getField(fieldId: string): StigmergyField | undefined { return fields.get(fieldId); }
export function _resetStigmergyEngineForTest(): void { fields.clear(); fieldCounter = 0; traceCounter = 0; }
