# Andromeda v7.1.6 — Patch Notes

**Released:** 2026-06-07
**Build:** Clean (152 test files, 791 tests, 0 failures)
**Commit:** pending

---

## Summary

This release addresses all three issues identified from the full 23-hour runtime log
(Cycle #12 → Cycle #1183), plus adds a tiered LLM cost model to prevent accidental
credit drain when using paid providers like Claude.

---

## Changes

### Fix 1 — Truncation Retry (`server/selfImprove.ts`)

**Problem:** 8.7% of `selfImprove` cycles failed with either:
- `Failed to parse AI response as JSON` (24 occurrences) — LLM hit token limit mid-JSON
- `AI response missing required fields` (7 occurrences) — LLM returned incomplete schema

**Root cause:** DeepSeek's `deepseek-chat` model occasionally truncates its output when
the JSON proposal is near the 2,000-token limit. The system threw immediately with no retry.

**Fix:** Added `tryParseProposal()` helper and a single retry on failure:
- Detects truncated/incomplete response after the first LLM call
- Retries with `maxTokens: 4000` (double) and a more explicit prompt instructing the model
  to keep snippets under 20 lines to avoid truncation
- Retry uses the same provider fallback chain (auth/billing errors still skip to next provider)
- Expected outcome: error rate drops from ~8.7% to under 1%

### Fix 2 — Proposal Store Size Cap (`server/selfImprove.ts`)

**Problem:** `store.proposals` and `_seenProposalHashes` had no upper bound. Over many
days of running, the proposals JSON file and in-memory set would grow indefinitely,
contributing to the observed event loop lag growth (2.4s → 4.5s over 23 hours).

**Fix:** Added `pruneProposalStore()` called on every `saveProposals()`:
- Hard cap of 500 proposals
- Eviction policy: pending proposals kept first (most valuable), then oldest applied/rejected
- `_seenProposalHashes` set is rebuilt after pruning to stay in sync
- Logs a message when pruning occurs

### Fix 3 — `llm_connectivity` False Alarm (`server/selfHeal.ts`)

**Problem:** The health check only tested DeepSeek's `/models` endpoint. When DeepSeek's
API was slow or the endpoint returned a non-200 (common with rate limiting), the system
reported `llm_connectivity = 0` (critical degradation) even though Kimi and OpenRouter
were working fine. This triggered 260 unnecessary `runHealCycleOnce` calls per day.

**Fix:** Updated the check to test all configured providers in order (DeepSeek → Kimi →
OpenRouter). Returns healthy as soon as any one provider responds successfully.
Also downgraded from `critical: true` to `critical: false` — LLM unavailability is
a degraded state, not a fatal one (the system can still run health checks, memory
consolidation, and goal tracking without LLM access).

### Fix 4 — Event Loop Lag Recovery (`server/selfHeal.ts`)

**Problem:** The `event_loop_lag_ms` recovery handler did nothing — it just returned a
message. The lag grew from 2.4s to 4.5s over 23 hours with no mitigation.

**Fix:** Updated recovery to:
1. Hint V8's garbage collector (if `--expose-gc` is set)
2. Yield the event loop with a 50ms `setTimeout` to let pending I/O drain
3. Returns `success: true` so the health system records the recovery attempt

Note: The primary cause of the lag growth is the unbounded proposal store (Fix 2).
With the 500-proposal cap in place, the lag should stabilize rather than grow linearly.

### Fix 5 — Tiered LLM Cost Model (`server/llmProvider.ts`, `server/selfImprove.ts`)

**Problem:** The multi-model router used Claude (via OpenRouter, ~$3/M tokens) for any
file touching "security/auth/architecture". With no OpenRouter credits, this caused
constant 402 errors. With credits, it would drain them rapidly on routine analysis.

**Fix:** Three explicit tiers with automatic classification:

| Tier | Provider | Cost | Used For |
|------|----------|------|----------|
| **Eco** | DeepSeek → Gemini Flash | ~$0.00–0.14/M | Routine analysis, 95%+ of cycles |
| **Standard** | Kimi k2.6 → DeepSeek Reasoner | ~$0.14–1.00/M | Complex refactoring, multi-file changes |
| **Pro** | Claude Sonnet 4.5 → Kimi | ~$3/M | Security/auth/orchestrator changes only |

**Key behaviors:**
- `LLM_TIER=eco` in `.env.local` forces all calls to Eco tier (useful when conserving credits)
- `LLM_TIER=pro` forces all calls to Pro tier (useful when you want maximum quality)
- Without override, tier is auto-selected based on the improvement area
- Pro tier falls back to Kimi or DeepSeek if OpenRouter has no credits (no more 402 crashes)
- Fallback chain always ends with cheapest available provider

**New exports from `llmProvider.ts`:**
- `getProviderForTier(tier: "eco" | "standard" | "pro"): string`
- `tierForArea(area?: string): "eco" | "standard" | "pro"`

---

## Expected Outcomes After This Release

| Metric | Before v7.1.6 | Expected After |
|--------|--------------|----------------|
| selfImprove error rate | 8.7% | < 1% |
| llm_connectivity false alarms | 260/day | ~0/day |
| Event loop lag at 23h | ~4,500ms | < 2,500ms (stabilized) |
| Proposal store growth | Unbounded | Capped at 500 |
| Claude credit drain | Uncontrolled | Only on explicit Pro tier |

---

## Upgrade Notes

No breaking changes. Drop-in replacement for v7.1.5.

Optional: Add `LLM_TIER=eco` to `.env.local` to force all self-improvement cycles to
use DeepSeek only (zero OpenRouter credit usage, maximum cost savings).
