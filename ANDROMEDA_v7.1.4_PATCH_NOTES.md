# Andromeda v7.1.4 — Patch Notes

**Release date:** 2026-06-05
**Build:** clean · 791/791 tests passing · 1.9 MB dist

---

## Root Cause (diagnosed from uploaded runtime files)

After v7.1.3 shipped, the system correctly detected all four LLM API keys on
startup (`[v7.1.3] LLM keys present: DeepSeek, OpenRouter, Anthropic, Kimi ✓`).
However, the memory file showed a new, different error appearing from Cycle #7
onward:

```
Orchestrator cycle #7: 1 error(s): Self-improvement failed:
LLM API error 402: {"error":{"message":"Insufficient credits.
Add more using https://openrouter.ai/settings/credits","code":402}}
```

The multi-model router in `selfImprove.ts` (v6.33) routes files whose names
contain `llm`, `model`, `provider`, `router`, `security`, `auth`, `guard`, or
`constitution` to the **Anthropic/Claude provider via OpenRouter**. When
OpenRouter returns a 402 (no credits), the single `simpleChatCompletion()` call
threw immediately, propagating the error up to the orchestrator, which recorded
it as a cycle error and incremented the circuit breaker failure counter.

This was a **real API billing issue**, not a code bug — but the code had no
fallback strategy, so a single provider outage caused 100% of affected cycles
to fail.

---

## Fix — `server/selfImprove.ts`

**Replaced** `pickProviderForArea()` (returns a single provider ID or
`undefined`) with `buildProviderFallbackChain()` (returns an ordered list of
provider IDs to try in sequence).

**Replaced** the single `await simpleChatCompletion(…)` call with a `for` loop
that iterates through the fallback chain and catches 401/402 errors per
provider, logging a warning and continuing to the next provider rather than
throwing.

### Fallback order by area

| Area | Priority 1 | Priority 2 | Priority 3 |
|------|-----------|-----------|-----------|
| security / architecture / design | anthropic (OpenRouter) | deepseek | kimi |
| performance / feature / optimization | kimi | deepseek | anthropic |
| reliability / readability / general | deepseek | kimi | anthropic |
| (no area) | deepseek | kimi | anthropic |

Only providers whose API keys are present in the environment are added to the
chain. If all providers fail with auth/billing errors, the last error is
re-thrown (preserving the original behaviour for non-auth errors).

### Error classification

An error is classified as auth/billing (and triggers a retry) if its message
matches any of:

- `/40[12]/` — HTTP 401 or 402 status code in the message
- `/authentication/i` — "Authentication Fails" (DeepSeek/Kimi format)
- `/insufficient.*credit/i` — "Insufficient credits" (OpenRouter format)
- `/invalid.*key/i` — "invalid API key" (generic format)

All other errors (network timeouts, 500s, malformed JSON, etc.) are re-thrown
immediately without trying the next provider.

---

## Expected behaviour after this patch

| Scenario | Before v7.1.4 | After v7.1.4 |
|----------|--------------|-------------|
| OpenRouter 402 (no credits) | Throws → circuit breaker trips → 1 error/cycle | Logs warning, retries with DeepSeek → 0 errors |
| DeepSeek 401 (invalid key) | Throws → 1 error/cycle | Logs warning, retries with Kimi or OpenRouter |
| All providers fail with 401/402 | Throws with first error | Throws with last error (same end result, but all providers tried) |
| Non-auth error (500, timeout) | Throws immediately | Throws immediately (unchanged) |

---

## Files changed

| File | Change |
|------|--------|
| `server/selfImprove.ts` | `pickProviderForArea` → `buildProviderFallbackChain`; single call → fallback loop |
| `package.json` | Version `7.1.3` → `7.1.4` |

---

## Stats

- Build: clean (no errors, pre-existing warnings only)
- Tests: **791 passed, 0 failed** (152 test files)
- Dist size: 1.9 MB
