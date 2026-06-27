/**
 * abTestingEngine.ts — v77.0.0 "Feature Flags & Experimentation"
 * Assigns users to A/B test variants and records exposure and conversion events.
 */
export interface Variant {
  variantId: string;
  name: string;
  weight: number;
}

export interface Experiment {
  experimentId: string;
  name: string;
  variants: Variant[];
  active: boolean;
  createdAt: number;
}

export interface ExposureEvent {
  exposureId: string;
  experimentId: string;
  userId: string;
  variantId: string;
  exposedAt: number;
}

export interface ConversionEvent {
  conversionId: string;
  experimentId: string;
  userId: string;
  variantId: string;
  metric: string;
  value: number;
  convertedAt: number;
}

const experiments = new Map<string, Experiment>();
const exposures: ExposureEvent[] = [];
const conversions: ConversionEvent[] = [];
let expCounter = 0;
let convCounter = 0;

export function createExperiment(experimentId: string, name: string, variants: Variant[]): Experiment {
  const experiment: Experiment = { experimentId, name, variants, active: true, createdAt: Date.now() };
  experiments.set(experimentId, experiment);
  return experiment;
}

function assignVariant(userId: string, variants: Variant[]): Variant {
  const totalWeight = variants.reduce((sum, v) => sum + v.weight, 0);
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  const bucket = hash % totalWeight;
  let cumulative = 0;
  for (const variant of variants) {
    cumulative += variant.weight;
    if (bucket < cumulative) return variant;
  }
  return variants[variants.length - 1];
}

export function exposeUser(experimentId: string, userId: string): ExposureEvent | null {
  const experiment = experiments.get(experimentId);
  if (!experiment || !experiment.active) return null;
  const variant = assignVariant(userId, experiment.variants);
  const exposure: ExposureEvent = { exposureId: `exp-${++expCounter}`, experimentId, userId, variantId: variant.variantId, exposedAt: Date.now() };
  exposures.push(exposure);
  return exposure;
}

export function recordConversion(experimentId: string, userId: string, metric: string, value: number): ConversionEvent | null {
  const exposure = exposures.find(e => e.experimentId === experimentId && e.userId === userId);
  if (!exposure) return null;
  const conversion: ConversionEvent = { conversionId: `conv-${++convCounter}`, experimentId, userId, variantId: exposure.variantId, metric, value, convertedAt: Date.now() };
  conversions.push(conversion);
  return conversion;
}

export function getExperimentResults(experimentId: string): Record<string, { exposures: number; conversions: number; avgValue: number }> {
  const experiment = experiments.get(experimentId);
  if (!experiment) return {};
  const results: Record<string, { exposures: number; conversions: number; avgValue: number }> = {};
  for (const variant of experiment.variants) {
    const variantExposures = exposures.filter(e => e.experimentId === experimentId && e.variantId === variant.variantId);
    const variantConversions = conversions.filter(c => c.experimentId === experimentId && c.variantId === variant.variantId);
    const avgValue = variantConversions.length > 0 ? variantConversions.reduce((sum, c) => sum + c.value, 0) / variantConversions.length : 0;
    results[variant.variantId] = { exposures: variantExposures.length, conversions: variantConversions.length, avgValue };
  }
  return results;
}

export function getExperiment(experimentId: string): Experiment | undefined { return experiments.get(experimentId); }
export function _resetAbTestingEngineForTest(): void { experiments.clear(); exposures.length = 0; conversions.length = 0; expCounter = 0; convCounter = 0; }
