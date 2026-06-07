/**
 * fetchWithRetry.ts — v9.2.0
 *
 * A drop-in replacement for fetch() that automatically retries on transient
 * server errors (5xx, 429) and network failures with exponential back-off.
 *
 * Usage:
 *   const response = await fetchWithRetry("/api/search/deep", { method: "POST", ... });
 */

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const DEFAULT_MAX_RETRIES = 2;
const BASE_DELAY_MS = 1000;

export interface FetchWithRetryOptions extends RequestInit {
  /** Maximum number of retry attempts (default: 2) */
  maxRetries?: number;
  /** Base delay in ms before first retry; doubles each attempt (default: 1000) */
  baseDelayMs?: number;
  /** Called before each retry with the attempt number (1-indexed) */
  onRetry?: (attempt: number, error: Error | null, status?: number) => void;
}

/**
 * Fetch with automatic retry on transient errors.
 * Does NOT retry on AbortError (user cancelled) or 4xx client errors (except 429).
 */
export async function fetchWithRetry(
  input: RequestInfo | URL,
  options: FetchWithRetryOptions = {},
): Promise<Response> {
  const {
    maxRetries = DEFAULT_MAX_RETRIES,
    baseDelayMs = BASE_DELAY_MS,
    onRetry,
    ...fetchOptions
  } = options;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(input, fetchOptions);

      // If the status is retryable and we have attempts left, retry
      if (!response.ok && RETRYABLE_STATUSES.has(response.status) && attempt < maxRetries) {
        lastError = new Error(`HTTP ${response.status}`);
        const delay = baseDelayMs * Math.pow(2, attempt);
        onRetry?.(attempt + 1, lastError, response.status);
        await sleep(delay);
        continue;
      }

      // Return the response (even if not ok — let caller handle 4xx etc.)
      return response;
    } catch (err) {
      const error = err as Error;

      // Never retry on AbortError
      if (error.name === "AbortError") throw error;

      lastError = error;

      // Retry on network errors if we have attempts left
      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        onRetry?.(attempt + 1, error);
        await sleep(delay);
        continue;
      }

      throw error;
    }
  }

  // Should never reach here, but TypeScript needs this
  throw lastError ?? new Error("fetchWithRetry: exhausted retries");
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
