/**
 * security.ts — v5.5 Tier 3
 *
 * Security Module: Authentication, API key management, rate limiting,
 * and audit logging for all Andromeda endpoints.
 *
 * Features:
 * - API key authentication with scoped permissions
 * - Rate limiting (per-key and global)
 * - Request audit logging with structured entries
 * - Session management
 * - CORS configuration
 * - IP allowlist/blocklist
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import type { Request, Response, NextFunction } from "express";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ApiKeyScope =
  | "search"
  | "chat"
  | "agent"
  | "memory"
  | "code"
  | "self-improve"
  | "scheduler"
  | "admin"
  | "*";

export type ApiKey = {
  id: string;
  name: string;
  /** The hashed key (never store plaintext after creation) */
  keyHash: string;
  /** First 8 chars of the key for identification */
  keyPrefix: string;
  scopes: ApiKeyScope[];
  createdAt: string;
  lastUsedAt?: string;
  expiresAt?: string;
  rateLimit: number; // requests per minute, 0 = use global default
  isActive: boolean;
  metadata?: Record<string, string>;
};

export type AuditLogEntry = {
  id: string;
  timestamp: string;
  method: string;
  path: string;
  ip: string;
  apiKeyId?: string;
  apiKeyName?: string;
  statusCode?: number;
  durationMs?: number;
  userAgent?: string;
  error?: string;
};

export type RateLimitEntry = {
  key: string; // apiKeyId or IP
  windowStart: number;
  count: number;
};

export type SecurityConfig = {
  /** Whether authentication is enabled */
  authEnabled: boolean;
  /** Global rate limit (requests per minute) */
  globalRateLimit: number;
  /** Whether to log all requests */
  auditEnabled: boolean;
  /** IP allowlist (empty = allow all) */
  ipAllowlist: string[];
  /** IP blocklist */
  ipBlocklist: string[];
  /** Paths that don't require authentication */
  publicPaths: string[];
  /** Whether to require HTTPS */
  requireHttps: boolean;
  /** Max audit log entries to keep */
  maxAuditEntries: number;
};

type SecurityStore = {
  config: SecurityConfig;
  apiKeys: ApiKey[];
  auditLog: AuditLogEntry[];
};

// ─── Storage ──────────────────────────────────────────────────────────────────

function getDataDir(): string {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getStorePath(): string {
  return path.join(getDataDir(), "security.json");
}

function loadStore(): SecurityStore {
  const p = getStorePath();
  if (!fs.existsSync(p)) {
    return {
      config: getDefaultConfig(),
      apiKeys: [],
      auditLog: [],
    };
  }
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); }
  catch { return { config: getDefaultConfig(), apiKeys: [], auditLog: [] }; }
}

function saveStore(store: SecurityStore): void {
  if (store.auditLog.length > store.config.maxAuditEntries) {
    store.auditLog = store.auditLog.slice(-store.config.maxAuditEntries);
  }
  fs.writeFileSync(getStorePath(), JSON.stringify(store, null, 2), "utf-8");
}

function getDefaultConfig(): SecurityConfig {
  return {
    authEnabled: process.env.AUTH_ENABLED !== 'false', // v6.17: enabled by default; set AUTH_ENABLED=false in .env.local to disable
    globalRateLimit: 120, // 120 req/min
    auditEnabled: true,
    ipAllowlist: [],
    ipBlocklist: [],
    publicPaths: ["/", "/api/health", "/api/manifest", "/assets"],
    requireHttps: false,
    maxAuditEntries: 5000,
  };
}

// ─── Hashing ──────────────────────────────────────────────────────────────────

function hashKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

function generateApiKey(): string {
  return `and_${crypto.randomBytes(32).toString("hex")}`;
}

// ─── Rate Limiting (in-memory sliding window) ─────────────────────────────────

const rateLimitWindows = new Map<string, RateLimitEntry>();

