# Andromeda v6.31 — Grade & Changelog

**Version:** 6.31.0  
**Build:** ✓ clean (5817 modules)  
**Tests:** ✓ 791/791  
**Released:** 2026-06-03

---

## Grade: A−

v6.31 completes the infrastructure wiring that v6.30 introduced as standalone modules.
Every new component is now fully integrated into the live execution path.

---

## What Was Built

### 1. Distributed Lock Migration (4 modules)

All four long-running background loop modules now use `redisLock.ts` wrappers instead
of raw `let isRunning = false` boolean guards:

| Module | Lock name | Previous guard |
|---|---|---|
| `autoGoalSuggester.ts` | `withAutoGoalLock` | `let isRunning = false` |
| `continuousImprover.ts` | `withContinuousImproverLock` | `let isRunning = false` |
| `selfHeal.ts` | `withSelfHealLock` | `let isRunning = false` |
| `autonomyOrchestrator.ts` | `withOrchestratorLock` | `let isRunning = false` |

When `REDIS_URL` is set, these become true distributed locks (safe for multi-instance
deployments). When `REDIS_URL` is absent, they fall back to the in-process `Map<string,Promise>`
implementation in `redisLock.ts` — no behaviour change in single-instance mode.

### 2. DB Read Path Wired

Both primary RSI data endpoints now read from the database when available:

- `GET /api/rsi/proposals` — reads via `dbLoadProposals()` first, falls back to JSON store
- `GET /api/rsi/history` — reads via `dbLoadCycles(100)` first, falls back to `getRSIHistory()`

Response includes a `"source": "db" | "json"` field so you can see which path was used.

### 3. Import Graph → Proposal Generator

`selfImprove.ts` now calls `getExportedSymbols()` + `findSymbolUsages()` from `importGraph.ts`
before every LLM call. The results are injected into the system prompt as:

```
IMPORT GRAPH — exported symbols from this file and where they are used:
  - analyzeAndPropose: used in rsiEngine.ts, continuousImprover.ts
  - autoApplyHighConfidence: used in rsiEngine.ts (+1 more)
If you change a function signature, add secondaryChanges entries for each caller file.
```

The LLM prompt schema now includes `"secondaryChanges"` as an optional field, so the
generator will automatically propose atomic multi-file changes when a signature changes.

### 4. GitHub Actions CI Workflow

`.github/workflows/rsi-validate.yml` — mirrors `ciPipeline.ts` as a cloud CI workflow:

| Stage | Command |
|---|---|
| TypeScript typecheck | `pnpm exec tsc --noEmit` |
| Test suite | `pnpm test --run` |
| Build | `pnpm run build` |
| Smoke test | start server → `curl /health` → assert HTTP 200 |

Runs on every push to `master`/`main` and every pull request. RSI-applied commits are
validated in the cloud before they can be merged.

---

## Cumulative RSI Readiness (v6.28 → v6.31)

| Capability | v6.27 | v6.28 | v6.29 | v6.30 | v6.31 |
|---|---|---|---|---|---|
| Proposal deduplication | ✗ | ✓ | ✓ | ✓ | ✓ |
| Confidence scoring | ✗ | ✓ | ✓ | ✓ | ✓ |
| Constitution-aware generation | ✗ | ✓ | ✓ | ✓ | ✓ |
| File-aware generation | ✗ | ✓ | ✓ | ✓ | ✓ |
| AST-based chunking | ✗ | ✗ | ✓ | ✓ | ✓ |
| Multi-file atomic proposals | ✗ | ✗ | ✓ | ✓ | ✓ |
| RSI proof history logging | ✗ | ✗ | ✓ | ✓ | ✓ |
| 70-task eval suite | ✗ | ✗ | ✓ | ✓ | ✓ |
| Postgres/DB persistence | ✗ | ✗ | ✗ | ✓ | ✓ |
| Distributed locks | ✗ | ✗ | ✗ | ✓ (module) | ✓ (wired) |
| DB read path live | ✗ | ✗ | ✗ | ✗ | ✓ |
| Import graph in prompt | ✗ | ✗ | ✗ | ✗ | ✓ |
| GitHub Actions CI | ✗ | ✗ | ✗ | ✗ | ✓ |

---

## v6.32 — Next Sprint

1. **RSI auto-trigger on schedule** — cron job that fires `triggerRSICycleNow()` every 6 hours
   automatically (currently requires manual `POST /api/rsi/trigger`)
2. **Proposal review UI** — a minimal React panel in the client that lists pending proposals,
   shows diffs, and has Approve / Reject buttons (currently only accessible via API)
3. **Eval score trending** — chart in the UI showing the before/after score delta from
   `data/rsi_proof_history.json` over time
4. **Cross-session memory consolidation** — episodic memory entries older than 7 days are
   summarised and moved to the long-term knowledge base automatically
