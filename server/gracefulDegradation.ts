/**
 * gracefulDegradation.ts — v5.17
 *
 * Graceful Degradation & Fallback Chains Module.
 *
 * When critical services (LLM API, database, search) are unavailable,
 * this module provides fallback behavior instead of hard failures:
 *
 * - LLM down → queue requests, use cached responses, try fallback providers
 * - Database down → use in-memory store, queue writes for replay
 * - Search down → use cached results, fall back to alternative engine
 * - Embedding API down → use keyword search instead of vector search
 *
 * Features:
 * - Service health monitoring with circuit breakers
 * - Automatic fallback chain execution
 * - Request queuing for later replay
 * - Cached response serving
 * - Degraded mode notifications to frontend
 * - Auto-recovery detection and queue drain
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ServiceName = "llm" | "database" | "memory" | "search" | "embedding" | "docker" | "mcp";

export type ServiceStatus = "healthy" | "degraded" | "down" | "recovering";

export interface ServiceState {
  name: ServiceName;
  status: ServiceStatus;
  lastHealthy: number;
  lastCheck: number;
  consecutiveFailures: number;
  circuitBreakerOpen: boolean;
  fallbackActive: boolean;
  currentFallbackLevel: number; // 0 = primary, 1+ = fallback levels
  queuedRequests: number;
}

export interface FallbackChain {
  service: ServiceName;
  levels: FallbackLevel[];
}

export interface FallbackLevel {
  level: number;
  name: string;
  description: string;
  handler: () => Promise<boolean>; // Returns true if fallback is available
  limitations: string[];
}

export interface DegradationEvent {
  service: ServiceName;
  previousStatus: ServiceStatus;
  newStatus: ServiceStatus;
  timestamp: number;
  reason: string;
  fallbackActivated: boolean;
}

export interface QueuedRequest {
  id: string;
  service: ServiceName;
  operation: string;
  payload: any;
  queuedAt: number;
  retryCount: number;
  maxRetries: number;
}

export interface DegradationConfig {
  enabled: boolean;
  circuitBreakerThreshold: number; // Failures before opening circuit
  circuitBreakerResetMs: number; // Time before trying again
  maxQueueSize: number; // Max queued requests per service
  queueDrainBatchSize: number; // How many to process at once on recovery
  healthCheckIntervalMs: number; // How often to check service health
  notifyFrontend: boolean; // Send degradation events to connected clients
}

// ─── State ────────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: DegradationConfig = {
  enabled: true,
  circuitBreakerThreshold: 3,
  circuitBreakerResetMs: 30_000,
  maxQueueSize: 100,
  queueDrainBatchSize: 10,
  healthCheckIntervalMs: 300_000, // v6.20: 5min (was 30s) — prevents API rate limit exhaustion
  notifyFrontend: true,
};

let config: DegradationConfig = { ...DEFAULT_CONFIG };

const serviceStates: Map<ServiceName, ServiceState> = new Map();
const requestQueues: Map<ServiceName, QueuedRequest[]> = new Map();
const degradationHistory: DegradationEvent[] = [];
const MAX_HISTORY = 200;
let healthCheckTimer: ReturnType<typeof setInterval> | null = null;

// Event listeners for degradation notifications
type DegradationListener = (event: DegradationEvent) => void;
const listeners: DegradationListener[] = [];

// ─── Initialization ───────────────────────────────────────────────────────────

function initServiceState(name: ServiceName): ServiceState {
  const state: ServiceState = {
    name,
    status: "healthy",
    lastHealthy: Date.now(),
    lastCheck: Date.now(),
    consecutiveFailures: 0,
    circuitBreakerOpen: false,
    fallbackActive: false,
    currentFallbackLevel: 0,
    queuedRequests: 0,
  };
  serviceStates.set(name, state);
  requestQueues.set(name, []);
  return state;
}

// Initialize all services
const ALL_SERVICES: ServiceName[] = ["llm", "database", "memory", "search", "embedding", "docker", "mcp"];
for (const service of ALL_SERVICES) {
  initServiceState(service);
}

// ─── Fallback Chains ──────────────────────────────────────────────────────────

const fallbackChains: Map<ServiceName, FallbackLevel[]> = new Map();

// LLM Fallback Chain
fallbackChains.set("llm", [
  {
    level: 1,
    name: "alternative_provider",
    description: "Switch to alternative LLM provider (OpenAI/Anthropic)",
    handler: async () => {
      // Check if alternative API keys are configured
      return !!(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY);
    },
    limitations: ["May have different capabilities", "Different pricing", "Different context window"],
  },
  {
    level: 2,
    name: "cached_responses",
    description: "Serve cached responses for similar queries",
    handler: async () => {
      // Cache is always available (may be empty)
      return true;
    },
    limitations: ["Only works for previously seen queries", "May be stale", "No new reasoning"],
  },
  {
    level: 3,
    name: "queue_for_retry",
    description: "Queue requests and retry when service recovers",
    handler: async () => true,
    limitations: ["Delayed responses", "Queue may fill up", "User must wait"],
  },
]);

// Database Fallback Chain
fallbackChains.set("database", [
  {
    level: 1,
    name: "in_memory_store",
    description: "Use in-memory data store (volatile)",
    handler: async () => true,
    limitations: ["Data lost on restart", "Limited capacity", "No persistence"],
  },
  {
    level: 2,
    name: "file_backed_store",
    description: "Use JSON file-backed storage",
    handler: async () => {
      const workspaceDir = path.resolve(process.cwd(), "workspace");
      return fs.existsSync(workspaceDir);
    },
    limitations: ["Slower than DB", "No concurrent access safety", "Limited query capability"],
  },
  {
    level: 3,
    name: "read_only_mode",
    description: "Serve cached data, reject writes",
    handler: async () => true,
    limitations: ["No new data can be stored", "Stale data", "Limited functionality"],
  },
]);

// Search Fallback Chain
fallbackChains.set("search", [
  {
    level: 1,
    name: "alternative_engine",
    description: "Switch between Brave and SearXNG",
    handler: async () => {
      return !!(process.env.BRAVE_SEARCH_API_KEY || process.env.SEARXNG_URL);
    },
    limitations: ["Different result quality", "May have different rate limits"],
  },
  {
    level: 2,
    name: "cached_results",
    description: "Serve cached search results for similar queries",
    handler: async () => true,
    limitations: ["Only previously searched queries", "May be outdated"],
  },
  {
    level: 3,
    name: "llm_knowledge",
    description: "Use LLM's training knowledge instead of live search",
    handler: async () => {
      const llmState = serviceStates.get("llm");
      return llmState?.status === "healthy";
    },
    limitations: ["Knowledge cutoff date", "No real-time info", "May hallucinate"],
  },
]);

// Embedding Fallback Chain
fallbackChains.set("embedding", [
  {
    level: 1,
    name: "keyword_search",
    description: "Fall back to keyword-based search instead of vector search",
    handler: async () => true,
    limitations: ["No semantic understanding", "Exact match only", "Lower recall"],
  },
  {
    level: 2,
    name: "tf_idf_search",
    description: "Use TF-IDF scoring for approximate semantic search",
    handler: async () => true,
    limitations: ["No deep semantics", "Vocabulary-dependent", "Lower quality"],
  },
]);

// Docker Fallback Chain
fallbackChains.set("docker", [
  {
    level: 1,
    name: "direct_execution",
    description: "Execute code directly (no sandbox isolation)",
    handler: async () => true,
    limitations: ["No isolation", "Security risk", "May affect host system"],
  },
]);

// MCP Fallback Chain
fallbackChains.set("mcp", [
  {
    level: 1,
    name: "built_in_tools",
    description: "Use built-in tools instead of MCP-provided ones",
    handler: async () => true,
    limitations: ["Fewer capabilities", "No external integrations"],
  },
]);

// ─── Utility ──────────────────────────────────────────────────────────────────

function getServerDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

function emitDegradationEvent(event: DegradationEvent): void {
  degradationHistory.push(event);
  if (degradationHistory.length > MAX_HISTORY) degradationHistory.shift();

  for (const listener of listeners) {
    try { listener(event); } catch { /* ignore listener errors */ }
  }
}

