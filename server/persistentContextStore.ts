/**
 * persistentContextStore.ts — Andromeda v5.68
 *
 * Disk-backed persistent storage for tool outputs and conversation context.
 * Prevents data loss when context compression evicts messages from memory.
 *
 * Features:
 *  1. Streams all tool outputs to disk as they arrive
 *  2. Provides retrieval by session, tool name, or content search
 *  3. Automatic cleanup of entries older than 24 hours
 *  4. JSON-lines format for append-only performance
 *  5. Memory-mapped index for fast lookups
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from "fs";
import * as path from "path";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ContextEntry {
  id: string;
  sessionId: string;
  timestamp: number;
  role: "tool" | "assistant" | "user";
  toolName?: string;
  content: string;
  tokenEstimate: number;
  compressed: boolean;
  compressedContent?: string;
}

interface IndexEntry {
  id: string;
  sessionId: string;
  timestamp: number;
  toolName?: string;
  tokenEstimate: number;
  lineNumber: number;
}

// ─── Configuration ──────────────────────────────────────────────────────────

const STORE_DIR = process.env.ANDROMEDA_WORKSPACE ? path.join(process.env.ANDROMEDA_WORKSPACE, "context_store") : path.join(process.cwd(), ".data", "context_store");
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_ENTRIES_PER_SESSION = 500;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// ─── State ──────────────────────────────────────────────────────────────────

let _initialized = false;
let _cleanupInterval: ReturnType<typeof setInterval> | null = null;
const _index: Map<string, IndexEntry[]> = new Map(); // sessionId → entries
let _lineCounter = 0;

// ─── Initialization ─────────────────────────────────────────────────────────

function ensureStoreDir(): void {
  if (!existsSync(STORE_DIR)) {
    mkdirSync(STORE_DIR, { recursive: true });
  }
}

function getStoreFile(sessionId: string): string {
  return path.join(STORE_DIR, `${sessionId.replace(/[^a-zA-Z0-9_-]/g, "_")}.jsonl`);
}

export function initPersistentContextStore(): void {
  if (_initialized) return;
  ensureStoreDir();

  // Load existing index from disk
  try {
    const files = readdirSync(STORE_DIR).filter(f => f.endsWith(".jsonl"));
    for (const file of files) {
      const sessionId = file.replace(".jsonl", "");
      const filePath = path.join(STORE_DIR, file);
      const content = readFileSync(filePath, "utf8");
      const lines = content.split("\n").filter(l => l.trim());
      const entries: IndexEntry[] = [];

      for (let i = 0; i < lines.length; i++) {
        try {
          const entry = JSON.parse(lines[i]) as ContextEntry;
          entries.push({
            id: entry.id,
            sessionId: entry.sessionId,
            timestamp: entry.timestamp,
            toolName: entry.toolName,
            tokenEstimate: entry.tokenEstimate,
            lineNumber: i,
          });
        } catch { /* skip malformed lines */ }
      }

      _index.set(sessionId, entries);
      _lineCounter += lines.length;
    }
  } catch { /* fresh start */ }

  _initialized = true;
  _cleanupInterval = setInterval(cleanup, CLEANUP_INTERVAL_MS);
  console.log(`[PersistentContextStore] Initialized — ${_index.size} sessions, ${_lineCounter} entries loaded`);
}

// ─── Store Operations ───────────────────────────────────────────────────────

/**
 * Store a tool output or message to persistent storage.
 */
