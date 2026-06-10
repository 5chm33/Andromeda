# Andromeda v6.34 — Grade & Changelog

**Release date:** 2026-06-04
**Build:** ✓ clean (6227+ modules) | **Tests:** ✓ 791/791 | **Branches:** master + main

---

## Grade: A− (88/100)

| Dimension | Score | Notes |
|---|---|---|
| RSI Pipeline | 95/100 | Fully closed loop — schedule → propose → CI → apply → proof log |
| Code Quality | 88/100 | Myers diffs, AST chunking, patch round-trip validation |
| Autonomy | 85/100 | Lesson injection, auto-categorisation, multi-model routing |
| UI/UX | 82/100 | RSI Dashboard, nav link, eval trend chart, proposal review panel |
| Infrastructure | 90/100 | Distributed locks, DB layer, GitHub Actions CI |
| Safety | 92/100 | Constitution guard, syntax check, rollback, retry cap |

---

## What was built in v6.34

### 1. Proposal Auto-Categorisation
**File:** `server/selfImprove.ts`

Heuristic classifier runs before the LLM call, mapping filename patterns to proposal areas:
- `security.ts`, `auth.ts`, `guard.ts` → `security` → Claude (OpenRouter)
- `planner.ts`, `orchestrator.ts`, `goal*.ts` → `architecture` → Claude (OpenRouter)
- `llmProvider.ts`, `modelRegistry.ts` → `performance` → Kimi
- `*Routes.ts`, `*Controller.ts` → `feature` → Kimi
- Everything else → `readability` → DeepSeek

Multi-model routing now fires automatically without any manual `area` parameter.

### 2. RSI Nav Link in Sidebar
**File:** `client/src/components/DashboardLayout.tsx`

Added "RSI Dashboard" entry with `Activity` icon to the main sidebar navigation. Users can now reach `/rsi` from anywhere in the app without knowing the URL.

### 3. Eval Baseline Auto-Run Fix
**File:** `server/_core/initModules.ts`

The auto-baseline now checks whether the stored score is ≥ 5% before skipping. If the stored baseline is < 5% (e.g., written during a failed 401 run), it re-runs the eval automatically on next startup. This permanently fixes the "2% baseline" issue from the uploaded v6.26 zip.

### 4. Patch-Based Apply (Myers Diff)
**File:** `server/selfImprove.ts`

Replaced the ad-hoc string-replace apply with `applyPatch()` from the `diff` npm package:
- Generates a proper Myers unified diff (`diff -u` format) for every proposal
- Validates the diff round-trips correctly before storing it
- Logs whether patch-based or content-based apply will be used
- Falls back to `proposedContent` string if `applyPatch()` throws or mismatches

---

## API changes

No breaking changes. All existing endpoints unchanged.

New behaviour:
- `GET /api/rsi/proposals` — response now includes `"source": "db" | "json"` field
- `GET /api/rsi/history` — response now includes `"source": "db" | "json"` field
- Server startup log now includes `[AutoBaseline] v6.34: Valid baseline exists (XX.X%)` or re-runs if stale

---

## v6.35 — Next Sprint

1. **Vision-first browser automation** — screenshot → LLM identifies element → click by coordinate (replaces fragile CSS selector fallback)
2. **Multi-agent parallel dispatch** — task planner detects parallelisable steps and dispatches to sub-agents automatically
3. **Tool synthesis** — RSI can propose new tool implementations (not just edits to existing files)
4. **Capability growth metrics** — track which task categories improve across RSI cycles and surface them in the dashboard
