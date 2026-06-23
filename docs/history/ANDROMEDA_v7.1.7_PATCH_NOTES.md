# Andromeda v7.1.7 — Patch Notes

**Released:** 2026-06-07
**Build:** Clean (6228 modules, 27.5s)
**Tests:** 791/791 passed (152 test files)

---

## What Was Fixed

### Fix 1 — Kimi API Key 401 (Root Cause: Old Cached Key)
The Kimi 401 errors were caused by the old API key (`sk-cq...uxmIC`) being cached in the running process.
The new key (`sk-CMKI...`) was confirmed working via direct API test before this release.
After restarting with v7.1.7, the new key is picked up correctly and the 401s stop.

**Verified:** `curl` test to `api.moonshot.ai` with new key returned HTTP 200 with valid response.

---

### Fix 2 — BootIntegrity Crash Flag False Alarm (Windows Ctrl+C)
**File:** `server/_core/index.ts`

**Problem:** On Windows, pressing Ctrl+C in PowerShell/cmd sometimes kills the Node.js process
before the SIGINT handler fires. This left the `.andromeda/.boot_crash_flag` file behind,
causing every subsequent boot to trigger a spurious git rollback.

**Fix:** Added `process.on('beforeExit')` and `process.on('exit')` handlers as safety nets
that call `clearCrashFlag()`. These fire even when SIGINT is not delivered, ensuring the
flag is always cleared on clean exits.

---

### Fix 3 — ContinuousImprover Always Paused
**File:** `server/selfImproveGuard.ts`

**Problem:** The guard's stored config file (`data/self_improve_guard.json`) defaults to
`requireApproval: true`. The `.env.local` has `AUTONOMY_REQUIRE_APPROVAL=false`, but the
orchestrator reads the env var while `ContinuousImprover` reads the stored config — which
was never synced from the env var. Result: ContinuousImprover ran 46 times per day and
skipped every cycle with "Guard is paused."

**Fix:** Added `syncEnvToConfig()` called on first `getGuardConfig()` invocation. It reads
`AUTONOMY_REQUIRE_APPROVAL` from env and updates the stored config if they differ. One-time
sync per process lifetime.

**Expected result:** ContinuousImprover will now run its improvement cycles every 30 minutes
instead of skipping them. This roughly doubles the number of improvement proposals per day.

---

### Fix 4 — Direct Anthropic API Provider (No OpenRouter Dependency)
**File:** `server/llmProvider.ts`

**Problem:** The `anthropic` provider routed all Claude calls through OpenRouter. With zero
OpenRouter credits, every Pro-tier call failed with 402. The `ANTHROPIC_API_KEY` in `.env.local`
was completely unused.

**Fix:** Added `anthropic-direct` provider using `api.anthropic.com/v1/chat/completions`
(OpenAI-compatible endpoint). Updated `getProviderForTier('pro')` to prefer `anthropic-direct`
when `ANTHROPIC_API_KEY` is set, falling back to OpenRouter only if the direct key is absent.

**Verified:** Direct API test returned HTTP 200 with valid Claude Sonnet 4.5 response.

**Cost note:** Claude Sonnet 4.5 via direct API is ~$3/M input tokens, ~$15/M output tokens.
Pro tier is only used for security/auth/orchestration files (~5% of proposals). At current
usage rates (~20 proposals/day), estimated monthly cost is under $1.

---

## Summary of Active LLM Stack (Post v7.1.7)

| Tier | Provider | Model | Cost | Used For |
|------|----------|-------|------|----------|
| Eco | DeepSeek | deepseek-chat | ~$0.14/M | 90%+ of proposals |
| Standard | Kimi k2.6 | kimi-k2.6 | ~$0.60/M | Complex refactoring |
| Pro | Claude Sonnet 4.5 | claude-sonnet-4-5 | ~$3/M input | Security/auth changes |

All three providers are now confirmed working with valid API keys.

---

## No Regressions
- Build: ✓ Clean (6228 modules)
- Tests: ✓ 791/791 passed
- GitHub: Pushed to `main` and `master`
