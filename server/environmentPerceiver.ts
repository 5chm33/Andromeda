/**
 * environmentPerceiver.ts — v95.0.0 "Embodied Cognition & Spatial Reasoning"
 * Perceives and models the environment from an agent's sensory perspective.
 */
export type SensorType = "visual" | "auditory" | "tactile" | "proprioceptive" | "proximity";
export interface SensorReading {
  readingId: string;
  agentId: string;
  sensorType: SensorType;
  value: unknown;
  confidence: number;
  timestamp: number;
  position: { x: number; y: number };
}
export interface PerceptualModel {
  modelId: string;
  agentId: string;
  perceivedObjects: Array<{ objectId: string; type: string; distance: number; direction: number; confidence: number }>;
  currentPosition: { x: number; y: number };
  heading: number;
  lastUpdatedAt: number;
}

const readings: SensorReading[] = [];
const models = new Map<string, PerceptualModel>();
let readingCounter = 0;
let modelCounter = 0;

export function recordReading(agentId: string, sensorType: SensorType, value: unknown, confidence: number, position: { x: number; y: number }): SensorReading {
  const reading: SensorReading = { readingId: `sr-${++readingCounter}`, agentId, sensorType, value, confidence, timestamp: Date.now(), position };
  readings.push(reading);
  return reading;
}

export function updatePerceptualModel(agentId: string, perceivedObjects: PerceptualModel["perceivedObjects"], position: { x: number; y: number }, heading: number): PerceptualModel {
  let model = models.get(agentId);
  if (!model) { model = { modelId: `pm-${++modelCounter}`, agentId, perceivedObjects: [], currentPosition: position, heading, lastUpdatedAt: Date.now() }; models.set(agentId, model); }
  model.perceivedObjects = perceivedObjects;
  model.currentPosition = position;
  model.heading = heading;
  model.lastUpdatedAt = Date.now();
  return model;
}

export function getPerceivedObjects(agentId: string, maxDistance?: number): PerceptualModel["perceivedObjects"] {
  const model = models.get(agentId);
  if (!model) return [];
  return maxDistance !== undefined ? model.perceivedObjects.filter(o => o.distance <= maxDistance) : [...model.perceivedObjects];
}

export function getReadings(agentId: string, sensorType?: SensorType): SensorReading[] {
  return readings.filter(r => r.agentId === agentId && (!sensorType || r.sensorType === sensorType));
}
export function getModel(agentId: string): PerceptualModel | undefined { return models.get(agentId); }
export function _resetEnvironmentPerceiverForTest(): void { readings.length = 0; models.clear(); readingCounter = 0; modelCounter = 0; }
