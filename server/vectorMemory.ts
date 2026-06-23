/**
 * vectorMemory.ts — Embedding-Based Semantic Memory
 * Andromeda v5.5
 *
 * Upgrades the existing TF-IDF memory search to use real embedding vectors
 * from the active LLM provider (or a dedicated embedding model). Falls back
 * to a local lightweight embedding when no API is available.
 *
 * Architecture:
 *  - Stores embeddings alongside memory entries in a JSON file
 *  - Uses cosine similarity for semantic search
 *  - Supports batch embedding for efficiency
 *  - Falls back to local hash-based embeddings when offline
 *
 * This module augments (not replaces) the existing memory.ts system.
 * It adds a vector index layer on top of the existing keyword store.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface EmbeddingEntry {
  id: string;               // matches MemoryEntry.id
  vector: number[];         // embedding vector
  text: string;             // original text (for re-embedding)
  model: string;            // which model produced this embedding
  createdAt: number;
}

export interface VectorStore {
  version: number;
  dimension: number;
  model: string;
  entries: EmbeddingEntry[];
}

// v6.02: Memory management — cap entries and prune stale ones
const MAX_VECTOR_ENTRIES = 5000;
const VECTOR_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function pruneVectorStore(store: VectorStore): void {
  const now = Date.now();
  // Remove entries older than TTL
  store.entries = store.entries.filter(e => (now - e.createdAt) < VECTOR_TTL_MS);
  // If still over cap, remove oldest entries
  if (store.entries.length > MAX_VECTOR_ENTRIES) {
    store.entries.sort((a, b) => b.createdAt - a.createdAt);
    store.entries = store.entries.slice(0, MAX_VECTOR_ENTRIES);
  }
}

export interface VectorSearchResult {
  id: string;
  text: string;
  score: number;            // cosine similarity 0-1
  metadata?: Record<string, string | number | boolean>;
}

export interface EmbeddingProvider {
  id: string;
  embed: (texts: string[]) => Promise<number[][]>;
  dimension: number;
}

// ─── Vector Store Persistence ───────────────────────────────────────────────

const DATA_DIR = process.env.ANDROMEDA_WORKSPACE ? join(process.env.ANDROMEDA_WORKSPACE, "data") : join(process.cwd(), "data");
const VECTOR_STORE_PATH = join(DATA_DIR, "vector_memory.json");

function loadVectorStore(): VectorStore {
  if (!existsSync(VECTOR_STORE_PATH)) {
    return { version: 1, dimension: 384, model: "local-hash", entries: [] };
  }
  try {
    const raw = readFileSync(VECTOR_STORE_PATH, "utf-8");
    return JSON.parse(raw) as VectorStore;
  } catch {
    return { version: 1, dimension: 384, model: "local-hash", entries: [] };
  }
}

function saveVectorStore(store: VectorStore): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  writeFileSync(VECTOR_STORE_PATH, JSON.stringify(store, null, 2), "utf-8");
}

// ─── Local Hash Embedding (Fallback) ────────────────────────────────────────
// A deterministic pseudo-embedding using character n-gram hashing.
// Not as good as real embeddings but works offline and is consistent.

const LOCAL_DIMENSION = 384;

function localEmbed(text: string): number[] {
  const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  const vector = new Float64Array(LOCAL_DIMENSION).fill(0);

  // Character trigram hashing
  for (let i = 0; i < normalized.length - 2; i++) {
    const trigram = normalized.slice(i, i + 3);
    const hash = createHash("md5").update(trigram).digest();
    const idx = hash.readUInt16BE(0) % LOCAL_DIMENSION;
    const sign = (hash[2] & 1) === 0 ? 1 : -1;
    vector[idx] += sign * (1.0 / Math.sqrt(normalized.length));
  }

  // Word-level hashing for semantic signal
  const words = normalized.split(/\s+/).filter(w => w.length > 2);
  for (const word of words) {
    const hash = createHash("sha256").update(word).digest();
    const idx1 = hash.readUInt16BE(0) % LOCAL_DIMENSION;
    const idx2 = hash.readUInt16BE(2) % LOCAL_DIMENSION;
    vector[idx1] += 0.5 / Math.sqrt(words.length);
    vector[idx2] -= 0.3 / Math.sqrt(words.length);
  }

  // L2 normalize
  const norm = Math.sqrt(Array.from(vector).reduce((s, v) => s + v * v, 0));
  if (norm > 0) {
    for (let i = 0; i < LOCAL_DIMENSION; i++) {
      vector[i] /= norm;
    }
  }

  return Array.from(vector);
}

function localEmbedBatch(texts: string[]): number[][] {
  return texts.map(localEmbed);
}

// ─── API-Based Embedding ────────────────────────────────────────────────────

async function apiEmbed(texts: string[], apiUrl: string, apiKey: string, model: string): Promise<number[][]> {
  // v6.18: apiUrl should already be the embeddings endpoint (fixed in initModules.ts)
  // Keep the replace as a safety net for any legacy callers
  // v11.1: Guard against undefined apiUrl (e.g. CI environment without OPENAI_API_BASE set)
  if (!apiUrl || typeof apiUrl !== 'string') {
    throw new Error(`apiEmbed: apiUrl is ${apiUrl} — OPENAI_API_BASE may not be set`);
  }
  const url = apiUrl.endsWith("/embeddings") ? apiUrl : apiUrl.replace(/\/chat\/completions$/, "/embeddings");

  // v9.11.0: Add HTTP-Referer and X-Title headers required by OpenRouter for non-OpenAI endpoints.
  // Without these, OpenRouter returns 401 Unauthorized for embedding requests.
  const isOpenRouter = url.includes("openrouter.ai");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...(isOpenRouter ? {
        "HTTP-Referer": `http://localhost:${process.env.PORT ?? 3000}`,
        "X-Title": "Andromeda AI",
      } : {}),
    },
    body: JSON.stringify({
      input: texts,
      model: model,
    }),
  });

  if (!response.ok) {
    throw new Error(`Embedding API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as {
    data: Array<{ embedding: number[]; index: number }>;
  };

  // Sort by index to maintain order
  return data.data
    .sort((a, b) => a.index - b.index)
    .map(d => d.embedding);
}

// ─── Embedding Provider Registry ────────────────────────────────────────────

const embeddingProviders: Map<string, EmbeddingProvider> = new Map();

// Register the local fallback
embeddingProviders.set("local-hash", {
  id: "local-hash",
  embed: async (texts) => localEmbedBatch(texts),
  dimension: LOCAL_DIMENSION,
});

let activeEmbeddingProvider = "local-hash";

export function registerEmbeddingProvider(provider: EmbeddingProvider): void {
  embeddingProviders.set(provider.id, provider);
}

export function setEmbeddingProvider(id: string): void {
  if (!embeddingProviders.has(id)) {
    throw new Error(`Unknown embedding provider: ${id}`);
  }
  activeEmbeddingProvider = id;
}

export function getEmbeddingProvider(): string {
  return activeEmbeddingProvider;
}

/**
 * Initialize an API-based embedding provider from the LLM config.
 * Call this when the app starts or when the LLM provider changes.
 */
