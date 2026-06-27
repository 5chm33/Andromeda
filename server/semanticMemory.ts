/**
 * semanticMemory.ts — v91.0.0 "Cognitive Architecture & Memory Systems"
 * Long-term semantic memory storing factual knowledge as concept-relation triples.
 */
export interface Concept {
  conceptId: string;
  name: string;
  category: string;
  attributes: Record<string, unknown>;
  embedding: number[];
  accessCount: number;
}

export interface SemanticRelation {
  relationId: string;
  fromConceptId: string;
  toConceptId: string;
  relationType: string;
  strength: number;
  bidirectional: boolean;
}

export interface SemanticMemoryStore {
  storeId: string;
  concepts: Map<string, Concept>;
  relations: SemanticRelation[];
  totalQueries: number;
}

const stores = new Map<string, SemanticMemoryStore>();
let storeCounter = 0;
let conceptCounter = 0;
let relationCounter = 0;

export function createSemanticMemory(): SemanticMemoryStore {
  const store: SemanticMemoryStore = { storeId: `sm-${++storeCounter}`, concepts: new Map(), relations: [], totalQueries: 0 };
  stores.set(store.storeId, store);
  return store;
}

export function addConcept(storeId: string, name: string, category: string, attributes: Record<string, unknown> = {}, embedding: number[] = []): Concept | null {
  const store = stores.get(storeId);
  if (!store) return null;
  const concept: Concept = { conceptId: `con-${++conceptCounter}`, name, category, attributes, embedding, accessCount: 0 };
  store.concepts.set(concept.conceptId, concept);
  return concept;
}

export function addRelation(storeId: string, fromId: string, toId: string, relationType: string, strength = 1.0, bidirectional = false): SemanticRelation | null {
  const store = stores.get(storeId);
  if (!store) return null;
  const relation: SemanticRelation = { relationId: `rel-${++relationCounter}`, fromConceptId: fromId, toConceptId: toId, relationType, strength, bidirectional };
  store.relations.push(relation);
  return relation;
}

export function queryConcept(storeId: string, name: string): Concept | null {
  const store = stores.get(storeId);
  if (!store) return null;
  store.totalQueries++;
  for (const concept of store.concepts.values()) {
    if (concept.name.toLowerCase() === name.toLowerCase()) { concept.accessCount++; return concept; }
  }
  return null;
}

export function getRelatedConcepts(storeId: string, conceptId: string, relationType?: string): Concept[] {
  const store = stores.get(storeId);
  if (!store) return [];
  const related = store.relations.filter(r => (r.fromConceptId === conceptId || (r.bidirectional && r.toConceptId === conceptId)) && (!relationType || r.relationType === relationType));
  return related.map(r => store.concepts.get(r.fromConceptId === conceptId ? r.toConceptId : r.fromConceptId)).filter(Boolean) as Concept[];
}

export function getStore(storeId: string): SemanticMemoryStore | undefined { return stores.get(storeId); }
export function _resetSemanticMemoryForTest(): void { stores.clear(); storeCounter = 0; conceptCounter = 0; relationCounter = 0; }
