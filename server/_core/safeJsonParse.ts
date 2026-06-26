/**
 * safeJsonParse — crash-safe JSON.parse wrapper.
 *
 * Returns the parsed value on success, or `fallback` (default: null) on any
 * parse error.  Eliminates the risk of an LLM returning malformed JSON and
 * crashing the daemon process.
 *
 * Usage:
 *   const data = safeJsonParse<MyType>(rawString) ?? defaultValue;
 */
export function safeJsonParse<T = unknown>(text: string, fallback?: T): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback !== undefined ? fallback : null;
  }
}