export function initApiEmbeddings(apiUrl: string, apiKey: string, model?: string): void {
  const embModel = model ?? "text-embedding-3-small";
  const API_DIMENSION = 1536; // OpenAI default; adjust for other providers
  registerEmbeddingProvider({
    id: "api",
    dimension: API_DIMENSION,
    embed: async (texts) => apiEmbed(texts, apiUrl, apiKey, embModel),
  });
  activeEmbeddingProvider = "api";
}

// ─── Core Functions ─────────────────────────────────────────────────────────

async function getEmbeddings(texts: string[]): Promise<number[][]> {
  const provider = embeddingProviders.get(activeEmbeddingProvider);
  if (!provider) {
    // Fallback to local
    return localEmbedBatch(texts);
  }
  try {
    return await provider.embed(texts);
  } catch (err) {
    console.warn(`[VectorMemory] Embedding API failed, falling back to local:`, err);
    return localEmbedBatch(texts);
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    // Dimension mismatch — use the shorter length
    const len = Math.min(a.length, b.length);
    a = a.slice(0, len);
    b = b.slice(0, len);
  }

  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Add a text entry to the vector store.
 */
export async function vectorStore(id: string, text: string): Promise<void> {
  await vectorStoreBatch([{ id, text }]);
}

/**
 * Batch-add multiple entries to the vector store.
 */
export async function vectorStoreBatch(entries: Array<{ id: string; text: string }>): Promise<void> {
  // Guard against non-array inputs (e.g. {} passed in tests or by RSI proposals)
  if (!Array.isArray(entries)) return;
  if (entries.length === 0) return;

  const store = loadVectorStore();
  const texts = entries.map(e => e.text);
  const vectors = await getEmbeddings(texts);

  for (let i = 0; i < entries.length; i++) {
    // Remove existing
    store.entries = store.entries.filter(e => e.id !== entries[i].id);
    store.entries.push({
      id: entries[i].id,
      vector: vectors[i],
      text: entries[i].text,
      model: activeEmbeddingProvider,
      createdAt: Date.now(),
    });
  }

  if (vectors.length > 0) {
    store.dimension = vectors[0].length;
  }
  store.model = activeEmbeddingProvider;
  pruneVectorStore(store); // v6.02: cap + TTL prune
  saveVectorStore(store);
}

/**
 * Semantic search: find the most similar entries to a query.
 */
export async function vectorSearch(query: string, limit = 5, minScore = 0.3): Promise<VectorSearchResult[]> {
  const store = loadVectorStore();
  if (store.entries.length === 0) return [];

  const [queryVector] = await getEmbeddings([query]);

  const results: VectorSearchResult[] = store.entries
    .map(entry => ({
      id: entry.id,
      text: entry.text,
      score: cosineSimilarity(queryVector, entry.vector),
    }))
    .filter(r => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return results;
}

/**
 * Remove an entry from the vector store.
 */
export function vectorDelete(id: string): boolean {
  const store = loadVectorStore();
  const before = store.entries.length;
  store.entries = store.entries.filter(e => e.id !== id);
  if (store.entries.length < before) {
    saveVectorStore(store);
    return true;
  }
  return false;
}

/**
 * Re-embed all entries (useful when switching embedding providers).
 */
export async function vectorReindex(): Promise<{ count: number; model: string }> {
  const store = loadVectorStore();
  if (store.entries.length === 0) return { count: 0, model: activeEmbeddingProvider };

  const texts = store.entries.map(e => e.text);
  const vectors = await getEmbeddings(texts);

  for (let i = 0; i < store.entries.length; i++) {
    store.entries[i].vector = vectors[i];
    store.entries[i].model = activeEmbeddingProvider;
  }

  store.model = activeEmbeddingProvider;
  if (vectors[0]) {
    store.dimension = vectors[0].length;
  }
  saveVectorStore(store);

  return { count: store.entries.length, model: activeEmbeddingProvider };
}

/**
 * Get stats about the vector store.
 */
export function vectorStats(): {
  entryCount: number;
  dimension: number;
  model: string;
  sizeBytes: number;
} {
  const store = loadVectorStore();
  const raw = JSON.stringify(store);
  return {
    entryCount: store.entries.length,
    dimension: store.dimension,
    model: store.model,
    sizeBytes: Buffer.byteLength(raw, "utf-8"),
  };
}

/**
 * Hybrid search: combines vector similarity with keyword matching.
 * Returns a blended score (70% semantic + 30% keyword).
 */
function computeKeywordScore(queryWords: Set<string>, text: string): number {
  const entryWords = new Set(text.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const overlap = Array.from(queryWords).filter(w => entryWords.has(w)).length;
  return queryWords.size > 0 ? overlap / queryWords.size : 0;
}

export async function hybridSearch(
  query: string,
  limit = 5,
  minScore = 0.2
): Promise<VectorSearchResult[]> {
  const store = loadVectorStore();
  if (store.entries.length === 0) return [];

  const [queryVector] = await getEmbeddings([query]);
  const queryWords = new Set(query.toLowerCase().split(/\s+/).filter(w => w.length > 2));

  const results: VectorSearchResult[] = store.entries
    .map(entry => {
      const semanticScore = cosineSimilarity(queryVector, entry.vector);
      const keywordScore = computeKeywordScore(queryWords, entry.text);
      const blendedScore = semanticScore * 0.7 + keywordScore * 0.3;

      return {
        id: entry.id,
        text: entry.text,
        score: blendedScore,
      };
    })
    .filter(r => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return results;
}
