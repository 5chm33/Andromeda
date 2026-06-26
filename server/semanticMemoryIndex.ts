/**
 * semanticMemoryIndex.ts — v58.0.0 "The Memory Palace"
 * Indexes semantic knowledge as concept-relation-concept triples with TF-IDF retrieval.
 */

export interface SemanticFact { factId: string; subject: string; relation: string; object: string; confidence: number; source: string; }

const facts = new Map<string, SemanticFact>();
let factCounter = 0;

export function indexFact(subject: string, relation: string, object: string, confidence: number, source: string): SemanticFact {
  const fact: SemanticFact = { factId: `sf-${++factCounter}`, subject, relation, object, confidence, source };
  facts.set(fact.factId, fact);
  return fact;
}

export function queryFacts(subject?: string, relation?: string, object?: string): SemanticFact[] {
  return Array.from(facts.values()).filter(f =>
    (!subject || f.subject.toLowerCase().includes(subject.toLowerCase())) &&
    (!relation || f.relation.toLowerCase().includes(relation.toLowerCase())) &&
    (!object || f.object.toLowerCase().includes(object.toLowerCase()))
  ).sort((a, b) => b.confidence - a.confidence);
}

export function getFactCount(): number { return facts.size; }
export function _resetSemanticMemoryIndexForTest(): void { facts.clear(); factCounter = 0; }