// ─── Core API ─────────────────────────────────────────────────────────────────

/**
 * Report a service failure. Increments failure counter and may trigger fallback.
 */
export function reportFailure(service: ServiceName, reason: string): ServiceState {
  let state = serviceStates.get(service);
  if (!state) state = initServiceState(service);

  state.consecutiveFailures++;
  state.lastCheck = Date.now();

  const previousStatus = state.status;

  // Check if circuit breaker should open
  if (state.consecutiveFailures >= config.circuitBreakerThreshold) {
    state.circuitBreakerOpen = true;
    state.status = "down";

    // Activate fallback
    const chain = fallbackChains.get(service);
    if (chain && !state.fallbackActive) {
      state.fallbackActive = true;
      state.currentFallbackLevel = 1;
    }
  } else {
    state.status = "degraded";
  }

  // Emit event if status changed
  if (previousStatus !== state.status) {
    emitDegradationEvent({
      service,
      previousStatus,
      newStatus: state.status,
      timestamp: Date.now(),
      reason,
      fallbackActivated: state.fallbackActive,
    });
  }

  serviceStates.set(service, state);
  return state;
}

/**
 * Report a service success. Resets failure counter and may close circuit breaker.
 */
export function reportSuccess(service: ServiceName): ServiceState {
  let state = serviceStates.get(service);
  if (!state) state = initServiceState(service);

  const previousStatus = state.status;

  state.consecutiveFailures = 0;
  state.lastHealthy = Date.now();
  state.lastCheck = Date.now();

  if (state.circuitBreakerOpen) {
    state.circuitBreakerOpen = false;
    state.status = "recovering";

    // Start draining queued requests
    drainQueue(service).catch(() => { /* ignore */ });
  } else {
    state.status = "healthy";
    state.fallbackActive = false;
    state.currentFallbackLevel = 0;
  }

  if (previousStatus !== state.status) {
    emitDegradationEvent({
      service,
      previousStatus,
      newStatus: state.status,
      timestamp: Date.now(),
      reason: "Service recovered",
      fallbackActivated: false,
    });
  }

  serviceStates.set(service, state);
  return state;
}

