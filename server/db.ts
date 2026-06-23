import { desc, eq, ilike, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { createPool } from "mysql2";
import * as fs from "fs";
import * as path from "path";
import {
  InsertUser,
  InsertSearchHistory,
  searchHistory,
  searchSuggestions,
  users,
} from "../drizzle/schema";
import { ENV } from './_core/env';

// v5.11: Connection pool + exponential backoff reconnect + graceful shutdown cleanup
let _dbPromise: Promise<ReturnType<typeof drizzle> | null> | null = null;
let _healthInterval: ReturnType<typeof setInterval> | null = null;
let _reconnectBackoff = 30_000; // starts at 30s, doubles up to 5 minutes
const MAX_RECONNECT_BACKOFF = 300_000;

// Graceful shutdown: clear the health check interval so the process can exit cleanly
function registerShutdownCleanup() {
  const cleanup = () => {
    if (_healthInterval) {
      clearInterval(_healthInterval);
      _healthInterval = null;
    }
  };
  process.once("SIGTERM", cleanup);
  process.once("SIGINT", cleanup);
}
registerShutdownCleanup();

// Lazily create the drizzle instance with a connection pool.
// Uses a shared promise to prevent multiple concurrent initializations.
export async function getDb() {
  if (!_dbPromise && process.env.DATABASE_URL) {
    _dbPromise = (async () => {
      try {
        // v5.11: Use connection pool (10 connections) instead of single connection
        const pool = createPool({
          uri: process.env.DATABASE_URL!,
          connectionLimit: 10,
          queueLimit: 0,
          enableKeepAlive: true,
          keepAliveInitialDelay: 10_000,
        });
        const db = drizzle(pool);
        _reconnectBackoff = 30_000; // reset backoff on successful connect
        // Start periodic health check once connected
        if (!_healthInterval) {
          _healthInterval = setInterval(async () => {
            try {
              await db.execute(sql`SELECT 1`);
            } catch (err) {
              console.warn("[Database] Health check failed, will reconnect in", _reconnectBackoff / 1000, "s:", err);
              if (_healthInterval) { clearInterval(_healthInterval); _healthInterval = null; }
              _dbPromise = null; // allow re-initialization on next call
              // v5.11: Exponential backoff — don't hammer a recovering database
              setTimeout(() => {
                _reconnectBackoff = Math.min(_reconnectBackoff * 2, MAX_RECONNECT_BACKOFF);
                // Trigger reconnect by calling getDb() after backoff
                getDb().catch(() => { /* will retry again on next request */ });
              }, _reconnectBackoff);
            }
          }, 30_000);
        }
        return db;
      } catch (error) {
        console.warn("[Database] Failed to connect:", error);
        _dbPromise = null; // allow retry on next call
        return null;
      }
    })();
  }
  return _dbPromise ?? null;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// ─── Search history helpers ───────────────────────────────────────────────────

// ─── Local File Fallback (when no DATABASE_URL) ─────────────────────────────

const LOCAL_HISTORY_PATH = path.join(process.cwd(), "data", "history.json");

interface LocalHistoryEntry {
  id: number;
  userId: number | null;
  sessionId: string | null;
  query: string;
  aiAnswer: string | null;
  sources: any[] | null;
  filter: string;
  createdAt: string;
}

function loadLocalHistory(): LocalHistoryEntry[] {
  try {
    if (fs.existsSync(LOCAL_HISTORY_PATH)) {
      return JSON.parse(fs.readFileSync(LOCAL_HISTORY_PATH, "utf-8"));
    }
  } catch (err) {
    console.warn("[DB] Failed to load local history:", err);
  }
  return [];
}

function saveLocalHistory(entries: LocalHistoryEntry[]): void {
  try {
    const dir = path.dirname(LOCAL_HISTORY_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // Keep last 200 entries max
    const trimmed = entries.slice(-200);
    fs.writeFileSync(LOCAL_HISTORY_PATH, JSON.stringify(trimmed, null, 2), "utf-8");
  } catch (err) {
    console.warn("[DB] Failed to save local history:", err);
  }
}

let localIdCounter = Date.now();

export async function saveSearchHistory(data: InsertSearchHistory): Promise<number | null> {
  const db = await getDb();
  if (!db) {
    // Fallback: save to local JSON file
    const entries = loadLocalHistory();
    const id = ++localIdCounter;
    entries.push({
      id,
      userId: (data as any).userId ?? null,
      sessionId: (data as any).sessionId ?? null,
      query: (data as any).query,
      aiAnswer: (data as any).aiAnswer ?? null,
      sources: (data as any).sources ?? null,
      filter: (data as any).filter ?? "all",
      createdAt: new Date().toISOString(),
    });
    saveLocalHistory(entries);
    return id;
  }
  try {
    const result = await db.insert(searchHistory).values(data);
    return (result as unknown as { insertId: number }).insertId ?? null;
  } catch (err) {
    console.error("[DB] saveSearchHistory error:", err);
    return null;
  }
}

export async function updateSearchAnswer(id: number, aiAnswer: string) {
  const db = await getDb();
  if (!db) return;
  try {
    await db.update(searchHistory).set({ aiAnswer }).where(eq(searchHistory.id, id));
  } catch (err) {
    console.error("[DB] updateSearchAnswer error:", err);
  }
}

export async function getUserSearchHistory(userId: number, limit = 20, cursor?: number) {
  const db = await getDb();
  if (!db) return [];
  // v5.9: cursor-based pagination — fetch items older than the cursor ID
  if (cursor) {
    return db
      .select()
      .from(searchHistory)
      .where(sql`${searchHistory.userId} = ${userId} AND ${searchHistory.id} < ${cursor}`)
      .orderBy(desc(searchHistory.createdAt))
      .limit(limit);
  }
  return db
    .select()
    .from(searchHistory)
    .where(eq(searchHistory.userId, userId))
    .orderBy(desc(searchHistory.createdAt))
    .limit(limit);
}

export async function getSessionSearchHistory(sessionId: string, limit = 20, cursor?: number) {
  const db = await getDb();
  if (!db) {
    // Fallback: read from local JSON file
    const entries = loadLocalHistory();
    let filtered = entries.filter(e => e.sessionId === sessionId);
    if (cursor) {
      filtered = filtered.filter(e => e.id < cursor);
    }
    // Sort by createdAt descending
    filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return filtered.slice(0, limit);
  }
  if (cursor) {
    return db
      .select()
      .from(searchHistory)
      .where(sql`${searchHistory.sessionId} = ${sessionId} AND ${searchHistory.id} < ${cursor}`)
      .orderBy(desc(searchHistory.createdAt))
      .limit(limit);
  }
  return db
    .select()
    .from(searchHistory)
    .where(eq(searchHistory.sessionId, sessionId))
    .orderBy(desc(searchHistory.createdAt))
    .limit(limit);
}

export async function deleteUserSearchHistory(userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(searchHistory).where(eq(searchHistory.userId, userId));
}

export async function deleteSearchHistoryItem(id: number, userId: number) {
  const db = await getDb();
  if (!db) return;
  await db
    .delete(searchHistory)
    .where(sql`${searchHistory.id} = ${id} AND ${searchHistory.userId} = ${userId}`);
}

// ─── Suggestions helpers ──────────────────────────────────────────────────────

export async function upsertSuggestion(query: string) {
  const db = await getDb();
  if (!db) return;
  try {
    await db
      .insert(searchSuggestions)
      .values({ query: query.toLowerCase().trim() })
      .onDuplicateKeyUpdate({ set: { count: sql`count + 1` } });
  } catch {
    // ignore
  }
}

export async function getAutocompleteSuggestions(prefix: string, limit = 6) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({ query: searchSuggestions.query, count: searchSuggestions.count })
    .from(searchSuggestions)
    .where(ilike(searchSuggestions.query, `${prefix}%`))
    .orderBy(desc(searchSuggestions.count))
    .limit(limit);
}
