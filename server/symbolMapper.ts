/**
 * symbolMapper.ts — v94.0.0 "Emergent Communication & Language Grounding"
 * Maps between symbolic representations, neural embeddings, and structured knowledge.
 */
export interface SymbolMapping {
  mappingId: string;
  sourceSymbol: string;
  targetSymbol: string;
  mappingType: "synonym" | "antonym" | "hypernym" | "hyponym" | "meronym" | "translation";
  confidence: number;
  bidirectional: boolean;
}

export interface EmbeddingEntry {
  entryId: string;
  symbol: string;
  embedding: number[];
  domain: string;
  createdAt: number;
}

const mappings: SymbolMapping[] = [];
const embeddings = new Map<string, EmbeddingEntry>();
let mappingCounter = 0;
let embeddingCounter = 0;

function cosineSimilarity(a: number[], b: number[]): number {
  const dot = a.reduce((s, v, i) => s + v * (b[i] ?? 0), 0);
  const magA = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
  const magB = Math.sqrt(b.reduce((s, v) => s + v * v, 0));
  return magA > 0 && magB > 0 ? dot / (magA * magB) : 0;
}

export function addMapping(sourceSymbol: string, targetSymbol: string, mappingType: SymbolMapping["mappingType"], confidence = 0.9, bidirectional = false): SymbolMapping {
  const mapping: SymbolMapping = { mappingId: `sm-${++mappingCounter}`, sourceSymbol, targetSymbol, mappingType, confidence, bidirectional };
  mappings.push(mapping);
  return mapping;
}

export function storeEmbedding(symbol: string, embedding: number[], domain = "general"): EmbeddingEntry {
  const entry: EmbeddingEntry = { entryId: `emb-${++embeddingCounter}`, symbol, embedding, domain, createdAt: Date.now() };
  embeddings.set(symbol, entry);
  return entry;
}

export function findSimilarSymbols(symbol: string, topN = 5): Array<{ symbol: string; similarity: number }> {
  const query = embeddings.get(symbol);
  if (!query) return [];
  const similarities: Array<{ symbol: string; similarity: number }> = [];
  for (const [sym, entry] of embeddings) {
    if (sym === symbol) continue;
    similarities.push({ symbol: sym, similarity: cosineSimilarity(query.embedding, entry.embedding) });
  }
  return similarities.sort((a, b) => b.similarity - a.similarity).slice(0, topN);
}

export function getMappings(sourceSymbol: string, mappingType?: SymbolMapping["mappingType"]): SymbolMapping[] {
  return mappings.filter(m => (m.sourceSymbol === sourceSymbol || (m.bidirectional && m.targetSymbol === sourceSymbol)) && (!mappingType || m.mappingType === mappingType));
}

export function getEmbedding(symbol: string): EmbeddingEntry | undefined { return embeddings.get(symbol); }
export function _resetSymbolMapperForTest(): void { mappings.length = 0; embeddings.clear(); mappingCounter = 0; embeddingCounter = 0; }
