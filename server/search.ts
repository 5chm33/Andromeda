import axios from "axios";
import type { SearchSource } from "../drizzle/schema";

// v5.34: Search result cache — avoid redundant API calls for repeated queries
const searchCache = new Map<string, { results: SearchSource[]; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_ENTRIES = 100;

function getCachedResults(key: string): SearchSource[] | null {
  const entry = searchCache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
    return entry.results;
  }
  if (entry) searchCache.delete(key); // Expired
  return null;
}

function setCachedResults(key: string, results: SearchSource[]): void {
  // Evict oldest entries if cache is full
  if (searchCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = Array.from(searchCache.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
    if (oldest) searchCache.delete(oldest[0]);
  }
  searchCache.set(key, { results, timestamp: Date.now() });
}

// Periodic cache cleanup
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of Array.from(searchCache.entries())) {
    if (now - entry.timestamp > CACHE_TTL) searchCache.delete(key);
  }
}, 60_000).unref();

// Public SearXNG instances (free fallback) — large pool with per-instance cooldown
// v5.52: Expanded pool + cooldown tracking so rate-limited instances are skipped automatically
const SEARXNG_INSTANCE_POOL = [
  "https://search.inetol.net",
  "https://paulgo.io",
  "https://search.mdosch.de",
  "https://searx.tiekoetter.com",
  "https://opnxng.com",
  "https://searx.lunar.icu",
  "https://searx.namejeff.xyz",
  "https://search.rhscz.eu",
  "https://searx.prvcy.eu",
  "https://searx.ox2.fr",
  "https://searx.sev.monster",
  "https://search.sapti.me",
  "https://searxng.world",
  "https://search.ononoki.org",
];

// Per-instance cooldown tracking — skip instances that recently returned 429/403
const searxngCooldowns = new Map<string, number>(); // instance → cooldown expiry timestamp
const SEARXNG_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

function getAvailableSearXNGInstances(): string[] {
  const now = Date.now();
  return SEARXNG_INSTANCE_POOL.filter(inst => {
    const cooldown = searxngCooldowns.get(inst);
    return !cooldown || now > cooldown;
  });
}

function markSearXNGCooldown(instance: string): void {
  searxngCooldowns.set(instance, Date.now() + SEARXNG_COOLDOWN_MS);
  console.debug(`[SearXNG] Instance ${instance} on cooldown for 10min`);
}

// Known high-credibility domains
const CREDIBILITY_RULES = {
  high: [
    "wikipedia.org", "britannica.com", "nature.com", "science.org",
    "pubmed.ncbi.nlm.nih.gov", "scholar.google.com", "arxiv.org",
    "bbc.com", "reuters.com", "apnews.com", "nytimes.com",
    "theguardian.com", "washingtonpost.com", "economist.com",
    ".gov", ".edu", "who.int", "cdc.gov", "nih.gov",
    "mit.edu", "stanford.edu", "harvard.edu", "oxford.ac.uk",
    "github.com", "stackoverflow.com", "developer.mozilla.org",
    "docs.python.org", "nodejs.org", "react.dev", "mdn.io",
  ],
  low: [
    "reddit.com", "quora.com", "yahoo.answers.com",
    "buzzfeed.com", "dailymail.co.uk", "thesun.co.uk",
  ],
};

export function getCredibility(domain: string): "high" | "medium" | "low" {
  const lower = domain.toLowerCase();
  for (const hd of CREDIBILITY_RULES.high) {
    if (lower.includes(hd)) return "high";
  }
  for (const ld of CREDIBILITY_RULES.low) {
    if (lower.includes(ld)) return "low";
  }
  return "medium";
}