function checkRateLimit(identifier: string, limit: number): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const windowMs = 60000; // 1 minute window
  const entry = rateLimitWindows.get(identifier);

  if (!entry || now - entry.windowStart > windowMs) {
    rateLimitWindows.set(identifier, { key: identifier, windowStart: now, count: 1 });
    return { allowed: true, remaining: limit - 1, resetAt: now + windowMs };
  }

  entry.count++;
  if (entry.count > limit) {
    return { allowed: false, remaining: 0, resetAt: entry.windowStart + windowMs };
  }

  return { allowed: true, remaining: limit - entry.count, resetAt: entry.windowStart + windowMs };
}

// Clean up old rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of Array.from(rateLimitWindows)) {
    if (now - entry.windowStart > 120000) rateLimitWindows.delete(key);
  }
}, 60000);

// ─── API Key Management ───────────────────────────────────────────────────────

export function createApiKey(input: {
  name: string;
  scopes: ApiKeyScope[];
  rateLimit?: number;
  expiresAt?: string;
  metadata?: Record<string, string>;
}): { key: ApiKey; plaintext: string } {
  const store = loadStore();
  const plaintext = generateApiKey();

  const key: ApiKey = {
    id: `key_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: input.name,
    keyHash: hashKey(plaintext),
    keyPrefix: plaintext.slice(0, 12),
    scopes: input.scopes,
    createdAt: new Date().toISOString(),
    expiresAt: input.expiresAt,
    rateLimit: input.rateLimit ?? 0,
    isActive: true,
    metadata: input.metadata,
  };

  store.apiKeys.push(key);
  saveStore(store);

  return { key, plaintext };
}

export function revokeApiKey(keyId: string): boolean {
  const store = loadStore();
  const key = store.apiKeys.find(k => k.id === keyId);
  if (!key) return false;
  key.isActive = false;
  saveStore(store);
  return true;
}

export function deleteApiKey(keyId: string): boolean {
  const store = loadStore();
  const idx = store.apiKeys.findIndex(k => k.id === keyId);
  if (idx === -1) return false;
  store.apiKeys.splice(idx, 1);
  saveStore(store);
  return true;
}

export function listApiKeys(): Omit<ApiKey, "keyHash">[] {
  return loadStore().apiKeys.map(({ keyHash: _h, ...rest }) => rest);
}

function validateApiKey(plaintext: string): ApiKey | null {
  const store = loadStore();
  const hash = hashKey(plaintext);
  const hashBuffer = Buffer.from(hash, 'hex');
  
  let matchedKey: ApiKey | null = null;
  for (const k of store.apiKeys) {
    if (k.isActive) {
      const keyHashBuffer = Buffer.from(k.keyHash, 'hex');
      if (hashBuffer.length === keyHashBuffer.length && crypto.timingSafeEqual(hashBuffer, keyHashBuffer)) {
        matchedKey = k;
        break;
      }
    }
  }
  
  if (!matchedKey) return null;

  // Check expiry
  if (matchedKey.expiresAt && new Date(matchedKey.expiresAt).getTime() < Date.now()) {
    matchedKey.isActive = false;
    saveStore(store);
    return null;
  }

  // Update last used
  matchedKey.lastUsedAt = new Date().toISOString();
  saveStore(store);
  return matchedKey;
}

// ─── Scope Checking ───────────────────────────────────────────────────────────

function pathToScope(reqPath: string): ApiKeyScope {
  if (reqPath.startsWith("/api/search") || reqPath.startsWith("/api/deep")) return "search";
  if (reqPath.startsWith("/api/chat") || reqPath.startsWith("/api/continue")) return "chat";
  if (reqPath.startsWith("/api/agent") || reqPath.startsWith("/api/react") || reqPath.startsWith("/api/orchestrat")) return "agent";
  if (reqPath.startsWith("/api/memory") || reqPath.startsWith("/api/vector")) return "memory";
  if (reqPath.startsWith("/api/code") || reqPath.startsWith("/api/execute")) return "code";
  if (reqPath.startsWith("/api/self") || reqPath.startsWith("/api/guard")) return "self-improve";
  if (reqPath.startsWith("/api/scheduler") || reqPath.startsWith("/api/webhook")) return "scheduler";
  if (reqPath.startsWith("/api/security") || reqPath.startsWith("/api/llm") || reqPath.startsWith("/api/mcp")) return "admin";
  return "search"; // default
}

// ─── Audit Logging ────────────────────────────────────────────────────────────

function logRequest(entry: Omit<AuditLogEntry, "id">): void {
  const store = loadStore();
  if (!store.config.auditEnabled) return;
  store.auditLog.push({
    id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ...entry,
  });
  saveStore(store);
}

export function getAuditLog(options?: {
  limit?: number;
  apiKeyId?: string;
  path?: string;
  since?: string;
}): AuditLogEntry[] {
  let logs = loadStore().auditLog;

  if (options?.apiKeyId) logs = logs.filter(l => l.apiKeyId === options.apiKeyId);
  if (options?.path) logs = logs.filter(l => l.path.startsWith(options.path!));
  if (options?.since) {
    const sinceMs = new Date(options.since).getTime();
    logs = logs.filter(l => new Date(l.timestamp).getTime() >= sinceMs);
  }

  return logs.slice(-(options?.limit ?? 100)).reverse();
}

export function getAuditStats(): {
  totalRequests: number;
  last24h: number;
  topPaths: Array<{ path: string; count: number }>;
  topKeys: Array<{ keyId: string; keyName: string; count: number }>;
  errorRate: number;
} {
  const logs = loadStore().auditLog;
  const now = Date.now();
  const last24h = logs.filter(l => now - new Date(l.timestamp).getTime() < 86400000);

  const pathCounts = new Map<string, number>();
  const keyCounts = new Map<string, { name: string; count: number }>();
  let errors = 0;

  for (const log of last24h) {
    // Normalize path
    const basePath = log.path.split("?")[0];
    pathCounts.set(basePath, (pathCounts.get(basePath) ?? 0) + 1);

    if (log.apiKeyId) {
      const existing = keyCounts.get(log.apiKeyId) ?? { name: log.apiKeyName ?? "unknown", count: 0 };
      existing.count++;
      keyCounts.set(log.apiKeyId, existing);
    }

    if (log.statusCode && log.statusCode >= 400) errors++;
  }

  const topPaths = Array.from(pathCounts.entries())
    .map(([p, count]) => ({ path: p, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const topKeys = Array.from(keyCounts.entries())
    .map(([keyId, { name, count }]) => ({ keyId, keyName: name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    totalRequests: logs.length,
    last24h: last24h.length,
    topPaths,
    topKeys,
    errorRate: last24h.length > 0 ? errors / last24h.length : 0,
  };
}

// ─── Express Middleware ───────────────────────────────────────────────────────

export function securityMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const store = loadStore();
    const config = store.config;
    const startTime = Date.now();
    const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";

    // IP blocklist
    if (config.ipBlocklist.length > 0 && config.ipBlocklist.includes(ip)) {
      logRequest({ timestamp: new Date().toISOString(), method: req.method, path: req.path, ip, statusCode: 403, error: "IP blocked" });
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    // IP allowlist
    if (config.ipAllowlist.length > 0 && !config.ipAllowlist.includes(ip)) {
      logRequest({ timestamp: new Date().toISOString(), method: req.method, path: req.path, ip, statusCode: 403, error: "IP not in allowlist" });
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    // Public paths bypass auth
    const isPublic = config.publicPaths.some(p => req.path.startsWith(p));

    // Authentication
    if (config.authEnabled && !isPublic) {
      const authHeader = req.headers.authorization;
      const apiKeyParam = req.query.api_key as string | undefined;
      const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : apiKeyParam;

      if (!token) {
        logRequest({ timestamp: new Date().toISOString(), method: req.method, path: req.path, ip, statusCode: 401, error: "No API key" });
        res.status(401).json({ error: "API key required. Pass via Authorization: Bearer <key> or ?api_key=<key>" });
        return;
      }

      const apiKey = validateApiKey(token);
      if (!apiKey) {
        logRequest({ timestamp: new Date().toISOString(), method: req.method, path: req.path, ip, statusCode: 401, error: "Invalid API key" });
        res.status(401).json({ error: "Invalid or expired API key" });
        return;
      }

      // Scope check
      const requiredScope = pathToScope(req.path);
      if (!apiKey.scopes.includes("*") && !apiKey.scopes.includes(requiredScope)) {
        logRequest({ timestamp: new Date().toISOString(), method: req.method, path: req.path, ip, apiKeyId: apiKey.id, apiKeyName: apiKey.name, statusCode: 403, error: `Scope '${requiredScope}' not granted` });
        res.status(403).json({ error: `API key does not have '${requiredScope}' scope` });
        return;
      }

      // Per-key rate limit
      const keyLimit = apiKey.rateLimit || config.globalRateLimit;
      const keyRateCheck = checkRateLimit(`key:${apiKey.id}`, keyLimit);
      if (!keyRateCheck.allowed) {
        res.set("X-RateLimit-Limit", String(keyLimit));
        res.set("X-RateLimit-Remaining", "0");
        res.set("X-RateLimit-Reset", String(Math.ceil(keyRateCheck.resetAt / 1000)));
        logRequest({ timestamp: new Date().toISOString(), method: req.method, path: req.path, ip, apiKeyId: apiKey.id, apiKeyName: apiKey.name, statusCode: 429, error: "Rate limited" });
        res.status(429).json({ error: "Rate limit exceeded" });
        return;
      }

      // Attach key info to request for downstream use
      (req as any).apiKey = apiKey;

      // Set rate limit headers
      res.set("X-RateLimit-Limit", String(keyLimit));
      res.set("X-RateLimit-Remaining", String(keyRateCheck.remaining));
      res.set("X-RateLimit-Reset", String(Math.ceil(keyRateCheck.resetAt / 1000)));
    }

    // Global rate limit (by IP)
    const globalCheck = checkRateLimit(`ip:${ip}`, config.globalRateLimit);
    if (!globalCheck.allowed) {
      logRequest({ timestamp: new Date().toISOString(), method: req.method, path: req.path, ip, statusCode: 429, error: "Global rate limit" });
      res.status(429).json({ error: "Too many requests" });
      return;
    }

    // Audit logging (on response finish)
    res.on("finish", () => {
      const apiKey = (req as any).apiKey as ApiKey | undefined;
      logRequest({
        timestamp: new Date().toISOString(),
        method: req.method,
        path: req.path,
        ip,
        apiKeyId: apiKey?.id,
        apiKeyName: apiKey?.name,
        statusCode: res.statusCode,
        durationMs: Date.now() - startTime,
        userAgent: req.headers["user-agent"]?.slice(0, 200),
      });
    });

    next();
  };
}

// ─── Config Management ────────────────────────────────────────────────────────

export function getSecurityConfig(): SecurityConfig {
  return { ...loadStore().config };
}

export function updateSecurityConfig(updates: Partial<SecurityConfig>): SecurityConfig {
  const store = loadStore();
  store.config = { ...store.config, ...updates };
  saveStore(store);
  return store.config;
}

// ─── Stats ────────────────────────────────────────────────────────────────────

export function getSecurityStats(): {
  authEnabled: boolean;
  totalApiKeys: number;
  activeApiKeys: number;
  totalAuditEntries: number;
  globalRateLimit: number;
} {
  const store = loadStore();
  return {
    authEnabled: store.config.authEnabled,
    totalApiKeys: store.apiKeys.length,
    activeApiKeys: store.apiKeys.filter(k => k.isActive).length,
    totalAuditEntries: store.auditLog.length,
    globalRateLimit: store.config.globalRateLimit,
  };
}
