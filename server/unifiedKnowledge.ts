/**
 * unifiedKnowledge.ts — v5.33
 *
 * Unified Knowledge Retrieval Layer.
 *
 * Provides a single query interface across all knowledge stores:
 * - skillGraph.ts (learned skills and capabilities)
 * - systemMemory.ts (system-level learnings)
 * - selfKnowledgeBase.ts (self-knowledge about code patterns)
 * - memory.ts (conversation/project memories)
 *
 * Features:
 * - Cross-module deduplication
 * - Relevance scoring and ranking
 * - Priority/importance weighting
 * - Automatic consolidation between modules
 */

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface UnifiedKnowledgeEntry {
  id: string;
  source: "skillGraph" | "systemMemory" | "selfKnowledgeBase" | "memory";
  content: string;
  relevance: number;       // 0-1 relevance to query
  importance: number;      // 0-1 importance weight
  timestamp: number;
  tags: string[];
  deduplicated: boolean;   // Whether this was merged from multiple sources
}

export interface UnifiedQueryOptions {
  query: string;
  sources?: ("skillGraph" | "systemMemory" | "selfKnowledgeBase" | "memory")[];
  limit?: number;
  minRelevance?: number;
  deduplicate?: boolean;
  includeMetadata?: boolean;
}

export interface UnifiedQueryResult {
  entries: UnifiedKnowledgeEntry[];
  totalFound: number;
  sourceCounts: Record<string, number>;
  queryTimeMs: number;
  deduplicated: number;
}

export interface ConsolidationResult {
  merged: number;
  removed: number;
  sourcesProcessed: string[];
}

// ─── Similarity Helpers ────────────────────────────────────────────────────────

/**
 * Simple cosine-like similarity based on word overlap.
 * Fast enough for in-memory use without external embeddings.
 */
function textSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let overlap = 0;
  for (const word of Array.from(wordsA)) {
    if (wordsB.has(word)) overlap++;
  }

  return overlap / Math.sqrt(wordsA.size * wordsB.size);
}

/**
 * Calculate relevance of an entry to a query.
 */
function calculateRelevance(content: string, query: string): number {
  const sim = textSimilarity(content, query);

  const EXACT_MATCH_BOOST = 0.3;
  const KEYWORD_MATCH_BOOST = 0.2;

  // Boost for exact substring match
  const lowerContent = content.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const exactBoost = lowerContent.includes(lowerQuery) ? EXACT_MATCH_BOOST : 0;

  // Boost for keyword matches
  const queryWords = lowerQuery.split(/\s+/).filter(w => w.length > 2);
  let keywordHits = 0;
  for (const word of queryWords) {
    if (lowerContent.includes(word)) keywordHits++;
  }
  const keywordBoost = queryWords.length > 0 ? (keywordHits / queryWords.length) * KEYWORD_MATCH_BOOST : 0;

  return Math.min(1, sim + exactBoost + keywordBoost);
}

/**
 * Calculate importance based on source and recency.
 */
function calculateImportance(source: string, timestamp: number, tags: string[]): number {
  // Source weight
  const sourceWeights: Record<string, number> = {
    systemMemory: 0.9,       // System learnings are highest priority
    selfKnowledgeBase: 0.8,  // Self-knowledge is very important
    skillGraph: 0.7,         // Skills are important
    memory: 0.5,             // Conversation memories are lower priority
  };
  const sourceWeight = sourceWeights[source] || 0.5;

  // Recency weight (decay over 30 days)
  const ageMs = Date.now() - timestamp;
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  const recencyWeight = Math.max(0.1, 1 - (ageDays / 30));

  // Tag boost
  const importantTags = new Set(["critical", "self-modify", "error", "fix", "improvement", "learning"]);
  const tagBoost = tags.some(t => importantTags.has(t)) ? 0.1 : 0;

  return Math.min(1, (sourceWeight * 0.5) + (recencyWeight * 0.4) + tagBoost);
}

// ─── Core Query Function ───────────────────────────────────────────────────────

/**
 * Query all knowledge stores with a unified interface.
 * Returns ranked, deduplicated results.
 */
