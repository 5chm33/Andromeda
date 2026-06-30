/**
 * adaptiveRouter.ts — v5.33
 *
 * Adaptive LLM Provider Routing.
 *
 * Dynamically routes LLM requests to the best provider based on:
 * - Latency history
 * - Error rates
 * - Cost per token
 * - Task complexity
 * - Provider availability
 *
 * Supports:
 * - DeepSeek (primary)
 * - OpenRouter (Claude, GPT, etc.)
 * - Fallback chains
 * - Automatic failover
 * - Performance-based routing
 */

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface LLMProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKeyEnv: string;
  models: string[];
  costPer1kTokens: number;  // USD
  maxContextWindow: number;
  priority: number;          // Lower = higher priority
  enabled: boolean;
}

export interface ProviderMetrics {
  providerId: string;
  totalRequests: number;
  totalErrors: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  lastErrorTime: number;
  lastSuccessTime: number;
  latencyHistory: number[];  // Last 50 latencies
  errorRate: number;         // 0-1
  isHealthy: boolean;
}

export interface RoutingDecision {
  provider: LLMProvider;
  model: string;
  reason: string;
  fallbackChain: string[];
}

export interface RoutingOptions {
  taskType?: "chat" | "code" | "analysis" | "self_improvement";
  maxLatencyMs?: number;
  preferCost?: boolean;
  preferQuality?: boolean;
  requiredContextWindow?: number;
  excludeProviders?: string[];
}

// ─── Provider Registry ─────────────────────────────────────────────────────────

const providers: Map<string, LLMProvider> = new Map();
const metrics: Map<string, ProviderMetrics> = new Map();

// Default providers
const DEFAULT_PROVIDERS: LLMProvider[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: process.env.LLM_API_URL || process.env.DEEPSEEK_API_URL || "https://api.deepseek.com/v1",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    models: ["deepseek-chat", "deepseek-reasoner"],
    costPer1kTokens: 0.001,
    maxContextWindow: 128000,
    priority: 1,
    enabled: !!process.env.DEEPSEEK_API_KEY,
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKeyEnv: "OPENROUTER_API_KEY",
    models: ["anthropic/claude-sonnet-4", "anthropic/claude-haiku-4", "openai/gpt-4.1-mini"],
    costPer1kTokens: 0.003,
    maxContextWindow: 200000,
    priority: 2,
    enabled: !!process.env.OPENROUTER_API_KEY,
  },
];

// ─── Initialization ────────────────────────────────────────────────────────────

function initProviders(): void {
  if (providers.size > 0) return;

  for (const provider of DEFAULT_PROVIDERS) {
    // v5.40: Re-check env vars at init time (dotenv loads after ESM module init)
    const hasKey = !!process.env[provider.apiKeyEnv];
    const p = { ...provider, enabled: hasKey || provider.enabled };
    providers.set(p.id, p);
    metrics.set(p.id, {
      providerId: provider.id,
      totalRequests: 0,
      totalErrors: 0,
      avgLatencyMs: 0,
      p95LatencyMs: 0,
      lastErrorTime: 0,
      lastSuccessTime: 0,
      latencyHistory: [],
      errorRate: 0,
      isHealthy: true,
    });
  }
}

// ─── Metrics Recording ─────────────────────────────────────────────────────────

/**
 * Record a successful request to a provider.
 */
export function recordSuccess(providerId: string, latencyMs: number): void {
  if (typeof providerId !== 'string' || providerId.length === 0) return;
  if (typeof latencyMs !== 'number' || latencyMs < 0) return;
  initProviders();
  const m = metrics.get(providerId);
  if (!m) return;

  m.totalRequests++;
  m.lastSuccessTime = Date.now();
  m.latencyHistory.push(latencyMs);
  if (m.latencyHistory.length > 50) m.latencyHistory.shift();

  // Recalculate metrics
  m.avgLatencyMs = m.latencyHistory.reduce((s, l) => s + l, 0) / m.latencyHistory.length;
  const sorted = [...m.latencyHistory].sort((a, b) => a - b);
  m.p95LatencyMs = sorted[Math.floor(sorted.length * 0.95)] || m.avgLatencyMs;
  m.errorRate = m.totalRequests > 0 ? m.totalErrors / m.totalRequests : 0;
  m.isHealthy = m.errorRate < 0.3 && (Date.now() - m.lastErrorTime > 30000 || m.lastErrorTime === 0);
}

/**
 * Record a failed request to a provider.
 */
export function recordError(providerId: string): void {
  initProviders();
  const m = metrics.get(providerId);
  if (!m) return;

  m.totalRequests++;
  m.totalErrors++;
  m.lastErrorTime = Date.now();
  m.errorRate = m.totalRequests > 0 ? m.totalErrors / m.totalRequests : 0;
  m.isHealthy = m.errorRate < 0.3 && (Date.now() - m.lastErrorTime > 30000 || m.lastErrorTime === 0);
}

// ─── Routing Logic ─────────────────────────────────────────────────────────────

/**
 * Select the best provider and model for a request.
 */
