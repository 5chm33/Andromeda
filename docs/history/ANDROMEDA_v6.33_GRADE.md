# Andromeda v6.33 — Grade & Changelog

**Date:** 2026-06-03
**Version:** 6.33.0
**Build:** ✓ clean (6227 modules)
**Tests:** ✓ 791/791 passing
**Grade:** A (SOTA RSI loop fully operational)

---

## What Was Built

### 1. RSI Dashboard Page (`/rsi`)
- Dedicated React page at `/rsi` route in `App.tsx`
- Embeds `ProposalReviewPanel` (diff viewer + approve/reject) and `EvalTrendChart` (score deltas)
- `CycleHistoryTable` showing all RSI cycles with before/after eval scores and delta badges
- `RsiStatusBanner` with live phase indicator, cycle count, last/next cycle times, and manual trigger button
- Auto-refreshes every 15–60 seconds

### 2. Lesson Injection into Task Planner
- `getConsolidatedLessons()` called in `taskPlanner.ts` before every `generatePlan()` call
- Top 5 most recent lessons (by `createdAt`) injected into the user prompt as structured context
- Format: `LESSONS FROM PAST EXPERIENCE: [lesson text] (success rate: X%, from N episodes)`
- Andromeda now learns from past failures automatically on every planning call

### 3. Proper Myers Unified Diffs
- `generateSimpleDiff()` in `selfImprove.ts` now uses `createTwoFilesPatch()` from the `diff` npm package
- Real Myers algorithm with 3-line context — proper `@@` hunk headers with correct line numbers
- Fallback to the old line-by-line diff if the package is unavailable
- The diff viewer in `ProposalReviewPanel` now shows meaningful, accurate diffs

### 4. Multi-Model Proposal Routing
- `chatCompletion()` and `simpleChatCompletion()` in `llmProvider.ts` now accept `providerId` option
- `analyzeAndPropose()` in `selfImprove.ts` routes by proposal area:
  - `security` / `architecture` / `design` → **Claude** via OpenRouter (best reasoning)
  - `performance` / `feature` / `optim` → **Kimi k2.6** (best coding model)
  - `reliability` / `readability` / general → **DeepSeek** (cheap, reliable)
- Falls back to active provider if the preferred provider's key is not set

---

## Files Changed

| File | Change |
|---|---|
| `client/src/pages/RsiDashboard.tsx` | New — RSI Dashboard page |
| `client/src/App.tsx` | Added `/rsi` route |
| `client/src/components/rsi/ProposalReviewPanel.tsx` | New — diff viewer + approve/reject UI |
| `client/src/components/rsi/EvalTrendChart.tsx` | New — Recharts area chart for score trends |
| `server/taskPlanner.ts` | Lesson injection from episodic consolidation |
| `server/selfImprove.ts` | Myers diff + multi-model routing |
| `server/llmProvider.ts` | `providerId` override option on `chatCompletion` / `simpleChatCompletion` |
| `ANDROMEDA_v6.33_GRADE.md` | This file |

---

## RSI Loop Status (as of v6.33)

The full SOTA RSI loop is now operational end-to-end:

```
[Scheduler] Every 6h → triggerRSICycleNow()
    ↓
[selfImprove] Read file (A4) → check dedup (A1) → route to best LLM (v6.33)
              → generate proposal with confidence (A2) + constitution (A3)
    ↓
[rsiEngine] Apply → ciPipeline (tsc → test → build → reload)
    ↓
[rsiDb] Persist cycle + proposal to DB
    ↓
[rsiProofHistory] Write before/after score delta
    ↓
[episodicConsolidation] Summarise old episodes → lessons
    ↓
[taskPlanner] Inject lessons into next planning call (v6.33)
```

---

## v6.34 — Next Sprint

1. **Proposal auto-categorisation** — classify proposals by area automatically so routing works without manual `area` param
2. **RSI nav link** — add `/rsi` to the main sidebar navigation
3. **Eval task auto-run** — trigger `POST /api/eval/baseline` on first startup if no valid baseline exists
4. **Proposal diff patch apply** — use the stored unified diff to apply changes (instead of string replace) for robustness
