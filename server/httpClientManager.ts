/**
 * httpClientManager.ts — v66.0.0 "Real-World Integration"
 * Managed HTTP client with retry, exponential backoff, request logging, and response caching.
 */

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export interface HttpRequest { url: string; method?: HttpMethod; headers?: Record<string, string>; body?: unknown; timeoutMs?: number; retries?: number; }
export interface HttpResponse { url: string; method: HttpMethod; statusCode: number; headers: Record<string, string>; body: string; durationMs: number; attempts: number; fromCache: boolean; }

const requestLog: HttpResponse[] = [];
const cache = new Map<string, { response: HttpResponse; expiresAt: number }>();
const CACHE_TTL = 60_000;

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function httpRequest(req: HttpRequest): Promise<HttpResponse> {
  const method = req.method ?? "GET";
  const timeout = req.timeoutMs ?? 10000;
  const maxRetries = req.retries ?? 2;
  const cacheKey = method === "GET" ? `${method}:${req.url}` : null;
  if (cacheKey) {
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return { ...cached.response, fromCache: true };
  }
  let lastError = "";
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    const start = Date.now();
    try {
      const fetchOptions: RequestInit = { method, headers: req.headers ?? {} };
      if (req.body) fetchOptions.body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
      const res = await fetchWithTimeout(req.url, fetchOptions, timeout);
      const body = await res.text();
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => { headers[k] = v; });
      const response: HttpResponse = { url: req.url, method, statusCode: res.status, headers, body: body.slice(0, 50000), durationMs: Date.now() - start, attempts: attempt, fromCache: false };
      requestLog.push(response);
      if (cacheKey && res.status === 200) cache.set(cacheKey, { response, expiresAt: Date.now() + CACHE_TTL });
      return response;
    } catch (e: unknown) {
      lastError = e instanceof Error ? e.message : String(e);
      if (attempt <= maxRetries) await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 100));
    }
  }
  const response: HttpResponse = { url: req.url, method, statusCode: 0, headers: {}, body: lastError, durationMs: 0, attempts: maxRetries + 1, fromCache: false };
  requestLog.push(response);
  return response;
}

export function getRequestLog(): HttpResponse[] { return [...requestLog]; }
export function clearCache(): void { cache.clear(); }
export function _resetHttpClientManagerForTest(): void { requestLog.length = 0; cache.clear(); }
