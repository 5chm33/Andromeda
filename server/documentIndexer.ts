/**
 * documentIndexer.ts — v82.0.0 "Document Intelligence"
 * Indexes documents with metadata and full-text content for retrieval.
 */
export type DocumentFormat = "markdown" | "html" | "pdf" | "docx" | "txt" | "json";

export interface Document {
  docId: string;
  title: string;
  content: string;
  format: DocumentFormat;
  author: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  wordCount: number;
  metadata: Record<string, string>;
}

const store = new Map<string, Document>();
let docCounter = 0;

export function indexDocument(params: Omit<Document, "docId" | "createdAt" | "updatedAt" | "wordCount">): Document {
  const doc: Document = {
    ...params,
    docId: `doc-${++docCounter}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    wordCount: params.content.split(/\s+/).filter(Boolean).length,
  };
  store.set(doc.docId, doc);
  return doc;
}

export function updateDocument(docId: string, updates: Partial<Pick<Document, "title" | "content" | "tags" | "metadata">>): Document | null {
  const doc = store.get(docId);
  if (!doc) return null;
  if (updates.content) doc.wordCount = updates.content.split(/\s+/).filter(Boolean).length;
  Object.assign(doc, updates, { updatedAt: Date.now() });
  return doc;
}

export function getDocument(docId: string): Document | undefined { return store.get(docId); }
export function getAllDocuments(): Document[] { return [...store.values()]; }
export function getDocumentsByTag(tag: string): Document[] { return [...store.values()].filter(d => d.tags.includes(tag)); }
export function getDocumentsByAuthor(author: string): Document[] { return [...store.values()].filter(d => d.author === author); }
export function _resetDocumentIndexerForTest(): void { store.clear(); docCounter = 0; }
