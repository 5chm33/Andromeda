/**
 * semanticSearchEngine.ts — v73.0.0 "Knowledge Retrieval"
 * Semantic search over a document corpus using embedding-based similarity ranking.
 */
export interface SearchDocument { docId: string; title: string; content: string; embedding: number[]; tags: string[]; createdAt: number; }
export interface SearchResult { doc: SearchDocument; score: number; rank: number; snippet: string; }
export interface SearchQuery { queryId: string; queryText: string; results: SearchResult[]; totalDocs: number; searchedAt: number; }

const corpus: SearchDocument[] = [];
const queryLog: SearchQuery[] = [];
let docCounter = 0;
let queryCounter = 0;

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

export function indexSearchDocument(title: string, content: string, embedding: number[], tags: string[] = []): SearchDocument {
  const doc: SearchDocument = { docId: `sdoc-${++docCounter}`, title, content, embedding, tags, createdAt: Date.now() };
  corpus.push(doc);
  console.log(`[SemanticSearchEngine] Indexed document ${doc.docId}: "${title}"`);
  return doc;
}

export function semanticSearch(queryText: string, queryEmbedding: number[], topK = 5, filterTags?: string[]): SearchQuery {
  const candidates = filterTags ? corpus.filter(d => filterTags.some(t => d.tags.includes(t))) : [...corpus];
  const scored = candidates.map(doc => ({ doc, score: cosine(queryEmbedding, doc.embedding) }));
  scored.sort((a, b) => b.score - a.score);
  const results: SearchResult[] = scored.slice(0, topK).map((s, i) => ({
    doc: s.doc, score: s.score, rank: i + 1,
    snippet: s.doc.content.slice(0, 120) + (s.doc.content.length > 120 ? "..." : "")
  }));
  const q: SearchQuery = { queryId: `sq-${++queryCounter}`, queryText, results, totalDocs: candidates.length, searchedAt: Date.now() };
  queryLog.push(q);
  return q;
}

export function getCorpusSize(): number { return corpus.length; }
export function getSearchQueryLog(): SearchQuery[] { return [...queryLog]; }
export function _resetSemanticSearchEngineForTest(): void { corpus.length = 0; queryLog.length = 0; docCounter = 0; queryCounter = 0; }
