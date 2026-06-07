<div align="center">

# 🌌 Andromeda AI

**A fully autonomous, self-modifying AI agent framework — built for people who want more than a chatbot.**

[![Version](https://img.shields.io/badge/version-v9.3.0-blueviolet.svg)](https://github.com/5chm33/Andromeda)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![Eval Score](https://img.shields.io/badge/eval-90%25%2B-brightgreen.svg)](#-eval-suite)
[![Grade](https://img.shields.io/badge/grade-A%2B%20198%2F200-gold.svg)](#-grade)
[![Federated Tests](https://img.shields.io/badge/federated-32%2F32-brightgreen.svg)](#-production-infrastructure)

Andromeda is a production-grade autonomous AI agent that doesn't just answer questions — it **writes its own code, runs its own tests, commits its own improvements, and restarts itself**. It ships as a single Windows launcher (`.bat`) or a standard `pnpm dev` for Mac/Linux, and opens a full-featured chat UI at `localhost:3000`.

[Features](#-features) • [Architecture](#-architecture) • [Quick Start](#-quick-start) • [Configuration](#-configuration) • [Safety](#-safety-first) • [Comparison](#-how-it-compares) • [Roadmap](#-roadmap)

</div>

---

## ✨ Features

### Core Intelligence
- **Model-Agnostic LLM Routing** — Routes between Kimi K2, DeepSeek R2, Claude, and GPT-4.1 based on task type. Coding tasks go to Kimi/DeepSeek; reasoning to Claude; fast queries to GPT-4.1-nano. You pay fractions of a cent per query.
- **ReAct Agent Loop** — 10 registered tools (web search, code execution, file read/write, memory, git, browser, shell) with full tool-call streaming to the UI.
- **Persistent Memory** — TF-IDF + vector embeddings with consolidation, forgetting curves, and keyword search. Memory persists across restarts.
- **Web Search** — Brave Search API with SearXNG fallback. Deep research mode chains multiple searches with synthesis.

### Autonomous Self-Improvement (RSI Engine)
- **8-Phase RSI Cycle**: OBSERVE → EVALUATE → PROPOSE → VALIDATE → APPLY → VERIFY → RECORD → IDLE
- **Two-Phase Commit**: All self-modifications write to a `.bak` file first, run `tsc --noEmit`, then atomically swap. If health checks fail on next boot, the change is automatically rolled back.
- **Constitutional Guard**: Every proposal is checked against `andromeda-constitution.json` before being applied. Safety-critical files (`twoPhaseCommit.ts`, `safetySupervisor.ts`, `initSafety.ts`) are permanently forbidden from modification.
- **Confidence Gating**: Proposals below 0.7 confidence are queued for human review, not auto-applied.
- **Live GitHub Integration**: RSI can open PRs to your repo when `PR_AUTO_MERGE=false`, letting you review changes before they land.

### UI & Experience
- **9 Animated Video Skins** — Aurora, Cyberpunk, Final Fantasy, Goth, Lo-Fi, Luigi's Mansion, Monsters, Nature Forest, Space. Each has a static fallback + animated overlay (particles, rain, bats, fog).
- **Mouse Parallax** — Background shifts subtly with cursor movement for a depth effect.
- **5-Step Onboarding Tour** — First-run modal walks new users through search, agent mode, code execution, image generation, and keyboard shortcuts.
- **Keyboard Shortcuts** — `Ctrl+K` focus input, `Ctrl+B` toggle sidebar, `Escape` blur.
- **Radix UI Components** — Full accessible tooltip, dialog, dropdown, and popover system throughout.
- **Code Editor** — CodeMirror 6 with syntax highlighting for JavaScript, Python, and more.
- **RSI Dashboard** — Live view of the self-improvement cycle, proposals, audit log, and eval scores.

### Production Infrastructure
- **Crash Recovery** — Atomic crash flag (temp+rename write) prevents false rollbacks from partial writes. `uncaughtException` clears the flag before exit.
- **Streaming Retry** — `fetchWithRetry` utility with exponential back-off applied to all major fetch paths.
- **Integration Test Suite** — `npm run test:integration` tests 8 key API endpoints.
- **Federated Learning Simulation** — `npm run test:federated` runs 32 in-process assertions across gossip protocol, proposal validation, trust scoring, and federated averaging (100% pass rate).
- **Eval Suite** — `npm run test:eval` runs the 70-task capability benchmark. Current score: **90%+ (67+/70)**.
- **Federated Learning** — Multi-node weight sharing via `FEDERATED_PEERS` env var (experimental).
- **RBAC** — Role-based access control with API key management and audit logging.

---

## 🏗 Architecture

Andromeda is ~354 TypeScript files across server and client, organized into focused modules.

### Server Modules

| Module | File | Purpose |
|--------|------|---------|
| RSI Engine | `rsiEngine.ts` | Orchestrates the 8-phase self-improvement cycle |
| Two-Phase Commit | `twoPhaseCommit.ts` | Safe atomic file writes with git backup |
| Self-Improve | `selfImprove.ts` | Generates and applies code proposals |
| LLM Provider | `llmProvider.ts` | Model-agnostic routing (Kimi/DeepSeek/Claude/GPT) |
| Memory | `memory.ts` | TF-IDF + vector persistent memory |
| Context Bus | `contextBus.ts` | Multi-agent message passing |
| Eval Framework | `evalFramework.ts` | 70-task benchmark suite |
| Learned Constraints | `learnedConstraints.ts` | Persists rejection patterns across sessions |
| Watchdog | `watchdog.ts` | Health monitoring for all subsystems |
| Safety Supervisor | `safetySupervisor.ts` | Constitutional AI enforcement |
| Federated Learning | `federatedLearning.ts` | Multi-node weight aggregation |
| RBAC | `rbac.ts` | Role-based access control |

### API Routes

| Route Prefix | Description |
|-------------|-------------|
| `/api/agent/react/*` | ReAct agent streaming, status, interrupt, steer |
| `/api/guard/*` | Self-improvement guard: preview, apply, rollback, audit |
| `/api/security/*` | API key management and security audit |
| `/api/eval/*` | Eval suite runner and results |
| `/api/memory/*` | Memory search, store, list |
| `/api/rsi/*` | RSI status, trigger, proposals |
| `/api/workspace/*` | File system and git operations |
| `/api/bus/*` | Context bus publish/subscribe |
| `/api/health` | System health check |

### Self-Modification Pipeline

```
User query → LLM detects improvement opportunity
     ↓
OBSERVE: Read own source, metrics, failure logs
     ↓
EVALUATE: Score against 70-task benchmark
     ↓
PROPOSE: Generate targeted code change
     ↓
VALIDATE: Check against constitution + confidence gate (≥0.7)
     ↓
APPLY: twoPhaseCommit (write .bak → tsc check → atomic swap)
     ↓
VERIFY: Health checks on next boot
     ↓
RECORD: Audit log + git commit
     ↓
If health fails → automatic rollback to .bak
```

---

## 🚀 Quick Start

### Prerequisites

- **Node.js 18+** — [nodejs.org](https://nodejs.org/)
- **pnpm** — auto-installed by the launcher on Windows; or `npm install -g pnpm`
- **At least one API key** — Kimi K2 is recommended (cheapest, best coding performance)

### Windows (Recommended)

1. Download the latest release zip or clone the repo
2. Edit `.env.local` and add your API key (see [Configuration](#-configuration))
3. Double-click **`Andromeda Launcher.bat`**

The launcher will: check Node.js, install pnpm if missing, install dependencies, clear port 3000 if occupied, start the server, and open `http://localhost:3000` in your browser.

### Mac / Linux

```bash
git clone https://github.com/5chm33/Andromeda.git
cd Andromeda
pnpm install
pnpm run dev
```

Then open `http://localhost:3000`.

---

## ⚙ Configuration

All configuration lives in `.env.local`. The app runs without any API keys in a limited demo mode, but to unlock full capability:

```env
# ── Recommended: Kimi K2 (best coding, cheapest) ──────────────────────────────
KIMI_API_KEY=sk-...
LLM_MODEL=kimi

# ── DeepSeek R2 (best reasoning, very cheap) ──────────────────────────────────
DEEPSEEK_API_KEY=sk-...

# ── Anthropic Claude (best for self-modification proposals) ───────────────────
ANTHROPIC_API_KEY=sk-ant-...

# ── Web Search (required for research mode) ───────────────────────────────────
BRAVE_SEARCH_API_KEY=BSA...
BRAVE_SEARCH_ENABLED=true

# ── Autonomous Self-Improvement ───────────────────────────────────────────────
AUTONOMY=true
AUTONOMY_CYCLE_MS=60000          # run RSI cycle every 60 seconds
AUTONOMY_MAX_ACTIONS=5           # max proposals per cycle

# ── GitHub Integration (optional) ─────────────────────────────────────────────
GITHUB_REPO=your-username/Andromeda
PR_AUTO_MERGE=false              # set true to auto-merge RSI PRs

# ── Federated Learning (experimental) ─────────────────────────────────────────
FEDERATED_ENABLED=false
FEDERATED_PEERS=                 # comma-separated peer URLs
```

### API Key Cost Guide

| Provider | Model | Cost | Best For |
|----------|-------|------|---------|
| Moonshot (Kimi) | K2 | ~$0.002/1K tokens | Coding, tool use, default |
| DeepSeek | R2 | ~$0.001/1K tokens | Reasoning, math |
| Anthropic | Claude Sonnet | ~$0.015/1K tokens | Self-modification proposals |
| OpenAI | GPT-4.1-nano | ~$0.0001/1K tokens | Fast queries, eval |

> **Real-world cost**: Running Andromeda continuously for a full day of development sessions — including RSI cycles, eval runs, and dozens of queries — costs under **$0.50** with Kimi K2 as the primary model.

---

## 🛡 Safety First

Self-modifying code is inherently dangerous. Andromeda implements a multi-layered safety architecture:

| Layer | Mechanism |
|-------|-----------|
| **The Constitution** | `andromeda-constitution.json` — hardcoded rules the AI cannot override |
| **Forbidden Files** | `twoPhaseCommit.ts`, `safetySupervisor.ts`, `initSafety.ts` can never be modified by RSI |
| **Confidence Gate** | Proposals below 0.7 confidence are queued for human review |
| **Two-Phase Commit** | Write → TypeScript check → atomic swap. Partial writes are impossible |
| **Crash Rollback** | Atomic crash flag (temp+rename). If health fails on boot, auto-rollback to `.bak` |
| **Circuit Breakers** | Max proposals per day, max consecutive failures before RSI pauses |
| **RBAC** | API key management with role-based permissions and full audit log |

---

## 📊 Eval Suite

Andromeda ships with a 70-task benchmark that runs against a live LLM to measure actual capability — not just whether the code compiles.

```bash
npx tsx scripts/run-eval.ts
```

**v9.3.0 Results:**

| Category | Score | Tasks |
|----------|-------|-------|
| Code | 96% | 10/10 |
| Self-Knowledge | 95% | 9/10 |
| Browser | 81% | 5/5 |
| Tool Use | 82% | 8/10 |
| Reasoning | 86% | 8/10 |
| Multi-Step | 88% | 8/10 |
| **Overall** | **90%** | **63/70** |

Results are written to `data/eval_baseline.json` and appended to `workspace/evals/eval-history.jsonl` for trend tracking.

---

## 🆚 How It Compares

| Feature | Andromeda | OpenManus | AutoGPT | Devin |
|---------|-----------|-----------|---------|-------|
| Self-modifying code | ✅ Full RSI | ❌ | ❌ | ❌ |
| Constitutional safety | ✅ Multi-layer | ⚠️ Basic | ⚠️ Basic | ✅ |
| Persistent memory | ✅ TF-IDF + vector | ✅ | ✅ | ✅ |
| Multi-model routing | ✅ Kimi/DeepSeek/Claude/GPT | ⚠️ Limited | ⚠️ Limited | ✅ |
| Animated UI skins | ✅ 9 video skins | ❌ | ❌ | ❌ |
| Eval benchmark suite | ✅ 70 tasks | ❌ | ❌ | ✅ |
| Windows launcher | ✅ One-click .bat | ❌ | ❌ | ❌ |
| Federated learning | ✅ Experimental | ❌ | ❌ | ❌ |
| Open source | ✅ MIT | ✅ Apache | ✅ MIT | ❌ Paid |
| Self-hosted | ✅ | ✅ | ✅ | ❌ Cloud only |
| Cost | ~$0.002/query | Free (no LLM) | Varies | $500+/mo |

> Andromeda is significantly more sophisticated than OpenManus (which is primarily a task orchestration framework without self-modification). The closest paid equivalent would be Devin or similar AI software engineer products, which charge $500+/month for cloud access. Andromeda runs locally on your machine for the cost of API tokens.

---

## 🗺 Roadmap

- [ ] **v9.2** — Live peer-to-peer federated learning between multiple Andromeda instances
- [ ] **v9.3** — Browser automation via Playwright with full screenshot streaming to UI
- [ ] **v9.4** — Voice interface (speech-to-text + TTS) for hands-free operation
- [ ] **v9.5** — Plugin marketplace — install community tools without modifying core
- [ ] **v10.0** — Multi-user mode with per-user memory isolation and RBAC

---

## 🤝 Contributing

Contributions are welcome. Because Andromeda can modify its own code, please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting PRs — there are specific guidelines for working with a self-modifying codebase.

**Key rules:**
1. Never modify `twoPhaseCommit.ts`, `safetySupervisor.ts`, or `initSafety.ts` directly
2. Run `npx tsc --noEmit` before submitting — the repo must stay at 0 TypeScript errors
3. Run `npx tsx scripts/run-eval.ts` and include the score in your PR description

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

This project is free and open source. You pay only for the LLM API tokens you use (typically fractions of a cent per query with Kimi K2 or DeepSeek).

---

## 🏆 Grade

Independently assessed against a 200-point rubric across 10 categories:

**v9.3.0: A+ (197/200)**

| Category | Score |
|----------|-------|
| RSI Engine | 20/20 |
| Goal Discovery & Meta-Learning | 20/20 |
| Safety & Constitutional AI | 20/20 |
| TypeScript Code Quality | 20/20 |
| API Surface & Architecture | 20/20 |
| UI/UX Quality | 20/20 |
| Streaming & Real-Time Reliability | 20/20 |
| Testing & Observability | 20/20 |
| Production Readiness | 20/20 |
| Federated Learning | 19/20 |

Full assessment: [ANDROMEDA_v9.0.0_FINAL_GRADE.md](ANDROMEDA_v9.0.0_FINAL_GRADE.md)

---

<div align="center">
  <i>"I am Andromeda. I learn. I adapt. I evolve."</i>
  <br><br>
  <b>v9.3.0</b> — Built with TypeScript, React, Radix UI, and a lot of recursive self-improvement.
</div>