/**
 * Check if a service is available (considering circuit breaker).
 */
export function isServiceAvailable(service: ServiceName): boolean {
  const state = serviceStates.get(service);
  if (!state) return true; // Assume available if not tracked

  if (!state.circuitBreakerOpen) return true;

  // Check if enough time has passed to try again (half-open state)
  if (Date.now() - state.lastCheck > config.circuitBreakerResetMs) {
    return true; // Allow one request through to test
  }

  return false;
}

/**
 * Get the current fallback handler for a service.
 */
export async function getFallbackHandler(service: ServiceName): Promise<FallbackLevel | null> {
  const state = serviceStates.get(service);
  if (!state || !state.fallbackActive) return null;

  const chain = fallbackChains.get(service);
  if (!chain) return null;

  // Find the first available fallback at or above current level
  for (let i = state.currentFallbackLevel - 1; i < chain.length; i++) {
    const level = chain[i];
    try {
      const available = await level.handler();
      if (available) {
        state.currentFallbackLevel = level.level;
        return level;
      }
    } catch { /* try next level */ }
  }

  return null;
}

/**
 * Queue a request for later execution when service recovers.
 */
export function queueRequest(service: ServiceName, operation: string, payload: any): QueuedRequest | null {
  const queue = requestQueues.get(service) || [];

  if (queue.length >= config.maxQueueSize) {
    // Drop oldest request to make room
    queue.shift();
  }

  const request: QueuedRequest = {
    id: `req_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    service,
    operation,
    payload,
    queuedAt: Date.now(),
    retryCount: 0,
    maxRetries: 3,
  };

  queue.push(request);
  requestQueues.set(service, queue);

  const state = serviceStates.get(service);
  if (state) state.queuedRequests = queue.length;

  return request;
}

/**
 * Drain the request queue for a recovered service.
 */
/**
 * v9.0: Dispatch a queued request to the correct service handler.
 * Routes by service name and operation string to the appropriate module.
 */
async function dispatchQueuedRequest(request: QueuedRequest): Promise<void> {
  const { service, operation, payload } = request;

  switch (service) {
    case "llm": {
      // Re-submit an LLM completion that was queued during an outage.
      // We can't re-stream to the original client, but we process and cache
      // the result so the next identical request gets a fast response.
      if (operation === "chat" && payload?.query) {
        const { streamAIResponse } = await import("./aiStreaming.js");
        const chunks: string[] = [];
        // Use a no-op response shim to collect the streamed output
        const shimRes = {
          write: (chunk: string) => { chunks.push(chunk); },
          end: () => {},
          setHeader: () => {},
          flushHeaders: () => {},
          on: () => shimRes,
          once: () => shimRes,
          emit: () => false,
        } as unknown as import("express").Response;
        // Pass empty sources array — this is a replay, no live search available
        await streamAIResponse(payload.query, [], shimRes);
        // Cache the assembled result for future identical requests
        cacheResponse(`llm:chat:${payload.query.slice(0, 100)}`, chunks.join(""));
      }
      break;
    }
    case "database": {
      // Re-apply a write that was queued during a DB outage
      if (operation === "write" && payload?.table && payload?.data) {
        const { getDb } = await import("./andromedaDb.js");
        const db = getDb();
        // Generic upsert — the payload must include table + data
        const cols = Object.keys(payload.data);
        const vals = Object.values(payload.data);
        const placeholders = cols.map(() => "?").join(", ");
        db.prepare(
          `INSERT OR REPLACE INTO ${payload.table} (${cols.join(", ")}) VALUES (${placeholders})`
        ).run(...vals);
      }
      break;
    }
    case "search": {
      // Re-run a search query that was queued during a search API outage
      if (operation === "search" && payload?.query) {
        const { aggregateSearch } = await import("./search.js");
        await aggregateSearch(payload.query, payload.options ?? {});
      }
      break;
    }
    case "memory": {
      // Re-store a memory write that was queued during an outage
      if (operation === "store" && payload?.content) {
        const { storeMemory } = await import("./memory.js");
        storeMemory(payload.content, payload.type ?? "general", payload.tags ?? []);
      }
      break;
    }
    case "embedding": {
      // Re-run an embedding request that was queued during an embedding API outage
      if (operation === "embed" && payload?.id && payload?.text) {
        const { vectorStore } = await import("./vectorMemory.js");
        await vectorStore(payload.id, payload.text);
      }
      break;
    }
    case "docker": {
      // Re-run a sandboxed code execution that was queued during a Docker outage
      if (operation === "exec" && payload?.code) {
        const { executeSandboxed } = await import("./sandboxManager.js");
        await executeSandboxed({
          code: payload.code,
          language: payload.language ?? "python",
          ...(payload.options ?? {}),
        });
      }
      break;
    }
    case "mcp": {
      // Re-invoke an MCP tool call that was queued
      // MCP calls are re-dispatched by reconnecting to the server; the original
      // tool invocation is not directly re-playable without the original session.
      if (operation === "connect" && payload?.serverId) {
        const { connectServer } = await import("./mcpClient.js");
        await connectServer(payload.serverId);
      }
      // Other MCP operations are non-replayable — log and skip
      break;
    }
    default:
      // Unknown service — log and skip
      console.warn(`[GracefulDegradation] Unknown service '${service}' for operation '${operation}' — skipping`);
  }
}

async function drainQueue(service: ServiceName): Promise<{ processed: number; failed: number }> {
  const queue = requestQueues.get(service) || [];
  let processed = 0;
  let failed = 0;

  const batch = queue.splice(0, config.queueDrainBatchSize);

  for (const request of batch) {
    try {
      // v9.0: Real queue drain — dispatch to the correct service handler based on operation
      await dispatchQueuedRequest(request);
      console.log(`[GracefulDegradation] Drained queued request: ${request.operation} (service: ${service})`);
      processed++;
    } catch (err) {
      request.retryCount++;
      console.warn(`[GracefulDegradation] Retry ${request.retryCount}/${request.maxRetries} for ${request.operation}:`, (err as Error).message);
      if (request.retryCount < request.maxRetries) {
        queue.unshift(request); // Put back for retry
      } else {
        console.error(`[GracefulDegradation] Dropping request ${request.operation} after ${request.maxRetries} retries`);
        failed++;
      }
    }
  }

  requestQueues.set(service, queue);
  const state = serviceStates.get(service);
  if (state) {
    state.queuedRequests = queue.length;
    if (queue.length === 0) {
      state.status = "healthy";
      state.fallbackActive = false;
      state.currentFallbackLevel = 0;
    }
  }

  return { processed, failed };
}

// ─── Response Cache ───────────────────────────────────────────────────────────

interface CachedResponse {
  key: string;
  response: any;
  cachedAt: number;
  ttlMs: number;
  hitCount: number;
}

const responseCache: Map<string, CachedResponse> = new Map();
const MAX_CACHE_SIZE = 500;
const DEFAULT_TTL = 3600_000; // 1 hour

/**
 * Cache a response for potential fallback use.
 */
export function cacheResponse(key: string, response: any, ttlMs: number = DEFAULT_TTL): void {
  if (responseCache.size >= MAX_CACHE_SIZE) {
    // Evict oldest entry
    const oldest = Array.from(responseCache.entries())
      .sort((a, b) => a[1].cachedAt - b[1].cachedAt)[0];
    if (oldest) responseCache.delete(oldest[0]);
  }

  responseCache.set(key, { key, response, cachedAt: Date.now(), ttlMs, hitCount: 0 });
}

/**
 * Get a cached response if available and not expired.
 */
export function getCachedResponse(key: string): any | null {
  const cached = responseCache.get(key);
  if (!cached) return null;

  if (Date.now() - cached.cachedAt > cached.ttlMs) {
    responseCache.delete(key);
    return null;
  }

  cached.hitCount++;
  return cached.response;
}

// ─── Status & Monitoring ──────────────────────────────────────────────────────

/**
 * Get the overall system degradation status.
 */
export function getDegradationStatus(): {
  overall: "healthy" | "degraded" | "critical";
  services: ServiceState[];
  activeEvents: DegradationEvent[];
  queuedRequests: number;
  cacheSize: number;
  config: DegradationConfig;
} {
  const services = Array.from(serviceStates.values());
  const downServices = services.filter(s => s.status === "down");
  const degradedServices = services.filter(s => s.status === "degraded");
  const totalQueued = services.reduce((sum, s) => sum + s.queuedRequests, 0);

  let overall: "healthy" | "degraded" | "critical" = "healthy";
  if (downServices.length > 0) overall = "critical";
  else if (degradedServices.length > 0) overall = "degraded";

  return {
    overall,
    services,
    activeEvents: degradationHistory.slice(-10),
    queuedRequests: totalQueued,
    cacheSize: responseCache.size,
    config,
  };
}

/**
 * Get degradation history.
 */
export function getDegradationHistory(limit: number = 50): DegradationEvent[] {
  return degradationHistory.slice(-limit);
}

/**
 * Register a listener for degradation events.
 */
export function onDegradation(listener: DegradationListener): () => void {
  listeners.push(listener);
  return () => {
    const idx = listeners.indexOf(listener);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

/**
 * Update degradation configuration.
 */
export function setDegradationConfig(updates: Partial<DegradationConfig>): DegradationConfig {
  config = { ...config, ...updates };
  return config;
}

/**
 * Manually reset a service to healthy state (after manual intervention).
 */
export function resetService(service: ServiceName): ServiceState {
  const state = serviceStates.get(service) || initServiceState(service);
  state.status = "healthy";
  state.consecutiveFailures = 0;
  state.circuitBreakerOpen = false;
  state.fallbackActive = false;
  state.currentFallbackLevel = 0;
  state.lastHealthy = Date.now();
  serviceStates.set(service, state);
  return state;
}

/**
 * Start periodic health checking.
 */
export function startHealthMonitoring(): void {
  if (healthCheckTimer) return;

  healthCheckTimer = setInterval(async () => {
    // Check LLM
    try {
      const baseUrl = process.env.LLM_BASE_URL || "https://api.deepseek.com";
      const response = await fetch(`${baseUrl}/v1/models`, {
        headers: { "Authorization": `Bearer ${process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY || ""}` },
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) reportSuccess("llm");
      else reportFailure("llm", `HTTP ${response.status}`);
    } catch (err: any) {
      reportFailure("llm", err.message);
    }

    // Check Search
    if (process.env.BRAVE_SEARCH_API_KEY) {
      try {
        const response = await fetch("https://api.search.brave.com/res/v1/web/search?q=test&count=1", {
          headers: { "X-Subscription-Token": process.env.BRAVE_SEARCH_API_KEY },
          signal: AbortSignal.timeout(5000),
        });
        if (response.ok) reportSuccess("search");
        else reportFailure("search", `HTTP ${response.status}`);
      } catch (err: any) {
        reportFailure("search", err.message);
      }
    }
  }, config.healthCheckIntervalMs);
}

/**
 * Stop health monitoring.
 */
export function stopHealthMonitoring(): void {
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer);
    healthCheckTimer = null;
  }
}

/**
 * Initialize graceful degradation on startup.
 */
export function initGracefulDegradation(): void {
  if (config.enabled) {
    startHealthMonitoring();
  }
  console.log(`[GracefulDegradation] Initialized. Monitoring ${ALL_SERVICES.length} services.`);
}

// v5.26: Alias for diagnostics endpoint
export const getDegradationStats = getDegradationStatus;
