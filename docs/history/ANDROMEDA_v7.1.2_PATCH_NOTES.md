# Andromeda v7.1.2 — QoL Patch Notes

**Released:** 2026-06-04
**Type:** Quality-of-Life / Bug Fix Patch
**Tests:** 791 passed | **Build:** Clean (19.5s)

---

## Summary

This patch resolves the remaining runtime noise and proposal-loop issues observed in the v7.1.1 logs. All 4 fixes address root causes, not symptoms.

---

## Fixes

### 1. Stale Version Tags Eliminated

| File | Old Tag | New Tag |
|---|---|---|
| `server/selfImprove.ts` | `[v6.28 A5]` | `[v7.1]` |
| `server/_core/initDaemons.ts` | `[v5.68]` | `[v7.1]` |
| `Andromeda Launcher.bat` | `Andromeda AI v7.0` | `Andromeda AI v7.1` |

**Impact:** Startup logs now consistently show `v7.1` across all modules. No more confusion about which version is running.

---

### 2. Syntax Check False-Positives Fixed

**Root cause:** `selfImproveGuard.ts` runs a syntax check by copying the proposed file to `data/tmp_syntax/` and running `tsc --noEmit` on it in isolation. Since the file is outside the project tree, TypeScript cannot resolve any local imports (`./fileEngineChunking.js`, `./aiTokens.js`, etc.) and throws `TS2307: Cannot find module` — even for perfectly valid proposals.

**Fix:** Added `--noResolve` flag to the isolated `tsc` call. This makes TypeScript check only the syntax of the file itself without attempting to resolve imports.

**Before:**
```
Syntax check failed: data/tmp_syntax/browser.ts(274,36): error TS2802
Syntax check failed: data/tmp_syntax/selfImprove.ts(27,32): error TS2307: Cannot find module './fileEngineChunking'
Syntax check failed: data/tmp_syntax/ai.ts(16,15): error TS2307: Cannot find module './aiTokens.js'
```

**After:** Valid proposals pass the syntax check. Only genuine syntax errors (malformed TypeScript) are caught.

---

### 3. Stale Constitution-Blocked Proposals Auto-Expire

**Root cause:** `prop_1779762103380_ozxr4x` (adaptiveRouter.ts health check fix) has been blocked **10 times** by the old `process.env.DEEPSEEK_API_KEY` constitution pattern. Since the proposal never changes, it will loop forever — retrying every 6 hours and being blocked every time.

**Fix:** Added auto-expiry logic to `selfImproveGuard.ts`. Proposals that are constitution-blocked **3 or more times** are automatically rejected and removed from the pending queue. They will not be retried.

```
[Guard] Auto-expired proposal prop_1779762103380_ozxr4x after 3 constitution blocks
```

**Note:** The constitution pattern itself was already fixed in v7.1.1 — `process.env.DEEPSEEK_API_KEY` is no longer forbidden. But the stale proposal in your local `data/` directory still contains the old content. After upgrading to v7.1.2, the proposal will be auto-expired on its next retry attempt (within 6 hours), and a fresh proposal for the same fix will be generated in the next RSI cycle.

---

### 4. Overall System Health After This Patch

With v7.1.2 running:

| Component | Status |
|---|---|
| Watchdog (17 modules) | All healthy — no more false-positive critical alerts |
| Orchestrator cycles | 0 errors per cycle (was 1 error/cycle from watchdog cascade) |
| Syntax check | Passes for all valid proposals — no more TS2307 false failures |
| Constitution | Precise patterns — no false positives on `process.env`, `token`, `password` |
| Stale proposals | Auto-expire after 3 blocks — no more infinite retry loops |
| Version tags | All logs show `v7.1` consistently |
| Launcher banner | Shows `Andromeda AI v7.1` |

---

## Full Autonomy Checklist

| Feature | Status |
|---|---|
| RSI cycles every 6h | Active |
| Auto-apply high-confidence proposals | Active |
| Post-improvement auto-rebuild | Active (requires `AUTO_REBUILD=true`) |
| GitHub PR auto-merge after CI | Active (requires `PR_AUTO_MERGE=true`) |
| RLHF feedback from PR open/close | Active |
| Watchdog self-healing | Active |
| Adaptive eval benchmark generation | Active |
| Federated node sync | Active (requires `FEDERATED_ENABLED=true`) |
| Cross-session context persistence | Active |

---

## Next Steps (v7.2 Horizon)

- **RLHF replay loop** — feed closed-PR rejection signals back into the proposal generator's system prompt
- **Proposal diversity enforcement** — prevent the RSI from fixating on the same file for 3+ consecutive cycles
- **Eval score trending** — show week-over-week capability score improvement in the dashboard
- **Multi-model consensus** — require 2/3 LLM providers to agree before auto-applying a proposal
