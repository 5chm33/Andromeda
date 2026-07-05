/**
 * sweBenchSearchFallback.ts — Multi-Turn Search Augmentation (v1.1.0)
 *
 * For SWE-bench instances where the issue involves external library behavior,
 * API changes, or undocumented edge cases, a web search step before patch
 * generation can provide critical context that the LLM doesn't have in its
 * training data.
 *
 * This module:
 *   1. Analyzes the issue description to determine if a search would help
 *   2. Generates targeted search queries (library name + error message)
 *   3. Fetches search results via Tavily (primary, AI-optimized) with
 *      Brave Search and DuckDuckGo as fallbacks
 *   4. Extracts relevant snippets and appends them to the patch generation prompt
 *
 * Integration point: called from generateInitialPatch() in run_swebench.ts
 * when SWEBENCH_SEARCH=1 env var is set.
 *
 * v1.1.0 (Fix 25): Tavily is now the primary search provider. Tavily is
 * AI-optimized and returns higher-quality, more relevant snippets than
 * Brave or DuckDuckGo for technical queries. Falls back to Brave then DDG.
 *
 * Search is intentionally conservative — only triggered when:
 *   - The issue mentions a specific version number (e.g. "since 3.2.1")
 *   - The issue mentions an external package (not the repo being fixed)
 *   - The issue contains an error message that looks like an upstream bug
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchAugmentation {
  /** Whether search was performed */
  searched: boolean;
  /** Queries that were run */
  queries: string[];
  /** Relevant snippets extracted */
  snippets: string[];
  /** Full context string to append to the patch generation prompt */
  contextBlock: string;
}

// ─── Search Trigger Heuristics ────────────────────────────────────────────────

/**
 * Determines whether a web search would likely help for this instance.
 * Returns true when the issue has signals that external documentation matters.
 */
export function shouldSearchForContext(
  instanceId: string,
  issueDescription: string
): boolean {
  if (process.env.SWEBENCH_SEARCH !== '1') return false;

  const text = issueDescription.toLowerCase();

  // Signal 1: Version-specific regression ("since 3.2", "in version 4.1", "after upgrading")
  if (/since\s+\d+\.\d+|in\s+version\s+\d+|after\s+upgrad|regression\s+in/.test(text)) return true;

  // Signal 2: External package name mentioned (not the repo being fixed)
  const repo = instanceId.split('__')[0].toLowerCase();
  const externalPackages = ['numpy', 'scipy', 'pandas', 'matplotlib', 'sklearn',
    'torch', 'tensorflow', 'PIL', 'pillow', 'requests', 'urllib', 'json',
    'yaml', 'toml', 'lxml', 'bs4', 'sqlalchemy', 'celery', 'redis'];
  if (externalPackages.some(pkg => pkg !== repo && text.includes(pkg))) return true;

  // Signal 3: Error message looks like an upstream API change
  if (/deprecated|removed\s+in|no\s+longer\s+supported|api\s+change/.test(text)) return true;

  // Signal 4: Explicit "see issue" or "PR" reference to another repo
  if (/github\.com\/(?!.*instanceId)/.test(issueDescription)) return true;

  return false;
}

/**
 * Generates targeted search queries for a SWE-bench instance.
 * Extracts the most specific error message or API name from the issue.
 */
export function generateSearchQueries(
  instanceId: string,
  issueDescription: string
): string[] {
  const repo = instanceId.split('__')[0];
  const queries: string[] = [];

  // Query 1: Extract error message (first line that looks like an exception)
  const errorMatch = issueDescription.match(/([A-Z][a-zA-Z]+Error|[A-Z][a-zA-Z]+Exception)[:\s]+([^\n]{20,80})/);
  if (errorMatch) {
    queries.push(`${repo} "${errorMatch[1]}" ${errorMatch[2].slice(0, 60)}`);
  }

  // Query 2: Extract function/method name from issue
  const funcMatch = issueDescription.match(/`([a-zA-Z_][a-zA-Z0-9_.]+\([^)]{0,30}\))`/);
  if (funcMatch) {
    queries.push(`${repo} ${funcMatch[1]} bug fix`);
  }

  // Query 3: Version-specific query
  const versionMatch = issueDescription.match(/(\d+\.\d+(?:\.\d+)?)/);
  if (versionMatch) {
    queries.push(`${repo} ${versionMatch[1]} changelog fix`);
  }

  // Fallback: generic query using first 80 chars of issue
  if (queries.length === 0) {
    queries.push(`${repo} ${issueDescription.slice(0, 80).replace(/\n/g, ' ')}`);
  }

  return queries.slice(0, 3);
}

// ─── Search Execution ─────────────────────────────────────────────────────────

/**
 * Performs a web search using Brave Search API.
 * Falls back to DuckDuckGo instant answer API if Brave key is not set.
 */
