/**
 * apiRateLimiter.ts — v51.0.0
 *
 * Token-bucket rate limiter for external API calls with per-API
 * configuration, burst support, and backoff recommendations.
 */

export interface RateLimitConfig {
  apiId: string;
  requestsPerMinute: number;
  burstSize?: number;  // max tokens above steady-state
}

export interface RateLimitStatus {
  apiId: string;
  tokensAvailable: number;
  requestsPerMinute: number;
  nextRefillAt: number;
  throttled: boolean;
  recommendedBackoffMs: number;
}

interface TokenBucket {
  config: RateLimitConfig;
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, TokenBucket>();

export function configureRateLimit(config: RateLimitConfig): void {
  const burstSize = config.burstSize ?? Math.ceil(config.requestsPerMinute / 10);
  buckets.set(config.apiId, {
    config,
    tokens: burstSize,
    lastRefill: Date.now(),
  });
}

function refillBucket(bucket: TokenBucket): void {
  const now = Date.now();
  const elapsed = (now - bucket.lastRefill) / 1000 / 60; // minutes
  const refill = elapsed * bucket.config.requestsPerMinute;
  const maxTokens = bucket.config.burstSize ?? Math.ceil(bucket.config.requestsPerMinute / 10);
  bucket.tokens = Math.min(maxTokens, bucket.tokens + refill);
  bucket.lastRefill = now;
}

export function tryAcquire(apiId: string, tokens = 1): boolean {
  const bucket = buckets.get(apiId);
  if (!bucket) {
    // Auto-configure with a conservative default
    configureRateLimit({ apiId, requestsPerMinute: 60 });
    return tryAcquire(apiId, tokens);
  }

  refillBucket(bucket);

  if (bucket.tokens >= tokens) {
    bucket.tokens -= tokens;
    return true;
  }
  return false;
}

export function getStatus(apiId: string): RateLimitStatus {
  const bucket = buckets.get(apiId);
  if (!bucket) {
    return { apiId, tokensAvailable: 0, requestsPerMinute: 0, nextRefillAt: 0, throttled: true, recommendedBackoffMs: 1000 };
  }

  refillBucket(bucket);
  const throttled = bucket.tokens < 1;
  const msPerToken = (60 * 1000) / bucket.config.requestsPerMinute;
  const tokensNeeded = Math.max(0, 1 - bucket.tokens);
  const recommendedBackoffMs = throttled ? Math.ceil(tokensNeeded * msPerToken) : 0;

  return {
    apiId,
    tokensAvailable: Math.floor(bucket.tokens),
    requestsPerMinute: bucket.config.requestsPerMinute,
    nextRefillAt: bucket.lastRefill + msPerToken,
    throttled,
    recommendedBackoffMs,
  };
}

export function _resetRateLimiterForTest(): void {
  buckets.clear();
}
