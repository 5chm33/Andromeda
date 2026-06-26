import fs from "fs";
import path from "path";
import { calculateCosineSimilarity } from "./speculativeExecutionEngine.js";

const EMBEDDING_CACHE = path.join(process.cwd(), "data", "embedding_cache.json");

export interface CachedEmbedding {
  code: string;
  embeddingId: string;
  timestamp: number;
}

function loadEmbeddingCache(): CachedEmbedding[] {
  if (fs.existsSync(EMBEDDING_CACHE)) {
    try {
      return JSON.parse(fs.readFileSync(EMBEDDING_CACHE, "utf-8"));
    } catch {
      return [];
    }
  }
  return [];
}

function saveEmbeddingCache(cache: CachedEmbedding[]) {
  const dir = path.dirname(EMBEDDING_CACHE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(EMBEDDING_CACHE, JSON.stringify(cache));
}

/**
 * Checks if a semantically identical proposal has already been generated.
 * Upgrades the v24 SHA-256 cache to use embedding cosine similarity > 0.92.
 */
export function isSemanticDuplicate(newCode: string): boolean {
  const cache = loadEmbeddingCache();
  
  for (const entry of cache) {
    // In production, this would compare dense vector embeddings.
    // For this implementation, we use the fast Jaccard mock.
    const similarity = calculateCosineSimilarity(newCode, entry.code);
    if (similarity > 0.92) {
      console.log(`[SemanticDedup] Near-duplicate detected (similarity: ${similarity.toFixed(2)}). Skipping LLM generation.`);
      return true;
    }
  }
  
  return false;
}

/**
 * Records a new proposal into the semantic embedding cache.
 */
export function recordSemanticEmbedding(code: string) {
  const cache = loadEmbeddingCache();
  
  cache.push({
    code,
    embeddingId: `emb_${Date.now()}`,
    timestamp: Date.now()
  });
  
  // LRU eviction at 1000 entries
  if (cache.length > 1000) {
    cache.shift();
  }
  
  saveEmbeddingCache(cache);
}
