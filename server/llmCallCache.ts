import fs from "fs";
import path from "path";
import crypto from "crypto";

const CACHE_FILE = path.join(process.cwd(), ".andromeda_llm_cache.json");

export interface CacheEntry {
  response: string;
  timestamp: number;
  hits: number;
}

export interface LlmCache {
  entries: Record<string, CacheEntry>;
  totalHits: number;
  totalMisses: number;
}

export function initLlmCache(): void {
  if (!fs.existsSync(CACHE_FILE)) {
    const defaultCache: LlmCache = { entries: {}, totalHits: 0, totalMisses: 0 };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(defaultCache, null, 2));
  }
}

export function getCache(): LlmCache {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
  } catch {
    return { entries: {}, totalHits: 0, totalMisses: 0 };
  }
}

export function saveCache(cache: LlmCache): void {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

function hashPrompt(prompt: string, systemPrompt?: string, temperature?: number): string {
  const hash = crypto.createHash("sha256");
  hash.update(prompt);
  if (systemPrompt) hash.update(systemPrompt);
  if (temperature !== undefined) hash.update(temperature.toString());
  return hash.digest("hex");
}

/**
 * Checks the cache for a semantically identical LLM call.
 * Only caches deterministic calls (temperature = 0).
 */
export function checkLlmCache(prompt: string, systemPrompt?: string, temperature: number = 0.7): string | null {
  // Only cache deterministic calls to preserve RSI exploration
  if (temperature > 0.1) return null;
  
  const cache = getCache();
  const hash = hashPrompt(prompt, systemPrompt, temperature);
  
  const entry = cache.entries[hash];
  if (entry) {
    entry.hits++;
    cache.totalHits++;
    saveCache(cache);
    return entry.response;
  }
  
  cache.totalMisses++;
  saveCache(cache);
  return null;
}

/**
 * Saves a deterministic LLM response to the cache.
 */
export function writeLlmCache(prompt: string, response: string, systemPrompt?: string, temperature: number = 0.7): void {
  if (temperature > 0.1) return;
  
  const cache = getCache();
  const hash = hashPrompt(prompt, systemPrompt, temperature);
  
  cache.entries[hash] = {
    response,
    timestamp: Date.now(),
    hits: 0
  };
  
  // Prune cache if it gets too large (LRU-ish)
  const keys = Object.keys(cache.entries);
  if (keys.length > 1000) {
    const sorted = keys.sort((a, b) => cache.entries[a].timestamp - cache.entries[b].timestamp);
    for (let i = 0; i < 200; i++) {
      delete cache.entries[sorted[i]];
    }
  }
  
  saveCache(cache);
}
