/**
 * webSearch.ts — Web Search Tool
 * Andromeda v6.14
 *
 * Changes in v6.14:
 *  - Brave Search API as primary provider (BRAVE_SEARCH_API_KEY)
 *  - Strict relevance gate: only fires for queries that genuinely need
 *    real-time external data. Self-assessment, code tasks, and internal
 *    reasoning are blocked before any API call is made.
 *  - Default result count reduced from 5 → 3 (configurable via num_results)
 *  - Every search call is cost-logged to console with query + result count
 *  - Fallback chain: Brave → SearXNG → DuckDuckGo instant answer
 */
import { registerTool } from "./toolRegistry";
import type { ToolExecutionContext, ToolResult } from "./toolRegistry";

// ─── Relevance Gate ────────────────────────────────────────────────────────────
// Patterns that indicate a query does NOT need a web search.
const INTERNAL_QUERY_PATTERNS: RegExp[] = [
  /\b(grade|score|assess|evaluat|rate)\s+(your|my|this|andromeda|the\s+code|the\s+project|yourself)\b/i,
  /\b(100\s*\/\s*100|out\s+of\s+100|\/100)\b/i,
  /\b(self.?assess|self.?eval|self.?review|self.?grade|self.?rate)\b/i,
  /\b(my|your|this|andromeda).{0,20}(source\s*code|codebase|server\s*file|\.ts\s*file)\b/i,
  /\b(truncat|self[._-]?modif|react.?engine|llm.?provider|manifest\.ts|ai\.ts)\b/i,
  /\b(what\s+(should|can|do)\s+i|how\s+(should|do)\s+i|next\s+step)\b/i,
  /\bandromeda\s+(v\d|version|feature|capability|architecture|module|tool)\b/i,
];

// Patterns that CONFIRM a query needs a web search (real-time / external data)
const EXTERNAL_QUERY_PATTERNS: RegExp[] = [
  /\b(latest|current|recent|today|now|2024|2025|2026)\b/i,
  /\b(price|cost|stock|weather|news|headline|breaking)\b/i,
  /\b(how\s+to|tutorial|documentation|docs|api\s+reference)\b/i,
  /\b(download|install|release|version\s+\d|changelog)\b/i,
  /\b(who\s+is|what\s+is|where\s+is|when\s+did|why\s+did)\b/i,
  /\b(github\.com|stackoverflow|npm|pypi)\b/i,
  /https?:\/\//i,
];

function shouldBlockSearch(query: string): { blocked: boolean; reason: string } {
  const q = query.trim();
  for (const ext of EXTERNAL_QUERY_PATTERNS) {
    if (ext.test(q)) return { blocked: false, reason: "matches external pattern" };
  }
  for (const pat of INTERNAL_QUERY_PATTERNS) {
    if (pat.test(q)) {
      return { blocked: true, reason: `self-referential or internally-answerable query: "${q.slice(0, 80)}"` };
    }
  }
  const wordCount = q.split(/\s+/).filter(Boolean).length;
  if (wordCount < 2) {
    return { blocked: true, reason: `query too short (${wordCount} word)` };
  }
  return { blocked: false, reason: "passed relevance gate" };
}

// ─── Brave Search ──────────────────────────────────────────────────────────────
async function searchBrave(query: string, count: number): Promise<Array<{ title: string; url: string; snippet: string }>> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) return [];
  const params = new URLSearchParams({ q: query, count: String(count), search_lang: "en", safesearch: "moderate", text_decorations: "false", result_filter: "web" });
  const resp = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
    headers: { Accept: "application/json", "Accept-Encoding": "gzip", "X-Subscription-Token": apiKey },
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) {
    if (resp.status === 401 || resp.status === 403) console.warn(`[Brave] Auth failure (${resp.status}) — check BRAVE_SEARCH_API_KEY`);
    return [];
  }
  const data = (await resp.json()) as any;
  return (data?.web?.results ?? []).slice(0, count).map((r: any) => ({ title: r.title ?? "", url: r.url ?? "", snippet: r.description ?? r.extra_snippets?.[0] ?? "" }));
}

// ─── SearXNG Fallback ──────────────────────────────────────────────────────────
async function searchSearxng(query: string, count: number): Promise<Array<{ title: string; url: string; snippet: string }>> {
  const searxUrl = process.env.SEARXNG_URL;
  if (!searxUrl) return [];
  const resp = await fetch(`${searxUrl}/search?q=${encodeURIComponent(query)}&format=json&engines=google,bing&pageno=1`, { signal: AbortSignal.timeout(10_000) });
  const json = (await resp.json()) as any;
  return (json.results ?? []).slice(0, count).map((r: any) => ({ title: r.title ?? "", url: r.url ?? "", snippet: r.content ?? "" }));
}