export function extractDomain(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function getFavicon(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
}

// ─── Brave Search API (primary — $5/1000 queries) ────────────────────────────
// v8.4.0: searchBrave is only called when BRAVE_SEARCH_ENABLED=true OR when explicitly
// passed { useBrave: true } to aggregateSearch. Never called automatically.
export async function searchBrave(
  query: string,
  filter = "all",
  count = 10
): Promise<SearchSource[]> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) {
    console.warn("[Brave] No API key configured, skipping");
    return [];
  }

  try {
    // Map filter to Brave search_type
    const freshness = filter === "news" ? "pd" : undefined; // past day for news

    const params: Record<string, string | number> = {
      q: query,
      count,
      safesearch: "off",
      text_decorations: "false",
    };
    if (freshness) params.freshness = freshness;

    const response = await axios.get("https://api.search.brave.com/res/v1/web/search", {
      params,
      timeout: 8000,
      // v5.52 FIX: Remove Accept-Encoding: gzip — on Windows Node.js 24, axios with gzip
      // header returns a binary Buffer instead of parsed JSON, causing 0 results.
      // axios handles decompression automatically via decompress:true (the default).
      decompress: true,
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": apiKey,
      },
      // v5.11: Accept 4xx so we can handle rate limits explicitly
      validateStatus: (status) => status < 500,
    });

    // v5.11: Explicit rate limit handling — log and return empty to trigger SearXNG fallback
    if (response.status === 429) {
      console.warn("[Brave] Rate limited (429) — falling back to SearXNG");
      return [];
    }
    if (response.status === 401 || response.status === 403) {
      console.warn(`[Brave] Auth failure (${response.status}) — check BRAVE_SEARCH_API_KEY`);
      return [];
    }
    if (!response.data) {
      console.warn(`[Brave] Unexpected status ${response.status}`);
      return [];
    }

    const webResults = response.data?.web?.results ?? [];
    const newsResults = filter === "news" ? (response.data?.news?.results ?? []) : [];

    const combined = [...webResults, ...newsResults];

    return combined.slice(0, count).map((r: any) => {
      const domain = extractDomain(r.url || "");
      return {
        title: r.title || domain,
        url: r.url || "",
        snippet: r.description || r.extra_snippets?.[0] || "",
        domain,
        favicon: r.meta_url?.favicon || getFavicon(domain),
        credibility: getCredibility(domain),
        publishedAt: r.page_age || r.age,
        source: "Brave",
      } satisfies SearchSource;
    }).filter((r: SearchSource) => r.url && r.snippet);
  } catch (err) {
    console.warn("[Brave] Search failed:", (err as Error).message);
    return [];
  }
}

// ─── SearXNG (free fallback / academic supplement) ───────────────────────────
export async function searchSearXNG(query: string, filter = "all"): Promise<SearchSource[]> {
  const categories = filter === "news" ? "news" : filter === "academic" ? "science" : "general";

  // v5.52: Use cooldown-aware instance pool — skip recently rate-limited instances
  const available = getAvailableSearXNGInstances();
  if (available.length === 0) {
    console.warn("[SearXNG] All instances on cooldown — skipping");
    return [];
  }

  // Shuffle to distribute load across instances
  const shuffled = [...available].sort(() => Math.random() - 0.5);

  for (const instance of shuffled) {
    try {
      const response = await axios.get(`${instance}/search`, {
        params: { q: query, format: "json", categories, language: "en", safesearch: 0 },
        timeout: 6000,
        decompress: true,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "application/json, text/javascript, */*; q=0.01",
          "Accept-Language": "en-US,en;q=0.9",
        },
        validateStatus: (status) => status < 600,
      });

      // Mark rate-limited instances on cooldown
      if (response.status === 429 || response.status === 403) {
        markSearXNGCooldown(instance);
        continue;
      }

      if (response.status !== 200 || !response.data?.results) continue;

      const results: SearchSource[] = (response.data.results || [])
        .slice(0, 8)
        .map((r: any) => {
          const domain = extractDomain(r.url || "");
          return {
            title: r.title || domain,
            url: r.url || "",
            snippet: r.content || "",
            domain,
            favicon: getFavicon(domain),
            credibility: getCredibility(domain),
            publishedAt: r.publishedDate,
            source: "SearXNG",
          } satisfies SearchSource;
        })
        .filter((r: SearchSource) => r.url && r.snippet);

      if (results.length > 0) return results;
    } catch {
      // SearXNG instance unavailable — silently try next (expected for public instances)
    }
  }
  return [];
}

