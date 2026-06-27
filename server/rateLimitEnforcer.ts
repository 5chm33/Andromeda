/**
 * rateLimitEnforcer.ts — v68.0.0 "Real-World Integration III"
 * Token bucket and sliding window rate limiting with per-key quotas.
 */

export type RateLimitAlgorithm = "token_bucket" | "sliding_window";
export interface RateLimitPolicy { key: string; algorithm: RateLimitAlgorithm; maxRequests: number; windowMs: number; }
export interface RateLimitResult { allowed: boolean; remaining: number; resetAt: number; retryAfterMs?: number; }

interface TokenBucket { tokens: number; lastRefill: number; }
interface SlidingWindow { timestamps: number[]; }

const policies = new Map<string, RateLimitPolicy>();
const tokenBuckets = new Map<string, TokenBucket>();
const slidingWindows = new Map<string, SlidingWindow>();

export function defineRateLimit(policy: RateLimitPolicy): void { policies.set(policy.key, policy); }

export function checkRateLimit(policyKey: string, identifier: string): RateLimitResult {
  const policy = policies.get(policyKey);
  if (!policy) return { allowed: true, remaining: Infinity, resetAt: 0 };
  const storeKey = `${policyKey}:${identifier}`;
  const now = Date.now();
  if (policy.algorithm === "token_bucket") {
    if (!tokenBuckets.has(storeKey)) tokenBuckets.set(storeKey, { tokens: policy.maxRequests, lastRefill: now });
    const bucket = tokenBuckets.get(storeKey)!;
    const elapsed = now - bucket.lastRefill;
    const refill = Math.floor(elapsed / policy.windowMs) * policy.maxRequests;
    bucket.tokens = Math.min(policy.maxRequests, bucket.tokens + refill);
    if (refill > 0) bucket.lastRefill = now;
    if (bucket.tokens >= 1) { bucket.tokens--; return { allowed: true, remaining: bucket.tokens, resetAt: bucket.lastRefill + policy.windowMs }; }
    return { allowed: false, remaining: 0, resetAt: bucket.lastRefill + policy.windowMs, retryAfterMs: policy.windowMs - elapsed };
  } else {
    if (!slidingWindows.has(storeKey)) slidingWindows.set(storeKey, { timestamps: [] });
    const win = slidingWindows.get(storeKey)!;
    win.timestamps = win.timestamps.filter(t => now - t < policy.windowMs);
    if (win.timestamps.length < policy.maxRequests) { win.timestamps.push(now); return { allowed: true, remaining: policy.maxRequests - win.timestamps.length, resetAt: now + policy.windowMs }; }
    const oldest = win.timestamps[0];
    return { allowed: false, remaining: 0, resetAt: oldest + policy.windowMs, retryAfterMs: oldest + policy.windowMs - now };
  }
}

export function _resetRateLimitEnforcerForTest(): void { policies.clear(); tokenBuckets.clear(); slidingWindows.clear(); }
