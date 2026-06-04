# Andromeda v7.1.3 — Patch Notes

**Release date:** 2026-06-04
**Type:** Bug-fix patch — resolves the persistent "1 error per cycle" orchestrator loop

---

## Summary

Every orchestrator cycle was reporting `0 actions, 1 errors`. This patch identifies and fixes all three root causes.

---

## Root Causes Fixed

### 1. ESM env-loading race in `selfImprove.ts` (Phase 1)

**Problem:** `validateEnvKeys` was an IIFE that executed at module-load time. Because ESM static imports are evaluated before `dotenv.config()` runs in `index.ts`, `process.env` was always empty at that point. The function always saw "no LLM API key" and emitted a warning — and in some code paths threw an error — before the user's `.env.local` had been read. This caused the `selfImprove` subsystem to trip the circuit breaker on every cold start.

**Fix:** Converted the IIFE to a deferred `validateEnvKeysOnce()` function (guarded by a `_envValidated` flag) that is called at the top of `analyzeAndPropose()` — i.e., only after the server has fully started and dotenv has loaded.

**Files changed:** `server/selfImprove.ts`

---

### 2. Circuit breaker never reset in `autonomyOrchestrator.ts` (Phase 2)

**Problem:** `recordSubsystemFailure("selfImprove")` was called on error, but `recordSubsystemSuccess("selfImprove")` was never called after a successful analyze/propose run. The circuit breaker threshold is 3 failures; once tripped it enters a 5-minute cooldown. Because success was never recorded, any prior failures permanently disabled the subsystem until a manual restart.

**Fix:** Added `recordSubsystemSuccess("selfImprove")` immediately after the successful analyze/propose block, before `actionsRemaining--`.

**Files changed:** `server/autonomyOrchestrator.ts`

---

### 3. Incompatible `--allowImportingTsExtensions` flag in `selfImproveGuard.ts` (Phase 3)

**Problem:** The isolated `tsc --noEmit` syntax check used `--allowImportingTsExtensions`, which requires `--moduleResolution bundler` to be set. The isolated check does not set that flag (it runs outside the project's `tsconfig.json`), so TypeScript rejected the flag combination and the syntax check always failed — meaning every proposal was rejected at the guard layer before it could be applied.

**Fix:** Removed `--allowImportingTsExtensions` from the `execSync` tsc invocation. The remaining flags (`--noEmit --skipLibCheck --noResolve`) are sufficient for a pure syntax check on an isolated file.

**Files changed:** `server/selfImproveGuard.ts`

---

## Combined Effect

Before this patch, the orchestrator cycle was:

1. `selfImprove` module loads → IIFE fires → no env keys seen → warning/error → circuit breaker trips
2. Circuit breaker never resets → subsystem permanently disabled after 3 cycles
3. Any proposal that did get through → syntax check fails → proposal rejected

After this patch:

1. Env keys are validated on first actual use → no false "no key" errors at startup
2. Successful runs reset the circuit breaker → subsystem stays healthy
3. Syntax check runs cleanly → proposals can pass through the guard

Expected result: orchestrator cycles should report `1+ actions, 0 errors` once LLM API keys are present.

---

## Test Results

- **Build:** Clean (`dist/index.js` — 1.9 MB)
- **Tests:** 791 passed, 0 failed (152 test files)
- **Pre-existing TS errors:** 93 (unchanged from before v6.36, non-blocking)

---

## Upgrade Notes

Drop-in replacement for v7.1.2. No database migrations, no new environment variables, no breaking API changes.

Runtime data files (`.andromeda_proposals.json`, `.andromeda_memory.json`, `self_model.json`, etc.) are preserved unchanged.
