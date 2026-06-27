/**
 * documentSearchEngine.ts — v82.0.0 "Document Intelligence"
 * Full-text search engine for documents with TF-IDF scoring and faceted filtering.
 */
export interface SearchableDocument {
  docId: string;
  title: string;
  content: string;
  author: string;
  tags: string[];
  format: string;
}

export interface DocumentSearchQuery {
  text: string;
  author?: string;
  tags?: string[];
  format?: string;
  limit?: number;
}

export interface DocumentSearchResult {
  docId: string;
  title: string;
  author: string;
  score: number;
  snippet: string;
  matchedTerms: string[];
}

const docStore = new Map<string, SearchableDocument>();
const invertedIndex = new Map<string, Set<string>>();

function tokenize(text: string): string[] {
  const stopWords = new Set(["the", "and", "for", "that", "this", "with", "from", "are", "was", "were", "have", "has"]);
  return text.toLowerCase().split(/\W+/).filter(w => w.length > 2 && !stopWords.has(w));
}

export function addToSearchIndex(doc: SearchableDocument): void {
  docStore.set(doc.docId, doc);
  const terms = tokenize(`${doc.title} ${doc.content} ${doc.tags.join(" ")}`);
  for (const term of terms) {
    if (!invertedIndex.has(term)) invertedIndex.set(term, new Set());
    invertedIndex.get(term)!.add(doc.docId);
  }
}

export function searchDocuments(query: DocumentSearchQuery): DocumentSearchResult[] {
  const queryTerms = tokenize(query.text);
  const docScores = new Map<string, { score: number; matched: string[] }>();

  for (const term of queryTerms) {
    const matchingDocs = invertedIndex.get(term) ?? new Set();
    const idf = matchingDocs.size > 0 ? Math.log(docStore.size / matchingDocs.size) + 1 : 0;

    for (const docId of matchingDocs) {
      const doc = docStore.get(docId)!;
      const tf = tokenize(`${doc.title} ${doc.content}`).filter(t => t === term).length;
      const tfidf = tf * idf;

      const existing = docScores.get(docId) ?? { score: 0, matched: [] };
      existing.score += tfidf;
      if (!existing.matched.includes(term)) existing.matched.push(term);
      docScores.set(docId, existing);
    }
  }

  let results: DocumentSearchResult[] = [];

  for (const [docId, { score, matched }] of docScores) {
    const doc = docStore.get(docId)!;
    if (query.author && doc.author !== query.author) continue;
    if (query.format && doc.format !== query.format) continue;
    if (query.tags && !query.tags.every(t => doc.tags.includes(t))) continue;

    const snippetStart = doc.content.toLowerCase().indexOf(queryTerms[0] ?? "");
    const snippet = snippetStart >= 0
      ? "..." + doc.content.slice(Math.max(0, snippetStart - 20), snippetStart + 100) + "..."
      : doc.content.slice(0, 120) + "...";

    results.push({ docId, title: doc.title, author: doc.author, score, snippet, matchedTerms: matched });
  }

  results.sort((a, b) => b.score - a.score);
  return query.limit ? results.slice(0, query.limit) : results;
}

export function getIndexedDocumentCount(): number { return docStore.size; }
export function _resetDocumentSearchEngineForTest(): void { docStore.clear(); invertedIndex.clear(); }