async function performSearch(query: string): Promise<SearchResult[]> {
  // Fix 25: Tavily is the primary provider (AI-optimized, higher relevance)
  const tavilyKey = process.env.TAVILY_API_KEY;
  if (tavilyKey) {
    try {
      const resp = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: tavilyKey,
          query,
          max_results: 5,
          search_depth: 'basic',
          include_answer: false,
          include_raw_content: false,
        }),
        signal: AbortSignal.timeout(12_000),
      });
      if (resp.ok) {
        const data = (await resp.json()) as any;
        const results: SearchResult[] = (data?.results ?? []).slice(0, 5).map((r: any) => ({
          title: r.title ?? '',
          url: r.url ?? '',
          snippet: (r.content ?? r.snippet ?? '').slice(0, 500),
        }));
        if (results.length > 0) {
          console.log(`[SearchFallback/Tavily] "${query.slice(0, 60)}" → ${results.length} results`);
          return results;
        }
      }
    } catch (err) {
      console.warn(`[SearchFallback/Tavily] Failed, falling back: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Fallback 1: Brave Search
  const braveKey = process.env.BRAVE_SEARCH_API_KEY;
  if (braveKey) {
    return searchViaBrave(query, braveKey);
  }

  // Fallback 2: DuckDuckGo
  return searchViaDuckDuckGo(query);
}

async function searchViaBrave(query: string, apiKey: string): Promise<SearchResult[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5&result_filter=web`;
  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey,
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return [];
    const data = await response.json() as {
      web?: { results?: Array<{ title: string; url: string; description: string }> };
    };
    return (data.web?.results ?? []).map(r => ({
      title: r.title,
      url: r.url,
      snippet: r.description,
    }));
  } catch {
    return [];
  }
}

async function searchViaDuckDuckGo(query: string): Promise<SearchResult[]> {
  // DuckDuckGo instant answer API — free, no key required, limited results
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return [];
    const data = await response.json() as {
      AbstractText?: string;
      AbstractURL?: string;
      AbstractSource?: string;
      RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
    };
    const results: SearchResult[] = [];
    if (data.AbstractText) {
      results.push({
        title: data.AbstractSource ?? query,
        url: data.AbstractURL ?? '',
        snippet: data.AbstractText.slice(0, 500),
      });
    }
    for (const topic of (data.RelatedTopics ?? []).slice(0, 3)) {
      if (topic.Text) {
        results.push({
          title: topic.Text.slice(0, 80),
          url: topic.FirstURL ?? '',
          snippet: topic.Text.slice(0, 300),
        });
      }
    }
    return results;
  } catch {
    return [];
  }
}

// ─── Snippet Extraction ───────────────────────────────────────────────────────

/**
 * Extracts the most relevant snippets from search results.
 * Filters for snippets that contain code, error messages, or fix descriptions.
 */
function extractRelevantSnippets(
  results: SearchResult[],
  issueKeywords: string[]
): string[] {
  const snippets: string[] = [];

  for (const result of results) {
    const text = `${result.title}\n${result.snippet}`;
    const relevance = issueKeywords.filter(kw =>
      text.toLowerCase().includes(kw.toLowerCase())
    ).length;

    if (relevance >= 2 || text.includes('fix') || text.includes('patch') || text.includes('workaround')) {
      snippets.push(`[${result.title}](${result.url})\n${result.snippet}`);
    }
  }

  return snippets.slice(0, 5);
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * Performs search augmentation for a SWE-bench instance.
 * Returns a SearchAugmentation object with the context to append to the prompt.
 *
 * This is the main function called from run_swebench.ts.
 */
export async function augmentWithSearch(
  instanceId: string,
  issueDescription: string
): Promise<SearchAugmentation> {
  const empty: SearchAugmentation = {
    searched: false,
    queries: [],
    snippets: [],
    contextBlock: '',
  };

  if (!shouldSearchForContext(instanceId, issueDescription)) {
    return empty;
  }

  const queries = generateSearchQueries(instanceId, issueDescription);
  const allResults: SearchResult[] = [];

  console.log(`[SearchFallback] Running ${queries.length} search queries for ${instanceId}`);

  for (const query of queries) {
    try {
      const results = await performSearch(query);
      allResults.push(...results);
      console.log(`[SearchFallback]   "${query}" → ${results.length} results`);
    } catch (err) {
      console.warn(`[SearchFallback] Search failed for "${query}":`, err);
    }
  }

  if (allResults.length === 0) {
    return { ...empty, searched: true, queries };
  }

  const issueKeywords = issueDescription
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 4)
    .slice(0, 20);

  const snippets = extractRelevantSnippets(allResults, issueKeywords);

  if (snippets.length === 0) {
    return { ...empty, searched: true, queries };
  }

  const contextBlock = `## Web Search Context (${snippets.length} relevant results)
The following search results may provide context about this issue:

${snippets.join('\n\n---\n\n')}

Use this context only if it directly relates to the bug. Do not copy code from search results.
`;

  console.log(`[SearchFallback] Found ${snippets.length} relevant snippets for ${instanceId}`);

  return {
    searched: true,
    queries,
    snippets,
    contextBlock,
  };
}