// ─── DuckDuckGo Instant Answer Fallback ───────────────────────────────────────
async function searchDDG(query: string, count: number): Promise<Array<{ title: string; url: string; snippet: string }>> {
  const resp = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1&t=Andromeda`, {
    headers: { "User-Agent": "Andromeda/6.14 (search fallback)" },
    signal: AbortSignal.timeout(8_000),
  });
  const data = (await resp.json()) as any;
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  if (data?.AbstractText && data?.AbstractURL) {
    results.push({ title: data.Heading || "DuckDuckGo Abstract", url: data.AbstractURL, snippet: data.AbstractText });
  }
  const topics: any[] = data?.RelatedTopics ?? [];
  const flat = topics.flatMap((t: any) => (t.Topics ? t.Topics : [t]));
  for (const t of flat) {
    if (results.length >= count) break;
    if (t.FirstURL && t.Text && t.Text.length > 20) {
      results.push({ title: t.Text.split(" - ")[0]?.trim() || t.FirstURL, url: t.FirstURL, snippet: t.Text });
    }
  }
  return results.slice(0, count);
}

// ─── Main execute function ─────────────────────────────────────────────────────
async function executeWebSearch(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolResult> {
  const query = String(args.query ?? "").trim();
  const numResults = Math.min(Math.max(Number(args.num_results ?? 3), 1), 10);

  if (!query) return { success: false, output: "", error: "query is required" };

  // ── Relevance gate ────────────────────────────────────────────────────────
  const gate = shouldBlockSearch(query);
  if (gate.blocked) {
    console.log(`[WebSearch] BLOCKED — ${gate.reason}`);
    return {
      success: false,
      output: "",
      error: `Search blocked by relevance gate: ${gate.reason}. Answer from training knowledge or local context instead.`,
    };
  }

  // ── Cost log ──────────────────────────────────────────────────────────────
  // v6.15: Track Brave API query count and estimated cost per session.
  // Brave Search API pricing: $3/1000 queries = $0.003/query.
  const startMs = Date.now();
  const isBrave = !!process.env.BRAVE_SEARCH_API_KEY;
  const provider = isBrave ? "Brave" : process.env.SEARXNG_URL ? "SearXNG" : "DuckDuckGo";
  if (isBrave) {
    (global as any).__braveQueryCount = ((global as any).__braveQueryCount ?? 0) + 1;
    const count: number = (global as any).__braveQueryCount;
    const estimatedCost = (count * 0.003).toFixed(3);
    console.log(`[WebSearch/Brave] QUERY #${count} | ~$${estimatedCost} session cost | "${query.slice(0, 80)}" | max_results: ${numResults}`);
  } else {
    console.log(`[WebSearch] QUERY: "${query}" | max_results: ${numResults} | provider: ${provider}`);
  }

  try {
    let results: Array<{ title: string; url: string; snippet: string }> = [];

    if (process.env.BRAVE_SEARCH_API_KEY) {
      results = await searchBrave(query, numResults);
    }
    if (results.length === 0 && process.env.SEARXNG_URL) {
      console.log("[WebSearch] Brave returned 0 results, trying SearXNG...");
      results = await searchSearxng(query, numResults);
    }
    if (results.length === 0) {
      console.log("[WebSearch] Primary sources empty, trying DuckDuckGo fallback...");
      results = await searchDDG(query, numResults);
    }

    // Quality filter
    results = results.filter((r) => r.title.trim().length >= 3 && r.snippet.trim().length >= 20 && r.url.startsWith("http"));

    const elapsed = Date.now() - startMs;
    console.log(`[WebSearch] DONE — ${results.length} results in ${elapsed}ms`);

    if (results.length === 0) return { success: true, output: "No search results found for this query." };

    const formatted = results.map((r, i) => `[${i + 1}] ${r.title}\n    URL: ${r.url}\n    ${r.snippet}`).join("\n\n");
    return { success: true, output: formatted };
  } catch (err) {
    const elapsed = Date.now() - startMs;
    console.error(`[WebSearch] ERROR after ${elapsed}ms:`, err);
    return { success: false, output: "", error: `Search failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ─── Register ──────────────────────────────────────────────────────────────────
registerTool({
  name: "web_search",
  description: "Search the web for real-time external information. Use ONLY for queries requiring current data, news, documentation, or external facts. Do NOT use for self-assessment, code analysis, or internally-answerable questions.",
  category: "search",
  safety: "safe",
  definition: {
    type: "function",
    function: {
      name: "web_search",
      description: "Search the web using Brave Search API (primary) with SearXNG and DuckDuckGo fallbacks. Returns titles, URLs, and snippets. ONLY call for queries requiring real-time external data. Self-assessment, grading, code analysis, and internal reasoning queries are blocked by the relevance gate.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query. Must be an externally-answerable question requiring real-time data." },
          num_results: { type: "number", description: "Number of results (default: 3, max: 10). Use 3 for most queries." },
        },
        required: ["query"],
      },
    },
  },
  execute: executeWebSearch,
});