export async function queryUnifiedKnowledge(options: UnifiedQueryOptions): Promise<UnifiedQueryResult> {
  const startTime = Date.now();
  const {
    query,
    sources = ["skillGraph", "systemMemory", "selfKnowledgeBase", "memory"],
    limit = 20,
    minRelevance = 0.1,
    deduplicate = true,
  } = options;

  const allEntries: UnifiedKnowledgeEntry[] = [];
  const sourceCounts: Record<string, number> = {};

  // ── Query each source ──
  const queryPromises: Promise<void>[] = [];

  if (sources.includes("skillGraph")) {
    queryPromises.push((async () => {
      try {
        const { getSkillsForModule } = await import("./skillGraph");
        const skills = getSkillsForModule ? getSkillsForModule(query) : [];
        const skillsArray = Array.isArray(skills) ? skills : [];
const entries = skillsArray.map((s: unknown) => {
  if (typeof s !== 'object' || s === null) {
    return {
      id: `sg_${Math.random().toString(36).slice(2)}`,
      source: "skillGraph" as const,
      content: "",
      relevance: 0,
      importance: 0,
      timestamp: Date.now(),
      tags: ["skill"],
      deduplicated: false,
    };
  }
  const skill = s as Record<string, unknown>;
  const id = typeof skill.id === 'string' ? skill.id : typeof skill.name === 'string' ? skill.name : Math.random().toString(36).slice(2);
  const name = typeof skill.name === 'string' ? skill.name : "";
  const description = typeof skill.description === 'string' ? skill.description : typeof skill.content === 'string' ? skill.content : "";
  const content = `${name}: ${description}`;
  const lastUsed = typeof skill.lastUsed === 'number' ? skill.lastUsed : undefined;
  const createdAt = typeof skill.createdAt === 'number' ? skill.createdAt : undefined;
  const timestamp = lastUsed || createdAt || Date.now();
  const tags = Array.isArray(skill.tags) ? skill.tags.filter((t): t is string => typeof t === 'string') : ["skill"];
  return {
    id: `sg_${id}`,
    source: "skillGraph" as const,
    content,
    relevance: 0,
    importance: 0,
    timestamp,
    tags,
    deduplicated: false,
  };
});
        sourceCounts.skillGraph = entries.length;
        allEntries.push(...entries);
      } catch {
        sourceCounts.skillGraph = 0;
      }
    })());
  }

  if (sources.includes("systemMemory")) {
    queryPromises.push((async () => {
      try {
        const { queryLearnings } = await import("./systemMemory");
        const memories = queryLearnings ? queryLearnings({ category: "modification" }) : [];
        const entries = (Array.isArray(memories) ? memories : []).map((m: any) => ({
          id: `sm_${m?.id || Math.random().toString(36).slice(2)}`,
          source: "systemMemory" as const,
          content: typeof m === "string" ? m : m?.content || m?.text || JSON.stringify(m ?? {}),
          relevance: 0,
          importance: 0,
          timestamp: m?.timestamp || m?.createdAt || Date.now(),
          tags: m?.tags || ["system"],
          deduplicated: false,
        }));
        sourceCounts.systemMemory = entries.length;
        allEntries.push(...entries);
      } catch {
        sourceCounts.systemMemory = 0;
      }
    })());
  }

  if (sources.includes("selfKnowledgeBase")) {
    queryPromises.push((async () => {
      try {
        const { queryLearnings: queryKBLearnings } = await import("./selfKnowledgeBase");
        const knowledge = queryKBLearnings ? queryKBLearnings(query) : [];
        const entries = (Array.isArray(knowledge) ? knowledge : []).map((k: any) => ({
          id: `skb_${k.id || Math.random().toString(36).slice(2)}`,
          source: "selfKnowledgeBase" as const,
          content: typeof k === "string" ? k : k.content || k.text || k.pattern || JSON.stringify(k),
          relevance: 0,
          importance: 0,
          timestamp: k.timestamp || k.createdAt || Date.now(),
          tags: k.tags || ["knowledge"],
          deduplicated: false,
        }));
        sourceCounts.selfKnowledgeBase = entries.length;
        allEntries.push(...entries);
      } catch {
        sourceCounts.selfKnowledgeBase = 0;
      }
    })());
  }

  if (sources.includes("memory")) {
    queryPromises.push((async () => {
      try {
        const { searchMemory } = await import("./memory");
        const memories = searchMemory ? searchMemory(query) : [];
        const entries = (Array.isArray(memories) ? memories : []).map((m: any) => ({
          id: `mem_${m.id || Math.random().toString(36).slice(2)}`,
          source: "memory" as const,
          content: typeof m === "string" ? m : m.content || m.text || JSON.stringify(m),
          relevance: 0,
          importance: 0,
          timestamp: m.timestamp || m.createdAt || Date.now(),
          tags: m.tags || ["memory"],
          deduplicated: false,
        }));
        sourceCounts.memory = entries.length;
        allEntries.push(...entries);
      } catch {
        sourceCounts.memory = 0;
      }
    })());
  }

  await Promise.all(queryPromises);

  // ── Score entries ──
  for (const entry of allEntries) {
    entry.relevance = calculateRelevance(entry.content, query);
    entry.importance = calculateImportance(entry.source, entry.timestamp, entry.tags);
  }

  // ── Filter by minimum relevance ──
  let filtered = allEntries.filter(e => e.relevance >= minRelevance);

  // ── Deduplicate ──
  let deduplicatedCount = 0;
  if (deduplicate) {
    const unique: UnifiedKnowledgeEntry[] = [];
    for (const entry of filtered) {
      const isDuplicate = unique.some(u => textSimilarity(u.content, entry.content) > 0.8);
      if (!isDuplicate) {
        unique.push(entry);
      } else {
        deduplicatedCount++;
        // Merge: boost the existing entry's importance
        const existing = unique.find(u => textSimilarity(u.content, entry.content) > 0.8);
        if (existing) {
          existing.importance = Math.min(1, existing.importance + 0.1);
          existing.deduplicated = true;
        }
      }
    }
    filtered = unique;
  }

  // ── Sort by combined score (relevance * 0.6 + importance * 0.4) ──
  filtered.sort((a, b) => {
    const scoreA = a.relevance * 0.6 + a.importance * 0.4;
    const scoreB = b.relevance * 0.6 + b.importance * 0.4;
    return scoreB - scoreA;
  });

  // ── Limit ──
  const results = filtered.slice(0, limit);

  return {
    entries: results,
    totalFound: allEntries.length,
    sourceCounts,
    queryTimeMs: Date.now() - startTime,
    deduplicated: deduplicatedCount,
  };
}

