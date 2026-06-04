# Andromeda v6.35 — Grade & Changelog

**Release date:** 2026-06-04
**Version:** 6.35.0
**Build:** ✓ clean (6228 modules)
**Tests:** ✓ 791/791 passing
**Grade: A−**

---

## What Was Built

### 1. Vision-First Browser Automation (`server/tools/browserTools.ts`)

The browser click pipeline was inverted: **vision-first is now the default**, CSS selector is the fallback.

- `browser_click` now calls `browserClickVision()` first — takes a screenshot, sends it to the LLM with the element description, gets back coordinates, clicks at those coordinates
- CSS selector fallback fires only if vision returns no result
- New composite tool: `browser_navigate_and_click` — navigate to URL, wait for load, then vision-click in one atomic call
- Eliminates stale selector failures on dynamic SPAs and shadow DOM elements

### 2. Multi-Agent Parallel Dispatch (`server/taskPlanner.ts`)

Two new exported functions added to the task planner:

- `detectParallelGroups(steps)` — topological sort on `step.dependsOn[]` to find groups of steps with no mutual dependencies
- `dispatchParallelSteps(group, context)` — dispatches each independent step to a sub-agent via `multiAgent.ts`, collects results, merges outputs
- Steps with no `dependsOn` are automatically eligible for parallel execution
- Reduces multi-step task wall-clock time by up to N× for independent subtasks

### 3. Tool Synthesis (`server/toolSynthesis.ts`)

RSI can now propose entirely new tool implementations, not just edits to existing files:

- `synthesizeNewTool(spec)` — LLM generates a full TypeScript tool file from a description + schema
- Output written to `server/tools/synthesized/{toolName}.ts`
- `loadSynthesizedTools()` called on startup — dynamically imports and registers all synthesized tools
- `registerSynthesizedTool(tool)` — adds the tool to the live tool registry without restart
- RSI proposal generator now includes `server/tools/synthesized/` as a valid target directory

### 4. Capability Growth Metrics (`client/src/components/rsi/CapabilityGrowthChart.tsx`)

New dashboard component with two views:

- **Radar view** — spider chart showing before/after scores across all categories for the latest cycle
- **Trend view** — multi-line chart showing per-category score progression across all cycles
- **Delta table** — shows exact before→after numbers with colour-coded delta for each category
- Data source: `GET /api/rsi/proof-history` (per-category scores now stored in `rsi_proof_history.json`)
- Auto-refreshes every 60 seconds
- Embedded in the RSI Dashboard at `/rsi`

---

## RSI Architecture Status (v6.35)

The full SOTA recursive self-improvement loop is now operational:

```
Scheduler (6h cron)
  → analyzeAndPropose (multi-model routing: DeepSeek/Kimi/Claude)
    → dedup hash + confidence filter (≥0.8)
      → constitution guard + TypeScript check
        → ciPipeline (tsc → test → build → hot-reload)
          → rsiDb persist (Postgres/MySQL or JSON fallback)
            → proofHistory delta (per-category scores)
              → episodicConsolidation (7-day summarisation)
                → lesson injection (top 5 lessons in every plan)
                  → importGraph (find all callers before multi-file change)
                    → toolSynthesis (new tools when needed)
                      → CapabilityGrowthChart (visible proof of improvement)
```

---

## Cumulative Changelog (v6.27 → v6.35)

| Version | Key Feature |
|---------|-------------|
| v6.27 | Zod validation across all 7 route files (25 schemas) |
| v6.28 | RSI activation: dedup, confidence scoring, constitution-aware generation, file-aware generation, env validation |
| v6.29 | AST chunking (TypeScript Compiler API), multi-file atomic proposals, proof history logging, 70 eval tasks |
| v6.30 | Postgres/SQLite DB layer, Redis distributed locks, CI/CD pipeline, import graph |
| v6.31 | Lock migration (4 modules), DB read path live, import graph in prompt, GitHub Actions CI |
| v6.32 | RSI auto-trigger scheduler, Proposal Review UI, eval trend chart, episodic memory consolidation |
| v6.33 | RSI Dashboard page, lesson injection, Myers unified diffs, multi-model routing |
| v6.34 | Auto-categorisation, RSI nav link, baseline auto-run fix, patch-based apply |
| v6.35 | Vision-first browser, multi-agent parallel dispatch, tool synthesis, capability growth chart |

---

## Next: v6.36

1. **Unsupervised goal discovery** — Andromeda identifies its own capability gaps from eval failures and creates improvement goals without human input
2. **Meta-learning** — track which proposal categories have the highest success rate and bias generation toward them
3. **Constitutional AI alignment** — expand the constitution with learned constraints from past failures
4. **Cross-session context persistence** — full conversation and task history survives server restarts via the DB layer
