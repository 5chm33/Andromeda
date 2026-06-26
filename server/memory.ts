/**
 * memory.ts — v5.1
 *
 * Persistent Long-Term Memory System for Andromeda.
 *
 * Architecture:
 * - Storage: JSON file in the workspace directory (no external DB required)
 * - Retrieval: Cosine similarity over TF-IDF vectors (no API calls for search)
 * - Embedding: Text is vectorized locally using a simple but effective TF-IDF
 *   approach. For production, swap vectorize() for an embedding API call.
 * - Memory Types:
 *   • "preference"       — coding style, language preferences, framework choices
 *   • "error"            — past errors and their fixes (prevents repeating mistakes)
 *   • "project"          — project architecture, file structure, tech decisions
 *   • "feedback"         — user corrections and feedback on AI responses
 *   • "fact"             — general facts the user has shared
 *   • "self_mod_success" — successful self-modification: what was changed and why (v5.75)
 *   • "self_mod_failure" — failed self-modification: root cause and what not to repeat (v5.75)
 *   • "path_correction"  — wrong file path and its correct equivalent (v5.75)
 *   • "tool_correction"  — wrong tool name and its correct equivalent (v5.75)
 *
 * API Endpoints:
 *   POST /api/memory/store   { content, type, tags? }
 *   POST /api/memory/search  { query, limit?, type? }
 *   GET  /api/memory/list    ?type=&limit=
 *   DELETE /api/memory/:id
 *   GET  /api/memory/stats
 *
 * The memory system is automatically injected into AI responses when relevant
 * memories are found for the current query (see injectMemoryContext()).
 */

import fs from "fs";
import path from "path";
import { getActiveProvider as _memGetProvider } from "./llmProvider.js";
import { fileURLToPath } from "url";
import { createLogger } from "./logger.js";
const log = createLogger("memory");

// v9.10.0: Neural embedding retrieval via vectorMemory.ts
// Lazy import to avoid circular deps and startup cost.
// Falls back to TF-IDF if vectorMemory is unavailable.
let _vectorStore: ((id: string, text: string) => Promise<void>) | null = null;
let _vectorSearch: ((query: string, limit?: number, minScore?: number) => Promise<Array<{ id: string; text: string; score: number }>>) | null = null;

async function getVectorOps(): Promise<{ store: typeof _vectorStore; search: typeof _vectorSearch }> {
  if (_vectorStore && _vectorSearch) return { store: _vectorStore, search: _vectorSearch };
  try {
    const vm = await import("./vectorMemory.js");
    _vectorStore = vm.vectorStore;
    _vectorSearch = vm.vectorSearch;
  } catch { /* vectorMemory not available — TF-IDF fallback */ }
  return { store: _vectorStore, search: _vectorSearch };
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type MemoryType =
  | "preference"        // coding style, language preferences, framework choices
  | "error"             // past errors and their fixes (prevents repeating mistakes)
  | "project"           // project architecture, file structure, tech decisions
  | "feedback"          // user corrections and feedback on AI responses
  | "fact"              // general facts the user has shared
  // v5.75: Structured episodic memory for self-modification outcomes
  | "self_mod_success"  // A self-modification that succeeded — what was changed and why
  | "self_mod_failure"  // A self-modification that failed — root cause and what NOT to repeat
  | "path_correction"   // A file path that was wrong and the correct path
  | "tool_correction";  // A tool name that was wrong and the correct name

export type MemoryEntry = {
  id: string;
  content: string;
  type: MemoryType;
  tags: string[];
  vector: number[];
  createdAt: number;
  updatedAt: number;
  accessCount: number;
  lastAccessedAt: number;
};

export type MemoryStore = {
  version: string;
  entries: MemoryEntry[];
};

export type SearchResult = {
  entry: MemoryEntry;
  score: number;
};

// ─── Storage ──────────────────────────────────────────────────────────────────

function getMemoryPath(): string {
  // Allow tests to override workspace dir via env var
  const workspaceDir = process.env.ANDROMEDA_WORKSPACE
    ? path.resolve(process.env.ANDROMEDA_WORKSPACE)
    : path.resolve(process.cwd(), "workspace");
  if (!fs.existsSync(workspaceDir)) {
    fs.mkdirSync(workspaceDir, { recursive: true });
  }
  return path.join(workspaceDir, ".andromeda_memory.json");
}

// v5.54: In-memory cache for loadStore — prevents repeated disk reads on every searchMemory call
let _storeCache: MemoryStore | null = null;
let _storeCacheTime = 0;
const STORE_CACHE_TTL_MS = 30_000; // 30 seconds

function loadStore(): MemoryStore {
  const now = Date.now();
  if (_storeCache && (now - _storeCacheTime) < STORE_CACHE_TTL_MS) {
    return _storeCache;
  }
  const memPath = getMemoryPath();
  if (!fs.existsSync(memPath)) {
    _storeCache = { version: "1.0", entries: [] };
    _storeCacheTime = now;
    return _storeCache;
  }
  try {
    const raw = fs.readFileSync(memPath, "utf-8");
    _storeCache = JSON.parse(raw) as MemoryStore;
    _storeCacheTime = now;
    return _storeCache;
  } catch {
    _storeCache = { version: "1.0", entries: [] };
    _storeCacheTime = now;
    return _storeCache;
  }
}

function saveStore(store: MemoryStore): void {
  const memPath = getMemoryPath();
  // v6.20: Atomic write — write to .tmp then rename to prevent corruption on crash
  const tmpPath = memPath + ".tmp";
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2), "utf-8");
    fs.renameSync(tmpPath, memPath);
  } catch (e) {
    // Clean up tmp file on failure
    try { fs.unlinkSync(tmpPath); } catch {}
    throw e;
  }
  // Invalidate cache on write so next read gets fresh data
  _storeCache = store;
  _storeCacheTime = Date.now();
}