// ─── Aggregate: Brave primary + SearXNG supplement ───────────────────────────
//
// v8.4.0 COST CONTROL: Brave Search is NEVER called automatically.
// It is only called when the caller explicitly passes { useBrave: true }.
// The default path (standard chat queries) uses SearXNG only, which is free.
// Brave is reserved for:
//   - User explicitly selects "Web" or "News" filter
//   - User explicitly clicks "Deep Research"
//   - Programmatic callers that pass { useBrave: true }
//
// This prevents the $120/2-day runaway cost from background daemons,
// AutoBaseline evals, and conversational queries all hitting Brave.
export async function aggregateSearch(
  query: string,
  filter = "all",
  maxResults = 12,
  options: { useBrave?: boolean } = {}
): Promise<SearchSource[]> {
  // v5.34: Check cache first
  const cacheKey = `${query}:${filter}:${maxResults}`;
  const cached = getCachedResults(cacheKey);
  if (cached) {
    console.log(`[Search] Cache hit for: "${query.slice(0, 40)}..."`);
    return cached;
  }

  // v8.4.0: Only call Brave when explicitly opted in.
  // SearXNG is free — use it as the default. Brave is paid — opt-in only.
  const shouldUseBrave = options.useBrave === true;

  const [braveResults, searxResults] = await Promise.allSettled([
    shouldUseBrave ? searchBrave(query, filter, 10) : Promise.resolve([]),
    searchSearXNG(query, filter),
  ]);

  const brave = braveResults.status === "fulfilled" ? braveResults.value : [];
  const searx = searxResults.status === "fulfilled" ? searxResults.value : [];

  // v5.51: DuckDuckGo HTML fallback when both Brave and SearXNG return nothing
  let ddg: SearchSource[] = [];
  // v8.4.0: Only run DDG fallback when SearXNG actually returned nothing AND we expected results.
  // Skip DDG entirely for conversational queries (they return [] by design, not by failure).
  if (brave.length === 0 && searx.length === 0 && maxResults > 0) {
    const braveMsg = shouldUseBrave ? (braveResults.status === "rejected" ? braveResults.reason : "returned 0 results") : "skipped (opt-in only)";
    const searxErr = searxResults.status === "rejected" ? searxResults.reason : "returned 0 results";
    console.warn("[Search] Primary sources failed — Brave:", braveMsg, "| SearXNG:", searxErr, "| Trying DuckDuckGo fallback...");
    try {
      // v5.52: Use DDG JSON API instead of HTML scraping (HTML returns CAPTCHA on server)
      // DDG instant answer API: free, no auth, returns structured JSON
      const ddgResp = await fetch(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1&t=Andromeda`,
        { headers: { "User-Agent": "Andromeda/5.52 (search fallback)" }, signal: AbortSignal.timeout(8000) }
      );
      const ddgData = await ddgResp.json() as any;

      // DDG instant answer API returns RelatedTopics for general queries
      const topics: any[] = ddgData?.RelatedTopics ?? [];
      const flatTopics = topics.flatMap((t: any) => {
        if (t.Topics) return t.Topics; // nested topic group
        return [t];
      });

      ddg = flatTopics
        .filter((t: any) => t.FirstURL && t.Text && t.Text.length > 20)
        .slice(0, 8)
        .map((t: any) => {
          const url = t.FirstURL || "";
          const domain = extractDomain(url);
          return {
            title: t.Text?.split(" - ")[0]?.trim() || domain,
            url,
            snippet: t.Text || "",
            domain,
            favicon: getFavicon(domain),
            credibility: getCredibility(domain),
            source: "DuckDuckGo",
          } satisfies SearchSource;
        })
        .filter((r: SearchSource) => r.url.startsWith("http") && r.snippet.length > 20);

      // Also include the abstract if available
      if (ddgData?.AbstractText && ddgData?.AbstractURL) {
        const absDomain = extractDomain(ddgData.AbstractURL);
        ddg.unshift({
          title: ddgData.Heading || absDomain,
          url: ddgData.AbstractURL,
          snippet: ddgData.AbstractText,
          domain: absDomain,
          favicon: getFavicon(absDomain),
          credibility: getCredibility(absDomain),
          source: "DuckDuckGo",
        } satisfies SearchSource);
      }

      if (ddg.length > 0) console.log(`[Search] DuckDuckGo fallback returned ${ddg.length} results.`);
      else console.warn("[Search] DuckDuckGo fallback also returned 0 results.");
    } catch (err) {
      console.warn("[Search] DuckDuckGo fallback failed:", (err as Error).message);
    }
  }

  // Brave first, then SearXNG supplements if Brave is thin, then DDG as last resort
  const all: SearchSource[] = [...brave];
  if (brave.length < 6) all.push(...searx);
  if (all.length === 0) all.push(...ddg);

  // Deduplicate by URL
  const seen = new Set<string>();
  const deduped = all.filter((r) => {
    const key = r.url.split("?")[0]; // ignore query params
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // v5.14: Quality threshold — filter out results with empty/useless content
  const qualityFiltered = deduped.filter(r => {
    // Must have a title with at least 3 characters
    if (!r.title || r.title.trim().length < 3) return false;
    // Must have a snippet with at least 20 characters (otherwise useless to the LLM)
    if (!r.snippet || r.snippet.trim().length < 20) return false;
    // Must have a valid URL
    if (!r.url || !r.url.startsWith("http")) return false;
    return true;
  });

  // Sort: high credibility first, then by source (Brave > SearXNG)
  const credOrder = { high: 0, medium: 1, low: 2 };
  qualityFiltered.sort((a, b) => {
    const credDiff = credOrder[a.credibility || "medium"] - credOrder[b.credibility || "medium"];
    if (credDiff !== 0) return credDiff;
    return (a.source === "Brave" ? 0 : 1) - (b.source === "Brave" ? 0 : 1);
  });

  const finalResults = qualityFiltered.slice(0, maxResults);

  // v5.34: Cache results
  setCachedResults(cacheKey, finalResults);

  return finalResults;
}

// ─── Deep Research: parallel multi-query search ───────────────────────────────
export async function deepResearchSearch(
  queries: string[]
): Promise<{ query: string; sources: SearchSource[] }[]> {
  const results = await Promise.allSettled(
    queries.map(async (q) => ({
      query: q,
      sources: await aggregateSearch(q, "all", 8, { useBrave: true }),  // v8.4.0: Brave OK for explicit deep research
    }))
  );

  return results
    .filter((r): r is PromiseFulfilledResult<{ query: string; sources: SearchSource[] }> =>
      r.status === "fulfilled"
    )
    .map((r) => r.value);
}