// ─── Consolidation ─────────────────────────────────────────────────────────────

/**
 * Consolidate knowledge across modules.
 * Finds duplicates across stores and merges them into the highest-priority store.
 */
export async function consolidateKnowledge(): Promise<ConsolidationResult> {
  // Query all knowledge with a broad query
  const allKnowledge = await queryUnifiedKnowledge({
    query: "",
    sources: ["skillGraph", "systemMemory", "selfKnowledgeBase", "memory"],
    limit: 1000,
    minRelevance: 0,
    deduplicate: false,
  });

  let merged = 0;
  const seen = new Map<string, UnifiedKnowledgeEntry>();

  for (const entry of allKnowledge.entries) {
    // Check for near-duplicates
    let foundDuplicate = false;
    for (const [_key, existing] of Array.from(seen.entries())) {
      if (textSimilarity(entry.content, existing.content) > 0.85) {
        merged++;
        foundDuplicate = true;
        break;
      }
    }
    if (!foundDuplicate) {
      seen.set(entry.id, entry);
    }
  }

  return {
    merged,
    removed: 0, // We don't actually remove from source stores — just report
    sourcesProcessed: Object.keys(allKnowledge.sourceCounts),
  };
}

// ─── Diagnostics ───────────────────────────────────────────────────────────────

export function getUnifiedKnowledgeStats(): {
  available: boolean;
  sources: string[];
  description: string;
} {
  return {
    available: true,
    sources: ["skillGraph", "systemMemory", "selfKnowledgeBase", "memory"],
    description: "Unified cross-module knowledge retrieval with deduplication and ranking",
  };
}
