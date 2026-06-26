/**
 * analogicalReasoningBridge.ts — v57.0.0 "The Reasoning Engine"
 * Maps structural similarities between source and target domains to transfer insights.
 */

export interface AnalogyConcept { conceptId: string; domain: string; features: Record<string, number>; }
export interface AnalogyMapping {
  mappingId: string;
  sourceConcept: string;
  targetConcept: string;
  similarityScore: number;
  mappedFeatures: string[];
  transferableInsights: string[];
}

const concepts = new Map<string, AnalogyConcept>();
const mappings: AnalogyMapping[] = [];
let mapCounter = 0;

export function registerConcept(concept: AnalogyConcept): void { concepts.set(concept.conceptId, concept); }

export function findAnalogies(sourceId: string, targetDomain: string): AnalogyMapping[] {
  const source = concepts.get(sourceId);
  if (!source) return [];
  const targets = Array.from(concepts.values()).filter(c => c.domain === targetDomain);
  const newMappings: AnalogyMapping[] = [];
  for (const target of targets) {
    const sourceKeys = Object.keys(source.features);
    const targetKeys = Object.keys(target.features);
    const common = sourceKeys.filter(k => targetKeys.includes(k));
    if (common.length === 0) continue;
    const similarity = common.reduce((s, k) => {
      const diff = Math.abs((source.features[k] ?? 0) - (target.features[k] ?? 0));
      return s + (1 - Math.min(diff, 1));
    }, 0) / common.length;
    const mapping: AnalogyMapping = {
      mappingId: `map-${++mapCounter}`,
      sourceConcept: sourceId,
      targetConcept: target.conceptId,
      similarityScore: similarity,
      mappedFeatures: common,
      transferableInsights: common.map(k => `Feature "${k}" transfers from ${source.domain} to ${target.domain}`),
    };
    mappings.push(mapping);
    newMappings.push(mapping);
  }
  return newMappings.sort((a, b) => b.similarityScore - a.similarityScore);
}

export function getMappings(): AnalogyMapping[] { return [...mappings]; }
export function _resetAnalogicalReasoningBridgeForTest(): void { concepts.clear(); mappings.length = 0; mapCounter = 0; }
