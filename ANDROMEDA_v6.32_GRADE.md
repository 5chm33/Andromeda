# Andromeda v6.32 — Grade & Changelog

**Release date:** 2026-06-03
**Version:** 6.32.0
**Build:** ✓ clean (5817 modules, 18.48s)
**Tests:** ✓ 791/791 passing
**Grade:** A− (RSI loop now fully operational end-to-end)

---

## What Was Built

### 1. RSI Auto-Trigger Scheduler (`server/rsiScheduler.ts`)
A persistent cron-based scheduler that fires `triggerRSICycleNow()` on a configurable interval (default 6 hours). Survives server restarts by persisting state to `data/rsi_scheduler_state.json`. Fully controllable via API:

| Endpoint | Action |
|---|---|
| `GET /api/rsi/scheduler` | Status, next run time, run count |
| `POST /api/rsi/scheduler/trigger` | Fire immediately |
| `POST /api/rsi/scheduler/pause` | Pause auto-trigger |
| `POST /api/rsi/scheduler/resume` | Resume auto-trigger |
| `POST /api/rsi/scheduler/set-hours` | Change interval (1–168h) |

### 2. Proposal Review UI (`client/src/components/rsi/ProposalReviewPanel.tsx`)
A React panel with:
- Syntax-highlighted unified diff view (green additions, red deletions)
- Colour-coded confidence badge (green ≥90%, yellow ≥70%, red <70%)
- Secondary changes accordion (shows all files in a multi-file proposal)
- Approve / Reject buttons with loading states
- Scheduler status bar with Pause/Resume/Run-now controls
- Auto-refreshes every 30 seconds

### 3. Eval Score Trending Chart (`client/src/components/rsi/EvalTrendChart.tsx`)
A recharts AreaChart that reads from `GET /api/rsi/proof-history` and shows:
- **Score view**: before/after eval score per cycle (sky blue vs emerald)
- **Delta view**: score delta per cycle (violet area chart with zero reference line)
- Summary stats bar: total cycles, avg delta, best delta, total applied
- Auto-refreshes every 60 seconds

### 4. Cross-Session Episodic Memory Consolidation (`server/episodicConsolidation.ts`)
Runs on startup and every 24 hours:
- Scans `workspace/memory/episodes.jsonl` for entries older than 7 days
- Groups them by goal/tag cluster
- LLM summarises each cluster into a consolidated lesson
- Saves lessons to `workspace/memory/consolidated_lessons.json`
- Rewrites `episodes.jsonl` without consolidated entries (prevents unbounded growth)

| Endpoint | Action |
|---|---|
| `GET /api/memory/episodic/stats` | Consolidation stats |
| `GET /api/memory/episodic/lessons` | Query consolidated lessons |
| `POST /api/memory/episodic/consolidate` | Force consolidation run |

---

## New Files
- `server/rsiScheduler.ts` — RSI auto-trigger cron scheduler
- `server/episodicConsolidation.ts` — Cross-session episodic memory consolidation
- `client/src/components/rsi/ProposalReviewPanel.tsx` — Proposal review UI
- `client/src/components/rsi/EvalTrendChart.tsx` — Eval score trending chart

## Modified Files
- `server/routes/selfRoutes.ts` — +8 new endpoints (approve/reject/scheduler/proof-history/episodic)
- `server/_core/initModules.ts` — +2 startup hooks (episodic consolidation, RSI scheduler)

---

## RSI Loop Status

| Stage | Status |
|---|---|
| Proposal generation | ✓ File-aware, constitution-aware, confidence-scored |
| Deduplication | ✓ Hash-based, seeded from persisted store |
| Safety guard | ✓ Constitution + TypeScript check |
| Apply | ✓ Atomic multi-file with rollback |
| CI validation | ✓ 4-stage pipeline (typecheck → test → build → reload) |
| Proof logging | ✓ Before/after score delta to `data/rsi_proof_history.json` |
| Auto-trigger | ✓ Configurable cron (default 6h) |
| UI review | ✓ Diff viewer + Approve/Reject |
| Score trending | ✓ Recharts area chart |
| Memory consolidation | ✓ 7-day episodic → lesson compression |

**The RSI loop is now fully operational.** On next server start, Andromeda will automatically trigger improvement cycles every 6 hours, apply high-confidence proposals through the CI pipeline, and build a growing proof history of measurable score improvements.

---

## v6.33 — Next Sprint

1. **RSI Dashboard page** — Dedicated `/rsi` route in the client that embeds `ProposalReviewPanel` + `EvalTrendChart` + cycle history table in one view
2. **Lesson injection into context** — Feed `consolidated_lessons.json` into the task planner context so Andromeda learns from past failures automatically
3. **Proposal diff generation** — Generate proper unified diffs (not just proposed content) so the diff viewer shows meaningful line-level changes
4. **Multi-model proposal routing** — Route different proposal types to the best model (DeepSeek for code, Kimi for reasoning, Claude for architecture)