// ─── TF-IDF Vectorizer ────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  "a", "an", "the", "is", "it", "in", "on", "at", "to", "for", "of", "and",
  "or", "but", "not", "with", "this", "that", "be", "are", "was", "were",
  "have", "has", "had", "do", "does", "did", "will", "would", "could", "should",
  "may", "might", "can", "i", "you", "he", "she", "we", "they", "my", "your",
  "his", "her", "its", "our", "their", "what", "which", "who", "when", "where",
  "how", "why", "if", "then", "than", "as", "by", "from", "up", "about",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s_.-]/g, " ")
    .split(/\s+/)
    .filter(t => t.length > 2 && !STOP_WORDS.has(t));
}

function buildVocabulary(texts: string[]): string[] {
  const vocab = new Set<string>();
  for (const text of texts) {
    for (const token of tokenize(text)) {
      vocab.add(token);
    }
  }
  return Array.from(vocab).sort();
}

// v9.8.5: Precomputed token sets for IDF calculation — avoids O(n²×vocab) tokenize() calls.
// Previously: 258 entries × 2000 vocab terms × 258 docs = 134M tokenize() calls per search.
// Now: 258 entries tokenized once upfront, IDF lookup is O(1) via Set.has().
function buildDocTokenSets(allTexts: string[]): Set<string>[] {
  return allTexts.map(t => new Set(tokenize(t)));
}

