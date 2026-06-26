/**
 * Concept Mapper — maps abstract concepts to concrete implementations.
 * Builds a semantic concept lattice for cross-domain reasoning.
 */

export interface Concept {
  id: string;
  name: string;
  domain: string;
  abstractionLevel: number;  // 0=concrete, 1=abstract, 2=meta-abstract
  relatedConcepts: string[];
  implementations: string[];
  confidence: number;
}

export interface ConceptMapping {
  sourceConceptId: string;
  targetConceptId: string;
  mappingType: "isA" | "partOf" | "analogous" | "opposes" | "enables";
  strength: number;  // 0-1
}

export interface ConceptMapReport {
  totalConcepts: number;
  totalMappings: number;
  avgAbstractionLevel: number;
  mostConnectedConcept: string;
  domainCoverage: string[];
}

class ConceptMapperEngine {
  private concepts: Map<string, Concept> = new Map();
  private mappings: ConceptMapping[] = [];
  private counter = 0;

  addConcept(name: string, domain: string, abstractionLevel: number, implementations: string[] = []): Concept {
    const concept: Concept = {
      id: `concept-${++this.counter}`,
      name, domain, abstractionLevel, relatedConcepts: [], implementations, confidence: 0.8,
    };
    this.concepts.set(concept.id, concept);
    return concept;
  }

  addMapping(sourceId: string, targetId: string, type: ConceptMapping["mappingType"], strength: number): ConceptMapping {
    const mapping: ConceptMapping = { sourceConceptId: sourceId, targetConceptId: targetId, mappingType: type, strength };
    this.mappings.push(mapping);
    const source = this.concepts.get(sourceId);
    const target = this.concepts.get(targetId);
    if (source && !source.relatedConcepts.includes(targetId)) source.relatedConcepts.push(targetId);
    if (target && !target.relatedConcepts.includes(sourceId)) target.relatedConcepts.push(sourceId);
    return mapping;
  }

  findRelatedConcepts(conceptId: string, maxDepth = 2): Concept[] {
    const visited = new Set<string>();
    const result: Concept[] = [];
    const queue: Array<{ id: string; depth: number }> = [{ id: conceptId, depth: 0 }];
    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (visited.has(id) || depth > maxDepth) continue;
      visited.add(id);
      const concept = this.concepts.get(id);
      if (concept && id !== conceptId) result.push(concept);
      if (concept) {
        for (const relId of concept.relatedConcepts) {
          if (!visited.has(relId)) queue.push({ id: relId, depth: depth + 1 });
        }
      }
    }
    return result;
  }

  getMostConnectedConcept(): Concept | null {
    let maxConnections = 0;
    let mostConnected: Concept | null = null;
    for (const concept of this.concepts.values()) {
      if (concept.relatedConcepts.length > maxConnections) {
        maxConnections = concept.relatedConcepts.length;
        mostConnected = concept;
      }
    }
    return mostConnected;
  }

  getConceptMapReport(): ConceptMapReport {
    const concepts = Array.from(this.concepts.values());
    const domains = [...new Set(concepts.map(c => c.domain))];
    const mostConnected = this.getMostConnectedConcept();
    return {
      totalConcepts: concepts.length,
      totalMappings: this.mappings.length,
      avgAbstractionLevel: concepts.length > 0
        ? concepts.reduce((s, c) => s + c.abstractionLevel, 0) / concepts.length
        : 0,
      mostConnectedConcept: mostConnected?.name ?? "none",
      domainCoverage: domains,
    };
  }

  getConcepts(): Concept[] { return Array.from(this.concepts.values()); }
  getMappings(): ConceptMapping[] { return [...this.mappings]; }
}

export const globalConceptMapper = new ConceptMapperEngine();

export function addConcept(name: string, domain: string, abstractionLevel: number, implementations?: string[]): Concept {
  return globalConceptMapper.addConcept(name, domain, abstractionLevel, implementations);
}
export function addConceptMapping(sourceId: string, targetId: string, type: ConceptMapping["mappingType"], strength: number): ConceptMapping {
  return globalConceptMapper.addMapping(sourceId, targetId, type, strength);
}
export function findRelatedConcepts(conceptId: string, maxDepth?: number): Concept[] {
  return globalConceptMapper.findRelatedConcepts(conceptId, maxDepth);
}
export function getConceptMapReport(): ConceptMapReport {
  return globalConceptMapper.getConceptMapReport();
}
export function initConceptMapper(): void {
  console.log("[ConceptMapper] Concept Mapper initialized.");
  const rsi = globalConceptMapper.addConcept("RecursiveSelfImprovement", "AI", 2, ["rsiEngine"]);
  const ml = globalConceptMapper.addConcept("MachineLearning", "AI", 1, ["rewardModel"]);
  const opt = globalConceptMapper.addConcept("Optimization", "Math", 1, ["multiObjectiveOptimizer"]);
  globalConceptMapper.addMapping(rsi.id, ml.id, "isA", 0.9);
  globalConceptMapper.addMapping(ml.id, opt.id, "enables", 0.8);
}