export function storeContext(entry: Omit<ContextEntry, "id">): string {
  ensureStoreDir();
  const id = `ctx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const fullEntry: ContextEntry = { ...entry, id };

  const filePath = getStoreFile(entry.sessionId);
  appendFileSync(filePath, JSON.stringify(fullEntry) + "\n");

  // Update index
  if (!_index.has(entry.sessionId)) {
    _index.set(entry.sessionId, []);
  }
  const sessionEntries = _index.get(entry.sessionId)!;
  sessionEntries.push({
    id,
    sessionId: entry.sessionId,
    timestamp: entry.timestamp,
    toolName: entry.toolName,
    tokenEstimate: entry.tokenEstimate,
    lineNumber: _lineCounter++,
  });

  // Enforce per-session limit
  if (sessionEntries.length > MAX_ENTRIES_PER_SESSION) {
    sessionEntries.shift(); // Remove oldest
  }

  return id;
}

/**
 * Retrieve a specific context entry by ID.
 */
export function retrieveContext(sessionId: string, id: string): ContextEntry | null {
  const filePath = getStoreFile(sessionId);
  if (!existsSync(filePath)) return null;

  const content = readFileSync(filePath, "utf8");
  const lines = content.split("\n").filter(l => l.trim());

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as ContextEntry;
      if (entry.id === id) return entry;
    } catch { /* skip */ }
  }
  return null;
}

/**
 * Retrieve all context entries for a session, optionally filtered by tool name.
 */
export function retrieveSessionContext(
  sessionId: string,
  options?: { toolName?: string; limit?: number; since?: number }
): ContextEntry[] {
  const filePath = getStoreFile(sessionId);
  if (!existsSync(filePath)) return [];

  const content = readFileSync(filePath, "utf8");
  const lines = content.split("\n").filter(l => l.trim());
  const results: ContextEntry[] = [];

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as ContextEntry;
      if (options?.toolName && entry.toolName !== options.toolName) continue;
      if (options?.since && entry.timestamp < options.since) continue;
      results.push(entry);
    } catch { /* skip */ }
  }

  // Sort by timestamp descending (most recent first)
  results.sort((a, b) => b.timestamp - a.timestamp);

  if (options?.limit) {
    return results.slice(0, options.limit);
  }
  return results;
}

/**
 * Search context entries by content substring.
 */
export function searchContext(sessionId: string, query: string, limit: number = 10): ContextEntry[] {
  const filePath = getStoreFile(sessionId);
  if (!existsSync(filePath)) return [];

  const content = readFileSync(filePath, "utf8");
  const lines = content.split("\n").filter(l => l.trim());
  const results: ContextEntry[] = [];
  const queryLower = query.toLowerCase();

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as ContextEntry;
      if (entry.content.toLowerCase().includes(queryLower)) {
        results.push(entry);
      }
    } catch { /* skip */ }
  }

  return results.slice(-limit);
}

// ─── Cleanup ────────────────────────────────────────────────────────────────

function cleanup(): void {
  const now = Date.now();
  const cutoff = now - MAX_AGE_MS;

  for (const [sessionId, entries] of _index.entries()) {
    // Remove entries older than MAX_AGE
    const validEntries = entries.filter(e => e.timestamp > cutoff);
    if (validEntries.length === 0) {
      // Remove entire session file
      const filePath = getStoreFile(sessionId);
      try { unlinkSync(filePath); } catch { /* ignore */ }
      _index.delete(sessionId);
    } else if (validEntries.length < entries.length) {
      _index.set(sessionId, validEntries);
      // Rewrite the file with only valid entries
      const filePath = getStoreFile(sessionId);
      if (existsSync(filePath)) {
        const content = readFileSync(filePath, "utf8");
        const lines = content.split("\n").filter(l => l.trim());
        const validLines: string[] = [];
        for (const line of lines) {
          try {
            const entry = JSON.parse(line) as ContextEntry;
            if (entry.timestamp > cutoff) {
              validLines.push(line);
            }
          } catch { /* skip */ }
        }
        writeFileSync(filePath, validLines.join("\n") + "\n");
      }
    }
  }
}

// ─── Stats ──────────────────────────────────────────────────────────────────

export function getStoreStats(): { sessions: number; totalEntries: number; oldestEntry: number } {
  let totalEntries = 0;
  let oldestEntry = Date.now();

  for (const entries of _index.values()) {
    totalEntries += entries.length;
    for (const e of entries as IndexEntry[]) {
      if (e.timestamp < oldestEntry) oldestEntry = e.timestamp;
    }
  }

  return { sessions: _index.size, totalEntries, oldestEntry };
}

export function stopPersistentContextStore(): void {
  if (_cleanupInterval) {
    clearInterval(_cleanupInterval);
    _cleanupInterval = null;
  }
}