export function selectProvider(options: RoutingOptions = {}): RoutingDecision {
  initProviders();

  const {
    taskType = "chat",
    maxLatencyMs,
    preferCost = false,
    preferQuality = false,
    requiredContextWindow,
    excludeProviders = [],
  } = options;

  // Get eligible providers
  const eligible = Array.from(providers.values()).filter(p => {
    if (!p.enabled) return false;
    if (excludeProviders.includes(p.id)) return false;
    if (requiredContextWindow && p.maxContextWindow < requiredContextWindow) return false;
    // Check if API key is available
    if (!process.env[p.apiKeyEnv]) return false;
    return true;
  });

  if (eligible.length === 0) {
    // Fallback to first available provider regardless of health
    const fallback = Array.from(providers.values()).find(p => p.enabled && process.env[p.apiKeyEnv]);
    if (fallback) {
      return {
        provider: fallback,
        model: selectModel(fallback, taskType),
        reason: "No eligible providers — using fallback",
        fallbackChain: [],
      };
    }
    throw new Error("No LLM providers available");
  }

  // Score each provider
  const scored = eligible.map(provider => {
    const m = metrics.get(provider.id);
    const score = calculateProviderScore(provider, m, { maxLatencyMs, preferCost, preferQuality, taskType });
    return { provider, score };
  });

function calculateProviderScore(
  provider: LLMProvider,
  m: ProviderMetrics | undefined,
  options: { maxLatencyMs?: number; preferCost?: boolean; preferQuality?: boolean; taskType?: string }
): number {
  const { maxLatencyMs, preferCost, preferQuality, taskType } = options;
  let score = 0;

  // Health bonus (0-30 points)
  if (m?.isHealthy) score += 30;
  else if (m && m.errorRate < 0.5) score += 15;

  // Latency score (0-25 points)
  if (m && m.avgLatencyMs > 0) {
    if (maxLatencyMs && m.avgLatencyMs > maxLatencyMs) score -= 20;
    else score += Math.max(0, 25 - (m.avgLatencyMs / 200)); // Lower latency = higher score
  } else {
    score += 15; // Unknown latency — moderate score
  }

  // Cost score (0-20 points)
  if (preferCost) {
    score += Math.max(0, 20 - (provider.costPer1kTokens * 5000));
  }

  // Quality score (0-15 points) — based on task type
  if (preferQuality || taskType === "self_improvement") {
    // Prefer larger models for quality-sensitive tasks
    if (provider.id === "openrouter") score += 15;
    else score += 10;
  }

  // Priority bonus (0-10 points)
  score += Math.max(0, 10 - provider.priority * 2);

  return score;
}

  // Sort by score
  scored.sort((a, b) => b.score - a.score);

  const best = scored[0];
  const fallbackChain = scored.slice(1).map(s => s.provider.id);

  return {
    provider: best.provider,
    model: selectModel(best.provider, taskType),
    reason: `Score: ${best.score.toFixed(0)} (health: ${metrics.get(best.provider.id)?.isHealthy}, latency: ${metrics.get(best.provider.id)?.avgLatencyMs.toFixed(0)}ms)`,
    fallbackChain,
  };
}

/**
 * Select the best model from a provider for a given task type.
 */
function selectModel(provider: LLMProvider, taskType: string): string {
  if (provider.id === "deepseek") {
    if (taskType === "analysis" || taskType === "self_improvement") return "deepseek/deepseek-reasoner";
    return "deepseek/deepseek-chat";
  }

  if (provider.id === "openrouter") {
    if (taskType === "self_improvement") return "anthropic/claude-sonnet-4";
    if (taskType === "code") return "anthropic/claude-sonnet-4";
    if (taskType === "analysis") return "anthropic/claude-sonnet-4";
    return "anthropic/claude-haiku-4";
  }

  return provider.models[0] || "unknown";
}

// ─── Provider Management ───────────────────────────────────────────────────────

/**
 * Register a new provider dynamically.
 */
export function registerProvider(provider: LLMProvider): void {
  initProviders();
  providers.set(provider.id, provider);
  if (!metrics.has(provider.id)) {
    metrics.set(provider.id, {
      providerId: provider.id,
      totalRequests: 0,
      totalErrors: 0,
      avgLatencyMs: 0,
      p95LatencyMs: 0,
      lastErrorTime: 0,
      lastSuccessTime: 0,
      latencyHistory: [],
      errorRate: 0,
      isHealthy: true,
    });
  }
}

/**
 * Enable/disable a provider.
 */
export function setProviderEnabled(providerId: string, enabled: boolean): boolean {
  initProviders();
  const provider = providers.get(providerId);
  if (!provider) return false;
  provider.enabled = enabled;
  return true;
}

// ─── Diagnostics ───────────────────────────────────────────────────────────────

export function getRouterStats(): {
  providers: Array<{
    id: string;
    name: string;
    enabled: boolean;
    healthy: boolean;
    avgLatencyMs: number;
    errorRate: number;
    totalRequests: number;
  }>;
  recommendedProvider: string;
} {
  initProviders();

  const providerStats = Array.from(providers.values()).map(p => {
    const m = metrics.get(p.id);
    return {
      id: p.id,
      name: p.name,
      enabled: p.enabled,
      healthy: m?.isHealthy ?? true,
      avgLatencyMs: Math.round(m?.avgLatencyMs ?? 0),
      errorRate: Number((m?.errorRate ?? 0).toFixed(3)),
      totalRequests: m?.totalRequests ?? 0,
    };
  });

  let recommended = "deepseek";
  try {
    const decision = selectProvider();
    recommended = decision.provider.id;
  } catch { /* use default */ }

  return { providers: providerStats, recommendedProvider: recommended };
}
