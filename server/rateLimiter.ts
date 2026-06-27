/**
 * rateLimiter.ts — v79.0.0 "API Gateway & Integration"
 * Token-bucket rate limiter with per-client and per-route limits.
 */
export interface RateLimitPolicy {
  policyId: string;
  name: string;
  requestsPerWindow: number;
  windowMs: number;
}

export interface RateLimitState {
  clientId: string;
  policyId: string;
  tokens: number;
  windowStart: number;
  totalRequests: number;
  totalBlocked: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  reason?: string;
}

const policies = new Map<string, RateLimitPolicy>();
const states = new Map<string, RateLimitState>();

export function createPolicy(policyId: string, name: string, requestsPerWindow: number, windowMs: number): RateLimitPolicy {
  const policy: RateLimitPolicy = { policyId, name, requestsPerWindow, windowMs };
  policies.set(policyId, policy);
  return policy;
}

export function checkRateLimit(clientId: string, policyId: string, now = Date.now()): RateLimitResult {
  const policy = policies.get(policyId);
  if (!policy) return { allowed: false, remaining: 0, resetAt: now, reason: "Policy not found" };

  const stateKey = `${clientId}:${policyId}`;
  let state = states.get(stateKey);

  if (!state || now - state.windowStart >= policy.windowMs) {
    state = { clientId, policyId, tokens: policy.requestsPerWindow, windowStart: now, totalRequests: 0, totalBlocked: 0 };
    states.set(stateKey, state);
  }

  state.totalRequests++;

  if (state.tokens > 0) {
    state.tokens--;
    return { allowed: true, remaining: state.tokens, resetAt: state.windowStart + policy.windowMs };
  }

  state.totalBlocked++;
  return { allowed: false, remaining: 0, resetAt: state.windowStart + policy.windowMs, reason: "Rate limit exceeded" };
}

export function getState(clientId: string, policyId: string): RateLimitState | undefined { return states.get(`${clientId}:${policyId}`); }
export function getPolicy(policyId: string): RateLimitPolicy | undefined { return policies.get(policyId); }
export function _resetRateLimiterForTest(): void { policies.clear(); states.clear(); }
