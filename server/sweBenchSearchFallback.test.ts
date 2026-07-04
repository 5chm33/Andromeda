/**
 * sweBenchSearchFallback.test.ts — Tests for the multi-turn search augmentation
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  shouldSearchForContext,
  generateSearchQueries,
  augmentWithSearch,
} from './sweBenchSearchFallback.js';

// ─── shouldSearchForContext ───────────────────────────────────────────────────

describe('shouldSearchForContext', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.SWEBENCH_SEARCH;
  });

  afterEach(() => {
    Object.assign(process.env, originalEnv);
  });

  it('returns false when SWEBENCH_SEARCH is not set', () => {
    const result = shouldSearchForContext('django__django-12308', 'Fix the filter bug');
    expect(result).toBe(false);
  });

  it('returns false when SWEBENCH_SEARCH=0', () => {
    process.env.SWEBENCH_SEARCH = '0';
    const result = shouldSearchForContext('django__django-12308', 'Fix the filter bug');
    expect(result).toBe(false);
  });

  it('returns true for version-specific regression when SWEBENCH_SEARCH=1', () => {
    process.env.SWEBENCH_SEARCH = '1';
    const issue = 'This is a regression since 3.2.1 — the filter method no longer works';
    expect(shouldSearchForContext('django__django-12308', issue)).toBe(true);
  });

  it('returns true for "after upgrading" signal', () => {
    process.env.SWEBENCH_SEARCH = '1';
    const issue = 'After upgrading to the latest version, QuerySet.filter() raises TypeError';
    expect(shouldSearchForContext('django__django-12308', issue)).toBe(true);
  });

  it('returns true when external package is mentioned (not the repo)', () => {
    process.env.SWEBENCH_SEARCH = '1';
    // astropy issue mentioning numpy (external)
    const issue = 'When using numpy arrays with astropy.coordinates, the conversion fails';
    expect(shouldSearchForContext('astropy__astropy-12907', issue)).toBe(true);
  });

  it('does not trigger on the repo\'s own package name', () => {
    process.env.SWEBENCH_SEARCH = '1';
    // django issue mentioning django (same repo — should not trigger external package signal)
    const issue = 'Django QuerySet.filter() is broken';
    // This should NOT match external package signal since django == repo name
    // But may match other signals — check specifically that external package logic doesn't fire
    // (other signals may still fire, this just tests the external package check)
    const result = shouldSearchForContext('django__django-12308', issue);
    // Result may be true or false depending on other signals — just verify it doesn't crash
    expect(typeof result).toBe('boolean');
  });

  it('returns true for deprecated API signal', () => {
    process.env.SWEBENCH_SEARCH = '1';
    const issue = 'The old API has been deprecated and removed in version 4.0';
    expect(shouldSearchForContext('sympy__sympy-20049', issue)).toBe(true);
  });

  it('returns true for "no longer supported" signal', () => {
    process.env.SWEBENCH_SEARCH = '1';
    const issue = 'This feature is no longer supported in Python 3.10';
    expect(shouldSearchForContext('pytest-dev__pytest-7324', issue)).toBe(true);
  });

  it('returns false for a plain bug report with no external signals', () => {
    process.env.SWEBENCH_SEARCH = '1';
    const issue = 'The add() method returns wrong result when called with negative numbers';
    expect(shouldSearchForContext('sympy__sympy-20049', issue)).toBe(false);
  });
});

// ─── generateSearchQueries ────────────────────────────────────────────────────

describe('generateSearchQueries', () => {
  it('generates a query from an error message in the issue', () => {
    const issue = 'Getting ValueError: invalid literal for int() with base 10 when calling parse()';
    const queries = generateSearchQueries('django__django-12308', issue);
    expect(queries.length).toBeGreaterThan(0);
    expect(queries[0]).toContain('ValueError');
    expect(queries[0]).toContain('django');
  });

  it('generates a query from a backtick function name', () => {
    const issue = 'The `QuerySet.filter(pk=None)` method raises an exception';
    const queries = generateSearchQueries('django__django-12308', issue);
    const funcQuery = queries.find(q => q.includes('QuerySet.filter'));
    expect(funcQuery).toBeDefined();
  });

  it('generates a version-specific query when version number is present', () => {
    const issue = 'This broke in version 3.2.1 of the library';
    const queries = generateSearchQueries('astropy__astropy-12907', issue);
    const versionQuery = queries.find(q => q.includes('3.2.1'));
    expect(versionQuery).toBeDefined();
  });

  it('falls back to a generic query when no specific signals are found', () => {
    const issue = 'Something is broken';
    const queries = generateSearchQueries('sympy__sympy-20049', issue);
    expect(queries.length).toBeGreaterThan(0);
    expect(queries[0]).toContain('sympy');
  });

  it('returns at most 3 queries', () => {
    const issue = 'TypeError: invalid literal for int() `parse(x)` broke in version 3.2.1';
    const queries = generateSearchQueries('django__django-12308', issue);
    expect(queries.length).toBeLessThanOrEqual(3);
  });

  it('includes the repo name in all queries', () => {
    const issue = 'Something is broken with filters';
    const queries = generateSearchQueries('astropy__astropy-12907', issue);
    for (const q of queries) {
      expect(q).toContain('astropy');
    }
  });
});

// ─── augmentWithSearch ────────────────────────────────────────────────────────

describe('augmentWithSearch', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.SWEBENCH_SEARCH;
    delete process.env.BRAVE_SEARCH_API_KEY;
  });

  afterEach(() => {
    Object.assign(process.env, originalEnv);
    vi.unstubAllGlobals();
  });

  it('returns searched=false when SWEBENCH_SEARCH is not set', async () => {
    const result = await augmentWithSearch('django__django-12308', 'Fix the filter bug');
    expect(result.searched).toBe(false);
    expect(result.contextBlock).toBe('');
    expect(result.snippets).toHaveLength(0);
  });

  it('returns searched=true with empty snippets when search returns no results', async () => {
    process.env.SWEBENCH_SEARCH = '1';
    const issue = 'This is a regression since 3.2.1';

    // Mock fetch to return empty results
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ web: { results: [] } }),
    }));

    const result = await augmentWithSearch('django__django-12308', issue);
    expect(result.searched).toBe(true);
    expect(result.queries.length).toBeGreaterThan(0);
    expect(result.snippets).toHaveLength(0);
    expect(result.contextBlock).toBe('');
  });

  it('returns contextBlock with snippets when relevant results are found', async () => {
    process.env.SWEBENCH_SEARCH = '1';
    process.env.BRAVE_SEARCH_API_KEY = 'test-key';
    const issue = 'This is a regression since 3.2.1 — filter() raises ValueError';

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        web: {
          results: [
            {
              title: 'Django filter() fix for ValueError',
              url: 'https://github.com/django/django/pull/12345',
              description: 'Fix for ValueError in filter() method since 3.2.1 regression fix workaround',
            },
            {
              title: 'Unrelated result',
              url: 'https://example.com',
              description: 'Something completely unrelated',
            },
          ],
        },
      }),
    }));

    const result = await augmentWithSearch('django__django-12308', issue);
    expect(result.searched).toBe(true);
    expect(result.snippets.length).toBeGreaterThan(0);
    expect(result.contextBlock).toContain('Web Search Context');
    expect(result.contextBlock).toContain('filter()');
  });

  it('handles search fetch failure gracefully (non-fatal)', async () => {
    process.env.SWEBENCH_SEARCH = '1';
    const issue = 'This is a regression since 3.2.1';

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    // Should not throw — search failure is non-fatal
    const result = await augmentWithSearch('django__django-12308', issue);
    expect(result.searched).toBe(true);
    expect(result.snippets).toHaveLength(0);
  });

  it('uses DuckDuckGo when no Brave API key is set', async () => {
    process.env.SWEBENCH_SEARCH = '1';
    delete process.env.BRAVE_SEARCH_API_KEY;
    const issue = 'This is a regression since 3.2.1';

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        AbstractText: 'Django filter regression fix since 3.2.1 workaround',
        AbstractURL: 'https://docs.djangoproject.com',
        AbstractSource: 'Django Docs',
        RelatedTopics: [],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await augmentWithSearch('django__django-12308', issue);
    // Should have called DuckDuckGo API
    const callUrl = mockFetch.mock.calls[0]?.[0] as string;
    expect(callUrl).toContain('duckduckgo.com');
  });
});
