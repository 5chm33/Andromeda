/**
 * apiKnowledgeBase.ts — v54.0.0
 *
 * Stores and retrieves structured knowledge about APIs: documentation
 * snippets, usage patterns, known issues, and best practices.
 */

export interface KnowledgeEntry {
  entryId: string;
  apiId: string;
  category: "documentation" | "pattern" | "issue" | "best-practice" | "example";
  title: string;
  content: string;
  tags: string[];
  confidence: number;  // 0.0–1.0
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeSearchResult {
  entry: KnowledgeEntry;
  relevanceScore: number;
}

const entries = new Map<string, KnowledgeEntry>();
let entryCounter = 0;

export function addKnowledge(apiId: string, category: KnowledgeEntry["category"], title: string, content: string, tags: string[] = [], confidence = 0.9): KnowledgeEntry {
  const entry: KnowledgeEntry = {
    entryId: `kb-${++entryCounter}`,
    apiId,
    category,
    title,
    content,
    tags,
    confidence,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  entries.set(entry.entryId, entry);
  return entry;
}

export function searchKnowledge(query: string, apiId?: string): KnowledgeSearchResult[] {
  const queryLower = query.toLowerCase();
  const results: KnowledgeSearchResult[] = [];

  for (const entry of entries.values()) {
    if (apiId && entry.apiId !== apiId) continue;

    const titleMatch = entry.title.toLowerCase().includes(queryLower) ? 0.5 : 0;
    const contentMatch = entry.content.toLowerCase().includes(queryLower) ? 0.3 : 0;
    const tagMatch = entry.tags.some(t => t.toLowerCase().includes(queryLower)) ? 0.2 : 0;
    const relevanceScore = (titleMatch + contentMatch + tagMatch) * entry.confidence;

    if (relevanceScore > 0) {
      results.push({ entry, relevanceScore });
    }
  }

  return results.sort((a, b) => b.relevanceScore - a.relevanceScore);
}

export function getKnowledgeByCategory(apiId: string, category: KnowledgeEntry["category"]): KnowledgeEntry[] {
  return Array.from(entries.values()).filter(e => e.apiId === apiId && e.category === category);
}

export function updateKnowledge(entryId: string, updates: Partial<Pick<KnowledgeEntry, "content" | "tags" | "confidence">>): boolean {
  const entry = entries.get(entryId);
  if (!entry) return false;
  Object.assign(entry, updates, { updatedAt: Date.now() });
  return true;
}

export function _resetKnowledgeBaseForTest(): void {
  entries.clear();
  entryCounter = 0;
}
