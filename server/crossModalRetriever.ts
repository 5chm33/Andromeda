/**
 * crossModalRetriever.ts — v72.0.0 "Multi-Modal Fusion"
 * Cross-modal retrieval: given a query in one modality, retrieve semantically similar content from other modalities.
 * Uses cosine similarity over embedding vectors for ranking.
 */
export type Modality = "vision" | "audio" | "text" | "video" | "diagram";

export interface ModalityDocument {
  docId: string;
  modality: Modality;
  content: string;
  embedding: number[];
  metadata: Record<string, unknown>;
  indexedAt: number;
}

export interface RetrievalResult {
  doc: ModalityDocument;
  score: number;
  rank: number;
}

export interface RetrievalQuery {
  queryId: string;
  queryText: string;
  queryEmbedding: number[];
  targetModalities: Modality[];
  topK: number;
  results: RetrievalResult[];
  retrievedAt: number;
}

const index: ModalityDocument[] = [];
const queryHistory: RetrievalQuery[] = [];
let docCounter = 0;
let queryCounter = 0;

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export function indexDocument(modality: Modality, content: string, embedding: number[], metadata: Record<string, unknown> = {}): ModalityDocument {
  const doc: ModalityDocument = {
    docId: `doc-${++docCounter}`, modality, content, embedding, metadata, indexedAt: Date.now()
  };
  index.push(doc);
  console.log(`[CrossModalRetriever] Indexed ${modality} document ${doc.docId}`);
  return doc;
}

export function retrieveCrossModal(queryText: string, queryEmbedding: number[], targetModalities: Modality[], topK = 5): RetrievalQuery {
  const candidates = targetModalities.length > 0 ? index.filter(d => targetModalities.includes(d.modality)) : [...index];
  const scored = candidates.map(doc => ({ doc, score: cosineSimilarity(queryEmbedding, doc.embedding) }));
  scored.sort((a, b) => b.score - a.score);
  const results: RetrievalResult[] = scored.slice(0, topK).map((s, i) => ({ doc: s.doc, score: s.score, rank: i + 1 }));
  const query: RetrievalQuery = {
    queryId: `query-${++queryCounter}`, queryText, queryEmbedding, targetModalities, topK, results, retrievedAt: Date.now()
  };
  queryHistory.push(query);
  console.log(`[CrossModalRetriever] Query ${query.queryId}: retrieved ${results.length} results across [${targetModalities.join(",")}]`);
  return query;
}

export function getIndexSize(): number { return index.length; }
export function getIndexedDocuments(): ModalityDocument[] { return [...index]; }
export function getQueryHistory(): RetrievalQuery[] { return [...queryHistory]; }

export function _resetCrossModalRetrieverForTest(): void {
  index.length = 0;
  queryHistory.length = 0;
  docCounter = 0;
  queryCounter = 0;
}
