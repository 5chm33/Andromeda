/**
 * domainAdaptationEngine.ts — v64.0.0 "The Adaptation Engine"
 * Adapts models across domains using feature alignment and domain-invariant representation.
 */

export interface DomainProfile { domainId: string; name: string; featureStats: { mean: number[]; std: number[] }; sampleCount: number; }
export interface AdaptationMapping { mappingId: string; sourceDomain: string; targetDomain: string; alignmentScore: number; transformMatrix: number[][]; }

const domains = new Map<string, DomainProfile>();
const mappings: AdaptationMapping[] = [];
let dCounter = 0, mCounter = 0;

export function registerDomain(name: string, features: number[][]): DomainProfile {
  const dim = features[0]?.length ?? 0;
  const mean = Array.from({ length: dim }, (_, i) => features.reduce((s, f) => s + (f[i] ?? 0), 0) / features.length);
  const std = Array.from({ length: dim }, (_, i) => Math.sqrt(features.reduce((s, f) => s + Math.pow((f[i] ?? 0) - mean[i], 2), 0) / features.length));
  const profile: DomainProfile = { domainId: `dom-${++dCounter}`, name, featureStats: { mean, std }, sampleCount: features.length };
  domains.set(name, profile);
  return profile;
}

export function adaptDomain(sourceName: string, targetName: string): AdaptationMapping {
  const source = domains.get(sourceName);
  const target = domains.get(targetName);
  if (!source || !target) throw new Error(`[DomainAdaptationEngine] Domain not found`);
  const dim = source.featureStats.mean.length;
  // Simple Z-score normalization alignment
  const transformMatrix = Array.from({ length: dim }, (_, i) => {
    const scale = target.featureStats.std[i] > 0 ? source.featureStats.std[i] / target.featureStats.std[i] : 1;
    return [scale, target.featureStats.mean[i] - source.featureStats.mean[i] * scale];
  });
  const alignmentScore = 1 - Math.min(1, transformMatrix.reduce((s, row) => s + Math.abs(row[0] - 1), 0) / dim);
  const mapping: AdaptationMapping = { mappingId: `map-${++mCounter}`, sourceDomain: sourceName, targetDomain: targetName, alignmentScore, transformMatrix };
  mappings.push(mapping);
  return mapping;
}

export function getMappings(): AdaptationMapping[] { return [...mappings]; }
export function _resetDomainAdaptationEngineForTest(): void { domains.clear(); mappings.length = 0; dCounter = 0; mCounter = 0; }
