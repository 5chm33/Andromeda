<div align="center">

# Andromeda AI

### The World's Most Advanced Open-Source Autonomous Agent

**v10.0.0 — Gödel Machine Edition**

[![CI](https://github.com/5chm33/Andromeda/actions/workflows/ci.yml/badge.svg)](https://github.com/5chm33/Andromeda/actions)
[![Tests](https://img.shields.io/badge/tests-1934%20passing-brightgreen)](https://github.com/5chm33/Andromeda/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)](https://nodejs.org)

[Quick Start](#quick-start) · [Features](#features) · [Architecture](#architecture) · [Configuration](#configuration) · [API Reference](#api-reference) · [Deployment](#deployment)

</div>

---

> **Andromeda** is a production-grade autonomous AI agent that does not just answer questions — it **writes its own code, proves its own improvements, commits its own changes, and restarts itself**. It is the closest open-source implementation of a [Gödel Machine](https://en.wikipedia.org/wiki/G%C3%B6del_machine): a self-modifying AI that only applies improvements when it can formally prove they increase utility.

---

## What Makes Andromeda Different

Most AI assistants are stateless question-answerers. Andromeda is a **self-improving autonomous system** with:

- A **Proof Gate** — every proposed self-modification must pass a 4-layer formal verification cascade (TLA+ → Lean 4 → propositional logic → ZK safety score) before it can be committed
- A **Unified Utility Function** — a single scalar U(state) that all subsystems optimize, with auto-calibration via coordinate descent on historical outcomes
- A **Semantic Self-Model** — Andromeda knows what each of its own modules does and can predict the utility impact of a change *before* running a shadow test
- A **Monte Carlo Tree Search planner** — simulates hundreds of refactor paths before committing to one
- A **Byzantine-fault-tolerant swarm** — multi-node consensus with epistemic belief modeling (Theory of Mind for AI agents)

---

## Features

### Core Intelligence

| Feature | Description |
|---|---|
| **Model-Agnostic LLM Routing** | Routes between DeepSeek, Kimi K2, Claude, and GPT-4.1 based on task type. Coding → DeepSeek/Kimi; reasoning → Claude; fast queries → GPT-4.1-mini. |
| **ReAct Agent Loop** | 10 registered tools: web search, code execution, file read/write, memory, git, browser, shell, image generation, MCP, and terminal. Full tool-call streaming to the UI. |
| **Persistent Memory** | TF-IDF + vector embeddings with consolidation, forgetting curves, and keyword search. Survives restarts. |
| **Web Search** | Brave Search API with SearXNG fallback. Deep research mode chains multiple searches with synthesis. |
| **Visual Grounding** | Playwright-based annotated screenshots with numbered bounding boxes — the LLM can "see" and click web pages by element index. |

### Autonomous Self-Improvement (RSI Engine)

The RSI engine runs an **8-phase cycle**: OBSERVE → EVALUATE → PROPOSE → VALIDATE → APPLY → VERIFY → RECORD → IDLE

| Phase | What Happens |
|---|---|
| **OBSERVE** | Collects test results, benchmark scores, latency metrics, and error logs |
| **EVALUATE** | Computes U(state) — the unified utility scalar across 7 weighted dimensions |
| **PROPOSE** | MCTS planner generates candidate improvements; semantic self-model predicts delta |
| **VALIDATE** | Proof gate runs 4-layer verification cascade; proposals below threshold are rejected |
| **APPLY** | Two-phase commit: write to .bak, run tsc --noEmit, atomic swap |
| **VERIFY** | Shadow instance runs full test suite against the new code |
| **RECORD** | Outcome fed back to semantic self-model and utility function for online learning |
| **IDLE** | Waits for next trigger (scheduled, event-driven, or manual) |

### Gödel Machine Subsystems (v10.0.0)

| Module | Purpose |
|---|---|
| `proofVerifier.ts` | 4-layer proof cascade: TLA+/TLC → Lean 4 → propositional logic → ZK heuristic |
| `utilityFunction.ts` | Unified scalar utility with 7 components and auto-calibrating weights |
| `semanticSelfModel.ts` | Module utility map, impact prediction, and online learning from RSI outcomes |
| `mctsPlanningEngine.ts` | Monte Carlo Tree Search with UCB1 for multi-step refactor planning |
| `causalReasoning.ts` | Judea Pearl Bayesian causal networks — finds *why* tests fail, not just *that* they fail |
| `astKnowledgeGraph.ts` | TypeScript AST → queryable knowledge graph with impact radius and semantic search |
| `epistemicBeliefModel.ts` | Theory of Mind belief states for Byzantine swarm agents |
| `distributedProofConsensus.ts` | Quorum-based proposal approval with HMAC proof verification |
| `swarmTestnet.ts` | Multi-instance swarm coordination testnet with Byzantine fault simulation |

### UI and Experience

- **Unified Workspace** — Left sidebar with conversation history, bottom prompt bar, right-side Artifact panel (live HTML/code preview)
- **Ambient Orb** — Pulsing status orb: blue (idle) → violet (thinking) → cyan (tool call) → amber (shadow testing) → green (done) → red (error)
- **OLED Dark Mode** — Deep `#0B0B10` blacks with neon cyan/violet glows
- **9 Animated Skins** — Aurora, Cyberpunk, Final Fantasy, Goth, Lo-Fi, Luigi's Mansion, Monsters, Nature Forest, Space
- **RSI Dashboard** — Live view of the self-improvement cycle, proposals, proof status, utility scores, and audit log
- **Keyboard Shortcuts** — `Ctrl+K` focus input, `Ctrl+B` toggle sidebar, `/` focus prompt from anywhere

---

## Quick Start

### Windows (Recommended)

1. Install [Node.js 18+](https://nodejs.org)
2. Download or clone this repo
3. Copy `.env.local.example` to `.env.local` and add your API key(s)
4. Double-click **`Andromeda Launcher.bat`**

The launcher handles everything: installs pnpm, installs dependencies, builds the server, opens your browser, and auto-restarts on crash.

### Mac / Linux

```bash
git clone https://github.com/5chm33/Andromeda.git
cd Andromeda
pnpm install
cp .env.local.example .env.local
# Edit .env.local and add your API keys
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

### Docker

```bash
docker build -t andromeda .
docker run -p 3000:3000 --env-file .env.local andromeda
```

---

## Configuration

Copy `.env.local.example` to `.env.local`. The only required field is one LLM API key.

### Required — pick at least one LLM

```env
# DeepSeek — recommended, extremely cheap (~$0.14/M tokens)
DEEPSEEK_API_KEY=your_key_here

# OR OpenAI
OPENAI_API_KEY=your_key_here

# OR Anthropic (Claude)
ANTHROPIC_API_KEY=your_key_here
```

### Recommended

```env
# Web search (2000 free queries/month)
BRAVE_SEARCH_API_KEY=your_key_here
```

### Optional

```env
# LLM model selection (default: deepseek)
# Options: deepseek | deepseek-reasoner | kimi | openrouter | openai | groq | anthropic
LLM_MODEL=deepseek

# Kimi K2 — best for coding tasks
KIMI_API_KEY=your_key_here

# Groq — ultra-fast inference
GROQ_API_KEY=your_key_here

# RSI autonomy settings
CONTINUOUS_IMPROVE=true
AUTO_GOALS=true

# GitHub integration (for RSI to open PRs)
GITHUB_TOKEN=your_token_here
PR_AUTO_MERGE=false

# Custom LLM endpoint (Ollama, LM Studio, etc.)
# LLM_API_URL=http://localhost:11434/v1
```

---

## Architecture

```
andromeda/
├── server/                     # Node.js backend (Express + WebSocket)
│   ├── _core/                  # Server entry point, route registration, init
│   ├── routes/                 # API route handlers
│   │   ├── chatRoutes.ts       # Chat streaming endpoint
│   │   ├── rsiRoutes.ts        # RSI engine control
│   │   ├── godelRoutes.ts      # Gödel Machine API
│   │   └── ...
│   ├── rsiEngine.ts            # 8-phase RSI orchestrator
│   ├── twoPhaseCommit.ts       # Atomic self-modification with proof gate
│   ├── proofVerifier.ts        # 4-layer formal verification cascade
│   ├── utilityFunction.ts      # Unified scalar utility U(state)
│   ├── semanticSelfModel.ts    # Module utility map + online learning
│   ├── mctsPlanningEngine.ts   # Monte Carlo Tree Search planner
│   ├── causalReasoning.ts      # Bayesian causal failure analysis
│   ├── astKnowledgeGraph.ts    # TypeScript AST knowledge graph
│   ├── epistemicBeliefModel.ts # Theory of Mind for swarm agents
│   ├── llmProvider.ts          # Model-agnostic LLM routing
│   ├── memory.ts               # TF-IDF + vector persistent memory
│   └── reactEngine.ts          # ReAct agent loop with 10 tools
├── client/src/                 # React + TypeScript frontend
│   ├── pages/
│   │   ├── Workspace.tsx       # Unified workspace
│   │   ├── RsiDashboard.tsx    # RSI live dashboard
│   │   └── ...
│   └── components/
│       ├── AmbientOrb.tsx      # Pulsing agent state orb
│       ├── ArtifactPanel.tsx   # Live code/HTML preview panel
│       └── ...
├── docs/                       # Documentation and historical assessments
├── build.mjs                   # esbuild config
├── Andromeda Launcher.bat      # Windows one-click launcher
└── .env.local.example          # Configuration template
```

---

## API Reference

### Chat

```http
POST /api/chat/stream
Content-Type: application/json

{
  "messages": [{ "role": "user", "content": "Your message" }],
  "sessionId": "optional-session-id"
}
```

Returns a Server-Sent Events stream with `data: { type, content, fullAnswer }` chunks.

### RSI Engine

```http
GET  /api/rsi/status          # Current RSI cycle state
POST /api/rsi/trigger         # Manually trigger an RSI cycle (requires admin key)
GET  /api/rsi/proposals       # List recent proposals
GET  /api/rsi/audit           # Audit log of all applied changes
```

### Gödel Machine

```http
GET  /api/godel/proof/status        # Proof verifier capabilities and stats
POST /api/godel/proof/verify        # Verify a proposal { code, tests, description }
GET  /api/godel/utility/snapshot    # Current utility scores (all 7 components)
GET  /api/godel/semantic/modules    # Semantic self-model module map
POST /api/godel/causal/analyze      # Causal failure analysis { failedTests, code }
POST /api/godel/mcts/plan           # MCTS planning { goal, constraints }
POST /api/godel/epistemic/debate    # Start epistemic debate { topic, agents }
```

### System

```http
GET  /api/health              # Health check (all subsystems)
GET  /api/system/stats        # Runtime statistics
POST /api/self-heal           # Reset circuit breakers
```

---

## Safety

Andromeda implements multiple layers of safety for self-modifying code:

1. **Constitutional Guard** — Every RSI proposal is checked against `andromeda-constitution.json`. Safety-critical files are permanently forbidden from modification.
2. **Proof Gate** — No self-modification is committed without passing formal verification.
3. **Confidence Gating** — Proposals below 0.7 confidence are queued for human review.
4. **Two-Phase Commit** — All changes write to `.bak` first. If health checks fail on next boot, the change is automatically rolled back.
5. **Shadow Testing** — Every proposal runs the full test suite in an isolated shadow instance before the main process sees it.
6. **RBAC** — Role-based access control with API key management and audit logging.

---

## Test Suite

```bash
pnpm test              # Run all 1934 unit tests
pnpm test:coverage     # Run with coverage report
pnpm test:integration  # Integration tests (requires running server)
pnpm test:eval         # 70-task capability benchmark
```

**Current status: 1,934 tests passing across 261 test files — zero failures.**

---

## Deployment

### Production (Linux/VPS)

```bash
pnpm build
npm install -g pm2
pm2 start dist/_core/index.js --name andromeda
pm2 save && pm2 startup
```

### Reverse Proxy (nginx)

```nginx
location / {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_buffering off;
    proxy_read_timeout 300s;
}
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

The most impactful areas for contribution:

- **New RSI proposal generators** — `server/selfImprove.ts`
- **Additional proof backends** — `server/proofVerifier.ts` (add Isabelle/HOL, Coq)
- **New agent tools** — `server/reactEngine.ts`
- **UI components** — `client/src/components/`

---

## License

MIT — see [LICENSE](LICENSE).

---

<div align="center">

Built with TypeScript, React, Express, Vitest, and esbuild.

**Andromeda v10.0.0** — *The practical ceiling of software-only Gödel Machine parity.*

</div>
