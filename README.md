# Andromeda v11.292.0

> **Fully autonomous recursive self-improvement AI agent** — commits and pushes its own code improvements to GitHub every 5 minutes, unsupervised.

---

## What This Is

Andromeda is a production-grade AI agent server that **modifies and improves its own source code** using a multi-stage RSI (Recursive Self-Improvement) pipeline. It is not a demo or a proof of concept — it has made over 200 autonomous commits to its own codebase, including real security fixes, performance improvements, and architectural refactors.

The agent runs 24/7, analyzes its own modules, proposes improvements, validates them through a guard pipeline (shadow tests, TypeScript check, targeted vitest), commits the passing changes, and pushes them to GitHub — all without human intervention.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Andromeda Server                             │
│                                                                     │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────────┐   │
│  │  RSI Engine  │──▶│  Guard Layer │──▶│  Git Auto-Commit     │   │
│  │  (propose)   │   │  (validate)  │   │  + GitHub Push       │   │
│  └──────────────┘   └──────────────┘   └──────────────────────┘   │
│         │                  │                       │               │
│  ┌──────▼──────┐   ┌───────▼──────┐   ┌──────────▼───────────┐   │
│  │  LLM Tier   │   │  Shadow Test │   │  RLHF Feedback Loop  │   │
│  │  Routing    │   │  (in-place   │   │  (reward model)      │   │
│  │  flash/pro  │   │   vitest)    │   │                      │   │
│  └─────────────┘   └─────────────┘   └──────────────────────┘   │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                    207 Analyzable Modules                    │  │
│  │  Each has a .test.ts file · Targeted tests run in ~440ms    │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### RSI Pipeline (per cycle)

1. **ANALYZE** — Select a file from 207 analyzable modules, read its content and test file
2. **PROPOSE** — Generate an improvement using DeepSeek v4-flash (or v4-pro for core RSI files)
3. **SHADOW TEST** — Write proposed content to disk, run `vitest` on the target test file in-place, restore original if tests fail
4. **GUARD** — TypeScript check, syntax validation, self-consistency check (skipped for low-risk proposals)
5. **APPLY** — Write the new content to the live source file
6. **COMMIT** — `git commit` with structured message, then `git push` to GitHub
7. **RLHF** — Record the improvement in `data/rlhf_feedback.jsonl` for reward model training

---

## Quick Start

```bash
# 1. Clone
git clone https://github.com/5chm33/Andromeda.git
cd Andromeda

# 2. Install
pnpm install

# 3. Configure — copy and fill in your keys
cp .env.example .env.local
# Required: DEEPSEEK_API_KEY, OPENROUTER_API_KEY, GITHUB_TOKEN
# Optional: KIMI_API_KEY, ANTHROPIC_API_KEY

# 4. Build
pnpm run build

# 5. Run
node dist/_core/index.js
```

The server starts on port 3000. RSI auto-enables within 30 seconds and begins cycling every 5 minutes.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DEEPSEEK_API_KEY` | Yes | Primary LLM for proposals (flash + pro tiers) |
| `OPENROUTER_API_KEY` | Yes | Self-consistency validation (Claude, GPT-4o) |
| `GITHUB_TOKEN` | Yes | Auto-push commits to GitHub |
| `ANDROMEDA_ADMIN_KEY` | Auto-generated | Dashboard admin access (printed on startup) |
| `RSI_SCHEDULE_HOURS` | No | Cycle interval in hours (default: `0.083` = 5 min) |
| `AUTO_REBUILD` | No | Rebuild dist after each apply (default: `false`) |
| `DAILY_CAP_USD` | No | Daily LLM spend cap in USD (default: `5.00`) |

---

## RSI Dashboard

Navigate to `http://localhost:3000/rsi` for the live dashboard:

- **⏸ Pause RSI / ▶ Resume RSI** — Real one-click toggle that actually pauses/resumes the scheduler (not just the UI)
- **Trigger Now** — Fire a cycle immediately (disabled while paused)
- **Autonomous Commit Feed** — Live feed of every AI commit with GitHub sync status
- **Cycle History** — Eval score before/after for every cycle
- **Cost Optimization Panel** — Live spend tracking by provider

---

## Model Tier Routing

The agent uses a tiered model system to minimize costs:

| Tier | Model | Used For |
|---|---|---|
| `eco` | deepseek-v4-flash | 178 standard modules (refactoring, tests, utilities) |
| `standard` | deepseek-v4-flash | 17 mid-complexity modules |
| `pro` | deepseek-v4-pro | 12 core RSI engine files (self-modification) |

At 5-minute cycles, expect ~2–4 pro calls per hour and ~8–12 flash calls per hour.

---

## Test Suite

```bash
# Run all 2,969 tests (301 test files)
pnpm test

# Run a single targeted test (how RSI validates proposals)
pnpm exec vitest run server/selfMonitor.test.ts
```

All 301 test files pass. Zero unhandled errors. Zero vitest worker timeouts.

---

## Key Files

| File | Purpose |
|---|---|
| `server/rsiEngine.ts` | RSI cycle orchestrator |
| `server/selfImprove.ts` | Proposal generation + git commit + auto-push |
| `server/selfImproveGuard.ts` | Guard pipeline (shadow test, tsc, self-consistency) |
| `server/shadowInstance.ts` | In-place shadow test runner |
| `server/rsiScheduler.ts` | 5-minute autonomous cycle scheduler |
| `server/ciPipeline.ts` | CI pipeline (skipTests/skipTypecheck/skipReload/skipBuild) |
| `server/selfConsistency.ts` | Multi-provider consensus validation |
| `data/rlhf_feedback.jsonl` | RLHF reward signal for all applied proposals |

---

## Codebase Health (as of v11.292.0)

| Metric | Value | Grade |
|---|---|---|
| Test files | 301 (100% coverage of analyzable modules) | A+ |
| Test pass rate | 2,969/2,969 (100%) | A+ |
| Unhandled test errors | 0 | A+ |
| TypeScript errors | 0 | A+ |
| Dead code (unused exports) | ~12 minor | A |
| Empty catch blocks (silent) | ~180 non-fatal UI handlers | B+ |
| God modules | rsiEngine.ts (split in progress) | B |
| Overall | | **A-** |

---

## License

MIT — See [LICENSE](LICENSE)