function tfidf(text: string, vocab: string[], allTexts: string[], docTokenSets?: Set<string>[]): number[] {
  const tokens = tokenize(text);
  const tf: Record<string, number> = {};
  for (const token of tokens) {
    tf[token] = (tf[token] ?? 0) + 1;
  }

  const N = allTexts.length + 1;
  // Use precomputed token sets if available, otherwise fall back to tokenize() per doc
  const sets = docTokenSets ?? buildDocTokenSets(allTexts);
  return vocab.map(term => {
    const termTf = (tf[term] ?? 0) / Math.max(tokens.length, 1);
    const docsWithTerm = sets.filter(s => s.has(term)).length + 1;
    const idf = Math.log(N / docsWithTerm);
    return termTf * idf;
  });
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ─── TF-IDF Vocabulary Cache (v6.00) ─────────────────────────────────────────
// Kimi audit: buildVocabulary was O(n*m) per search call. Now cached for 60s.
let _vocabCache: string[] | null = null;
let _vocabCacheSize = 0;
let _vocabCacheTime = 0;
const VOCAB_CACHE_TTL_MS = 60_000; // 60 seconds

function getCachedVocabulary(allTexts: string[]): string[] {
  const now = Date.now();
  if (
    !_vocabCache ||
    (now - _vocabCacheTime) > VOCAB_CACHE_TTL_MS ||
    Math.abs(_vocabCacheSize - allTexts.length) > 5
  ) {
    _vocabCache = buildVocabulary(allTexts);
    _vocabCacheSize = allTexts.length;
    _vocabCacheTime = now;
  }
  return _vocabCache;
}

function invalidateVocabCache(): void {
  _vocabCache = null;
  _vocabCacheTime = 0;
}

// ─── Simple vectorize using stored vocabulary ─────────────────────────────────

function vectorizeAgainstStore(text: string, store: MemoryStore): number[] {
  const allTexts = store.entries.map(e => e.content);
  if (allTexts.length === 0) return [];
  const vocab = getCachedVocabulary([text, ...allTexts]);
  return tfidf(text, vocab, allTexts);
}

function recomputeVectors(store: MemoryStore): void {
  const allTexts = store.entries.map(e => e.content);
  if (allTexts.length === 0) return;
  invalidateVocabCache(); // Force rebuild after store mutation
  const vocab = getCachedVocabulary(allTexts);
  for (const entry of store.entries) {
    entry.vector = tfidf(entry.content, vocab, allTexts.filter(t => t !== entry.content));
  }
}

/**
 * Incremental TF-IDF update — O(n) instead of O(n²) for adding a single entry.
 * Only recomputes the new entry's vector. For large stores (>50 entries),
 * existing vectors are left as-is since the IDF shift from one new doc is < 2%.
 * Falls back to full recompute when vocabulary changes (new terms introduced).
 */
function incrementalVectorUpdate(store: MemoryStore, newEntry: MemoryEntry): void {
  const allTexts = store.entries.map(e => e.content);
  if (allTexts.length === 0) return;

  const newTokens = tokenize(newEntry.content);
  const hasNewTerms = _vocabCache ? newTokens.some(t => !_vocabCache!.includes(t)) : true;

  // If new terms introduced (vocabulary changed) or store is small, do full recompute
  if (hasNewTerms || store.entries.length < 50) {
    recomputeVectors(store);
    return;
  }

  // Vocabulary unchanged & large store — only compute new entry's vector
  // IDF shift from adding 1 doc to N>50 docs is negligible (<2%)
  const vocab = _vocabCache!;
  newEntry.vector = tfidf(newEntry.content, vocab, allTexts.filter(t => t !== newEntry.content));
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function storeMemory(
  content: string,
  type: MemoryType,
  tags: string[] = []
): MemoryEntry {
  const store = loadStore();

  // Check for near-duplicate (>90% similarity) — update instead of duplicate
  if (store.entries.length > 0) {
    const queryVec = vectorizeAgainstStore(content, store);
    for (const entry of store.entries) {
      if (entry.vector.length === queryVec.length) {
        const sim = cosineSimilarity(queryVec, entry.vector);
        if (sim > 0.9) {
          entry.content = content;
          entry.tags = Array.from(new Set([...entry.tags, ...tags]));
          entry.updatedAt = Date.now();
          entry.accessCount++;
          recomputeVectors(store);
          saveStore(store);
          return entry;
        }
      }
    }
  }

  const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const newEntry: MemoryEntry = {
    id,
    content,
    type,
    tags,
    vector: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    accessCount: 0,
    lastAccessedAt: Date.now(),
  };

  store.entries.push(newEntry);

  // v6.03: Evict oldest low-access entries if store exceeds 2000 entries (OOM prevention)
  const MAX_MEMORY_ENTRIES = 2000;
  if (store.entries.length > MAX_MEMORY_ENTRIES) {
    // Sort by access count (ascending) then by createdAt (ascending) — evict least-used oldest
    store.entries.sort((a, b) => a.accessCount - b.accessCount || a.createdAt - b.createdAt);
    store.entries = store.entries.slice(store.entries.length - MAX_MEMORY_ENTRIES);
  }

  incrementalVectorUpdate(store, newEntry);
  saveStore(store);

  // v9.10.0: Also store in neural vector index (non-blocking, fire-and-forget)
  getVectorOps().then(({ store: vStore }) => {
    if (vStore) vStore(id, content).catch(() => { /* non-fatal */ });
  }).catch(() => { /* non-fatal */ });

  // v5.31: Auto-trigger memory consolidation when store grows large
  try {
    if (store.entries.length > 50 && store.entries.length % 10 === 0) {
      // Lazy import to avoid circular deps
      import("./memoryConsolidation").then(mc => {
        mc.trackMemory(newEntry.id, newEntry.content, newEntry.type, newEntry.createdAt);
        if (store.entries.length > 100) {
          mc.runConsolidation();
        }
      }).catch(() => { /* consolidation not available */ });
    }
  } catch (err) { log.caught("non-fatal", err); }

  return newEntry;
}

export function searchMemory(
  query: string,
  limit: number = 5,
  typeFilter?: MemoryType
): SearchResult[] {
  const store = loadStore();
  let entries = store.entries;

  if (typeFilter) {
    entries = entries.filter(e => e.type === typeFilter);
  }

  if (entries.length === 0) return [];

  // v9.8.5: Cap TF-IDF corpus at 100 most-recently-accessed entries to prevent O(n²) blocking.
  // With 258+ entries, the full TF-IDF takes minutes. Capping at 100 keeps it under 50ms.
  // We use the filtered entries (not all store.entries) so typeFilter is respected.
  const TFIDF_CORPUS_CAP = 100;
  const corpusEntries = entries.length > TFIDF_CORPUS_CAP
    ? [...entries].sort((a, b) => (b.lastAccessedAt || b.updatedAt) - (a.lastAccessedAt || a.updatedAt)).slice(0, TFIDF_CORPUS_CAP)
    : entries;
  const allTexts = corpusEntries.map(e => e.content);
  const vocab = getCachedVocabulary([query, ...allTexts]);
  const docTokenSets = buildDocTokenSets(allTexts);
  const queryVec = tfidf(query, vocab, allTexts, docTokenSets);

  const results: SearchResult[] = corpusEntries
    .map(entry => {
      const entryVec = tfidf(entry.content, vocab, allTexts, docTokenSets);
      const score = cosineSimilarity(queryVec, entryVec);
      return { entry, score };
    })
    .filter(r => r.score > 0.05)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  // Update access counts (non-blocking: skip saveStore to avoid 258-entry disk write on every search)
  for (const result of results) {
    result.entry.accessCount++;
    result.entry.lastAccessedAt = Date.now();
  }
  // Only persist if we actually found results (avoids unnecessary disk writes)
  if (results.length > 0) saveStore(store);

  return results;
}

export function listMemories(limit: number = 20, typeFilter?: MemoryType): MemoryEntry[] {
  const store = loadStore();
  let entries = store.entries;
  if (typeFilter) entries = entries.filter(e => e.type === typeFilter);
  return entries
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit);
}

export function deleteMemory(id: string): boolean {
  const store = loadStore();
  const before = store.entries.length;
  store.entries = store.entries.filter(e => e.id !== id);
  if (store.entries.length < before) {
    recomputeVectors(store);
    saveStore(store);
    return true;
  }
  return false;
}

export function getMemoryStats(): object {
  const store = loadStore();
  const byType: Record<string, number> = {};
  for (const entry of store.entries) {
    byType[entry.type] = (byType[entry.type] ?? 0) + 1;
  }
  return {
    total: store.entries.length,
    byType,
    oldestEntry: store.entries.length > 0
      ? new Date(Math.min(...store.entries.map(e => e.createdAt))).toISOString()
      : null,
    newestEntry: store.entries.length > 0
      ? new Date(Math.max(...store.entries.map(e => e.updatedAt))).toISOString()
      : null,
    mostAccessed: store.entries
      .sort((a, b) => b.accessCount - a.accessCount)
      .slice(0, 3)
      .map(e => ({ id: e.id, type: e.type, accessCount: e.accessCount, preview: e.content.slice(0, 80) })),
  };
}

/**
 * injectMemoryContext — called before AI responses to inject relevant memories.
 * Returns a formatted string to prepend to the system prompt when memories exist.
 */
export async function injectMemoryContextAsync(query: string): Promise<string> {
  if (!query) return "";
  // v9.10.0: Try neural vector search first (higher quality retrieval)
  try {
    const { search: vSearch } = await getVectorOps();
    if (vSearch) {
      const vectorResults = await vSearch(query, 5, 0.25);
      if (vectorResults.length > 0) {
        const store = loadStore();
        const entryMap = new Map(store.entries.map(e => [e.id, e]));
        const sections: Record<string, string[]> = {};
        for (const { id, text, score } of vectorResults) {
          if (score < 0.25) continue;
          const entry = entryMap.get(id);
          if (!entry) continue;
          const type = entry.type ?? "fact";
          if (!sections[type]) sections[type] = [];
          sections[type].push(entry.content ?? text);
        }
        if (Object.keys(sections).length > 0) {
          const typeLabels: Record<string, string> = {
            preference: "User Preferences & Coding Style",
            error: "Past Errors & Fixes",
            project: "Project Context",
            feedback: "User Feedback",
            fact: "Known Facts",
          };
          const lines = [
            "## Relevant Memory Context (neural retrieval)",
            "The following information has been retrieved from long-term memory using semantic similarity.",
            "",
          ];
          for (const [type, contents] of Object.entries(sections)) {
            lines.push(`### ${typeLabels[type] ?? type}`);
            for (const content of contents) lines.push(`- ${content}`);
            lines.push("");
          }
          return lines.join("\n");
        }
      }
    }
  } catch { /* fall through to TF-IDF */ }
  // Fallback: TF-IDF retrieval
  return injectMemoryContext(query);
}

export function injectMemoryContext(query: string): string {
  if (!query) return "";
  const results = searchMemory(query, 5);
  if (results.length === 0) return "";

  const sections: Record<string, string[]> = {};
  for (const { entry, score } of results) {
    if (score < 0.1) continue;
    if (!sections[entry.type]) sections[entry.type] = [];
    sections[entry.type].push(entry.content);
  }

  if (Object.keys(sections).length === 0) return "";

  const lines: string[] = [
    "## Relevant Memory Context",
    "The following information has been retrieved from long-term memory based on the current query.",
    "Use this context to provide more personalized and consistent responses.",
    "",
  ];

  const typeLabels: Record<string, string> = {
    preference: "User Preferences & Coding Style",
    error: "Past Errors & Fixes",
    project: "Project Context",
    feedback: "User Feedback",
    fact: "Known Facts",
  };

  for (const [type, contents] of Object.entries(sections)) {
    lines.push(`### ${typeLabels[type] ?? type}`);
    for (const content of contents) {
      lines.push(`- ${content}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * autoExtractMemories — called after AI responses to automatically extract
 * and store useful information from the conversation.
 */
export async function autoExtractMemories(
  userQuery: string,
  aiResponse: string,
  apiKey: string
): Promise<MemoryEntry[]> {
  if (!apiKey) return [];

  try {
    const response = await fetch((() => { try { return _memGetProvider().apiUrl; } catch { return "https://api.deepseek.com/v1/chat/completions"; } })(), {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.LLM_DEFAULT_MODEL || "deepseek/deepseek-chat",
        messages: [
          {
            role: "system",
            content: `You are a memory extraction system. Analyze a user query and AI response and extract any information worth remembering for future sessions.

Extract memories in this JSON format:
{
  "memories": [
    {
      "content": "concise factual statement to remember",
      "type": "preference|error|project|feedback|fact",
      "tags": ["tag1", "tag2"]
    }
  ]
}

Only extract information that is:
- Specific and factual (not generic)
- Likely to be useful in future conversations
- About user preferences, project details, errors/fixes, or explicit feedback

Return empty memories array if nothing worth storing. Return ONLY valid JSON.`,
          },
          {
            role: "user",
            content: `USER QUERY: ${userQuery}\n\nAI RESPONSE: ${aiResponse.slice(0, 2000)}`,
          },
        ],
        max_tokens: 500,
        temperature: 0.2,
      }),
    });

    if (!response.ok) return [];

    const data = await response.json() as any;
    const content = data?.choices?.[0]?.message?.content?.trim() ?? "{}";

    // Strip markdown code blocks if present
    const jsonStr = content.replace(/^```json?\n?/, "").replace(/\n?```$/, "");
    let parsed: { memories: Array<{ content: string; type: MemoryType; tags: string[] }> } | null;
    try { parsed = JSON.parse(jsonStr) as { memories: Array<{ content: string; type: MemoryType; tags: string[] }> }; } catch { parsed = null; }
    if (!parsed) return [];

    const stored: MemoryEntry[] = [];
    for (const mem of parsed.memories ?? []) {
      if (mem.content && mem.type) {
        stored.push(storeMemory(mem.content, mem.type, mem.tags ?? []));
      }
    }
    return stored;
  } catch {
    return [];
  }
}

// ─── v5.68: Memory Auto-Seeding ───────────────────────────────────────────────
// Seeds foundational architectural knowledge on first boot (when 0 memories exist).
// This gives the self-improvement loop a knowledge base to start from immediately,
// rather than starting completely blind.

const SEED_MEMORIES: Array<{ content: string; type: MemoryType; tags: string[] }> = [
  {
    content: "Andromeda's self-modification pipeline: detect issue → search memory for past fixes → generate proposal → constitution check → git snapshot → apply → TypeScript check → hot-reload → log outcome → monitor again. Always use self_patch_file for targeted edits to existing files; only use self_write_file for new files or complete rewrites.",
    type: "project",
    tags: ["self-modification", "architecture", "pipeline"],
  },
  {
    content: "Truncation fix (v5.68+): streaming max_tokens raised from 4096 to 32768. Syntax-aware truncation detection added in v5.68 — checks unclosed code fences, unbalanced braces, truncated JSON. Continuation prompt now includes last 200 chars of cut-off content for precise resumption.",
    type: "error",
    tags: ["truncation", "streaming", "max_tokens", "fix"],
  },
  {
    content: "self_patch_file tool (v5.68+): preferred over self_write_file for modifying existing files. Takes original_snippet + proposed_snippet. Verifies original exists verbatim before applying. Creates .bak backup. Avoids token-limit truncation by only generating changed lines.",
    type: "project",
    tags: ["self_patch_file", "self-modification", "tools"],
  },
  {
    content: "Memory system architecture: TF-IDF vectorization with cosine similarity for search. Hybrid search: 70% semantic + 30% keyword. Memory types: preference, error, project, feedback, fact. Store is a JSON file at workspace/.andromeda_memory.json. Auto-consolidation triggers at 50+ entries.",
    type: "project",
    tags: ["memory", "architecture", "search"],
  },
  {
    content: "Self-review gate (v5.68+): selfReview.ts reviewAndGate() is now called before writing in both self_write_file and self_patch_file. Gate threshold: 60/100. Auto-fix is enabled. If score < 60, the write is blocked and issues are reported. This prevents low-quality self-modifications.",
    type: "project",
    tags: ["self-review", "quality-gate", "self-modification"],
  },
  {
    content: "ContinuousImprover runs every 30 minutes. Auto-apply threshold: 75 confidence. RecursionGuard limits self-modification to 20/hour, depth 5. SelfHeal auto-reverts bad changes on boot. AutonomyOrchestrator coordinates all subsystems to prevent conflicts.",
    type: "project",
    tags: ["ContinuousImprover", "autonomy", "daemons", "limits"],
  },
  {
    content: "Forbidden files that can never be modified by self_write_file or self_patch_file: andromeda-constitution.json, server/selfImproveGuard.ts, server/recursionGuard.ts, server/selfRollback.ts, server/selfRollback.ts, server/tools/selfModifyTools.ts.",
    type: "project",
    tags: ["forbidden", "safety", "self-modification"],
  },
  {
    content: "Key server files: reactEngine.ts (agent loop, system prompt), ai.ts (streaming/continuation), llmProvider.ts (LLM calls), selfModifyTools.ts (self-write/patch/test/restart tools), selfReview.ts (code quality gate), memory.ts (persistent memory), selfImprove.ts (proposal generation), manifest.ts (system manifest).",
    type: "project",
    tags: ["file-map", "architecture", "server"],
  },
  {
    content: "Autocomplete fix (v5.55+): server returns HTTP 200 with empty results for prefixes shorter than 2 chars instead of 400. Frontend debounce added in v5.56: autocomplete query fires 300ms after user stops typing.",
    type: "error",
    tags: ["autocomplete", "400-error", "debounce", "fix"],
  },
  {
    content: "Prompt box clear fix (v5.56+): useEffect in Search.tsx resets textarea height to 'auto' when inputValue becomes empty. This fixes the visual bug where the input box didn't shrink after submitting a query.",
    type: "error",
    tags: ["prompt-box", "textarea", "height", "fix"],
  },
];

/**
 * Seeds foundational memories on first boot if the memory store is empty.
 * Called from server startup. Safe to call multiple times — only seeds if count is 0.
 */
export function seedInitialMemoriesIfEmpty(): void {
  const store = loadStore();
  if (store.entries.length > 0) return; // Already has memories — don't overwrite

  for (const seed of SEED_MEMORIES) {
    storeMemory(seed.content, seed.type, seed.tags);
  }
}

