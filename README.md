<div align="center">

# Andromeda

**A self-modifying AI system that improves its own source code — autonomously, continuously, and verifiably.**

[![CI](https://github.com/5chm33/Andromeda/actions/workflows/ci.yml/badge.svg)](https://github.com/5chm33/Andromeda/actions)
[![Release](https://img.shields.io/github/v/release/5chm33/Andromeda?color=blueviolet)](https://github.com/5chm33/Andromeda/releases/tag/v1.0.0)
[![Tests](https://img.shields.io/badge/tests-5646%20passing-brightgreen)](#)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](#)
[![License](https://img.shields.io/badge/license-MIT-lightgrey)](LICENSE)

</div>

---

## The Idea

Most AI systems are static. You train them, deploy them, and they stay exactly as capable as the day they shipped. Andromeda is built around a different premise: **what if the system that runs the AI is also the system that improves it?**

Andromeda is a production Node.js/TypeScript application that, while serving its normal workload, continuously reads its own source code, identifies weaknesses, generates targeted patches, validates them against a battery of safety checks, and — if everything passes — commits the improvement directly to its own GitHub repository. No human in the loop. No deployment pipeline. The system rewrites itself.

This is not a research prototype. It is a working, tested, deployed system with 717 production modules, 5,646 passing tests, and a live commit history that includes code it wrote for itself.

---

## How It Works

### The RSI Loop

The core of Andromeda is the **Recursive Self-Improvement (RSI) engine** — a continuous background process that runs on a configurable interval (default: every 5 minutes) and executes the following pipeline:

**1. Unsupervised Codebase Discovery**

The `unsupervisedCodebaseDiscovery` module scans every TypeScript source file and computes a composite ROI score based on four signals: cyclomatic complexity (how hard the code is to reason about), test coverage gaps (lines not exercised by the test suite), unresolved TODO/FIXME markers, and historical churn rate derived from `git log`. The highest-ROI file becomes the target for the next improvement cycle.

**2. Goal-Conditioned Proposal Generation**

The LLM agent receives the full content of the target file, the relevant section of the RLHF feedback history, and a system prompt derived from the active `emergentSpecialization` role (security expert, performance optimizer, API designer, or generalist — whichever has the highest recent competence score). It generates a minimal, targeted diff. The prompt explicitly forbids hallucinating import paths by requiring the model to work from the actual file content it was given.

**3. The Safety Pipeline**

Before a single byte is written to disk, the proposal passes through seven independent validation gates:

| Gate | What It Checks |
|------|---------------|
| **Constitutional Guard** | Validates the proposed diff against `andromeda-constitution.json` — a machine-readable policy document specifying forbidden file patterns, destructive shell commands, credential-logging patterns, and rationale quality requirements. The checker strips comment and string context from the source before pattern-matching, eliminating the false-positive class that plagued earlier versions. |
| **Proposal Invariant Verifier** | Checks that the proposal does not violate structural invariants: no removal of exported functions without replacement, no introduction of circular dependencies, no weakening of type signatures from `T` to `any`. |
| **Z3 Theorem Prover** | For proposals touching critical modules, the `z3ProofLayer` constructs a formal constraint model of the before/after utility delta and uses the Z3 SMT solver to verify the proposed change is mathematically non-regressive. |
| **Shadow Test** | The proposal is applied in-place to the live file. The full vitest suite runs. If any of the 5,646 tests fail, the file is atomically restored from a pre-apply snapshot. The shadow runner sets `VITEST_SHADOW_MODE=1` so lock-contending integration tests correctly skip themselves. |
| **Sandbox Syntax Check** | The `proposalSandbox` verifies balanced braces, no duplicate function declarations, and no obvious syntax errors — after stripping comments and string literals to avoid false positives on code that merely discusses these patterns. |
| **Benchmark Regression Suite** | Runs 20 micro-benchmarks covering JSON serialization, Map/Set operations, path resolution, and date formatting. An adaptive threshold based on observed variance prevents sub-millisecond jitter from triggering false regressions. |
| **Multi-Model Self-Consistency** | For high-risk proposals, `selfConsistency.ts` submits the reasoning chain to a secondary LLM provider and requires agreement above a 0.66 consensus threshold before proceeding. |

**4. Autonomous Commit**

If all gates pass, the `proposalApplier` writes the change, runs `git commit`, and pushes to `main`. The commit message includes the target file, the improvement rationale, and the RSI cycle ID. The system records the outcome in the RLHF feedback store, closing the learning loop.

---

## The Thought Engine

Andromeda's reasoning is not a single LLM call. It is a layered cognitive architecture.

### Universal Reasoning Engine

`universalReasoningEngine.ts` provides six reasoning modes — deductive, inductive, abductive, analogical, causal, and probabilistic — each with its own confidence propagation model. When Andromeda analyzes a file, it builds a premise graph from the code structure and selects the appropriate reasoning mode based on the type of improvement being considered. A null guard is deductive. A refactoring is analogical. A performance optimization is causal.

### Temporal Reasoning and Counterfactuals

`temporalReasoningEngine.ts` maintains a persistent causal graph of every improvement event, indexed by file, action type, and outcome metric. Before generating a proposal, Andromeda queries this graph to evaluate the counterfactual: *"Given that we linted this file last cycle and the outcome was 0.4, what would the estimated outcome have been if we had refactored it instead?"* This prevents the system from repeatedly applying the same class of improvement to a file that needs something different.

### Emergent Specialization

Rather than using a single generalist prompt, Andromeda maintains four specialist roles and tracks their competence scores using an exponential moving average over recent proposal outcomes. The role with the highest current competence score is selected as the active persona for the next proposal. A security expert that has been successfully patching input validation issues will continue to be selected until its competence score plateaus — at which point the system naturally rotates to whichever specialist is currently underperforming and has the most room to improve.

### Neuroplastic Pipeline Adaptation

`neuroplasticAdapter.ts` monitors the cost and pass-rate of each validation gate. If a gate has been passing at 100% for an extended period and carries a high compute cost, it is temporarily suspended to save resources. If the pass rate subsequently drops, the gate is automatically reactivated. The pipeline topology is not fixed — it adapts to the current risk profile of the proposals being generated.

### Omega Convergence Detection

`omegaConvergenceDetector.ts` tracks the system's capability score over a rolling 100-cycle window. If the improvement rate drops below 0.01% per cycle — indicating the system has reached a local capability ceiling — it triggers the **SRIL engine** (Self-Replicating Improvement Loop), which generates entirely new RSI enhancement modules to address identified gaps in the pipeline. The system can write new subsystems for itself.

### Transcendent Self-Model

`transcendentSelfModel.ts` maintains a live capability assessment across every domain the system operates in, tracking proficiency levels, improvement rates, and known limitations per capability. This self-model is what allows Andromeda to make accurate counterfactual predictions and to recognize when a particular class of improvement has reached diminishing returns.

---

## Learning From Failure

Every rejected proposal is a data point. The `rlhfCollector.ts` module captures five types of feedback signals:

- **Autonomous rejection** — the proposal failed a safety gate (reward: −1.0)
- **Human rejection** — a user explicitly declined a proposal via the dashboard (reward: −1.0)
- **Human edit** — a user modified the proposal before applying it (reward: +0.5, partial credit)
- **Human acceptance** — a user explicitly approved a proposal (reward: +1.0)
- **Downstream signal** — the eval score improved after the proposal was applied (reward: +1.0)

These signals are persisted to `data/rlhf_feedback.jsonl`. The dataset currently contains **119,000+ entries** including the full HH-RLHF evaluation corpus, normalized into Andromeda's native feedback format. The `rewardModel.ts` is trained on this dataset and scores every new proposal before it enters the safety pipeline — proposals with a predicted reward below the confidence threshold are discarded before any compute is spent on validation.

---

## Safety Architecture

Allowing a system to modify its own execution environment is a genuinely hard problem. Andromeda's approach is defense in depth.

**The Constitution** (`andromeda-constitution.json`) is a machine-readable policy document that specifies exactly what the system is and is not allowed to do. It is itself a forbidden modification target — the RSI engine cannot propose changes to it. The constitution defines which files are immutable (auth, database, the constitution itself), which shell patterns are forbidden, what risk levels require human approval, and rate limits on autonomous commits (max 8 per hour, 40 per day).

**Rollback Guarantees** — every proposal creates an atomic semantic snapshot before any file is touched. If the Node.js process crashes mid-apply, the `selfRollback.ts` engine detects the incomplete state on the next boot and restores from the snapshot. This is enforced by a two-phase commit protocol in `twoPhaseCommit.ts`.

**Meta-Guard Isolation** — the files that implement the safety pipeline (`selfImproveGuard.ts`, `sandboxVerifier.ts`, `selfRollback.ts`, `selfHeal.ts`, `selfTestPipeline.ts`) are excluded from the RSI target pool entirely. The system cannot propose changes to its own safety checks.

**Privilege Separation** — the `rbac.ts` and `privilegeSeparation.ts` modules enforce role-based access control on all API endpoints. The RSI engine runs under a restricted service account that cannot access user data, credentials, or the admin API.

---

## Scale

| Metric | Value |
|--------|-------|
| Production TypeScript modules | 717 |
| Test files | 328 |
| Tests passing | 5,646 |
| Total lines of TypeScript | 194,000+ |
| RLHF feedback entries | 119,000+ |
| RSI proposal success rate (v1.0.0) | 100% |
| Autonomous commits during v1.0.0 release | 9 |

---

## Getting Started

```bash
git clone https://github.com/5chm33/Andromeda.git
cd Andromeda
pnpm install
cp .env.example .env.local
```

Edit `.env.local` and add at minimum one LLM provider key:

```env
# Primary: OpenRouter — single key for Claude Sonnet, DeepSeek, Gemini, and 200+ models
OPENROUTER_API_KEY=sk-or-...   # https://openrouter.ai

# Optional: DeepSeek direct (most cost-efficient for high-volume code tasks)
DEEPSEEK_API_KEY=sk-...        # https://platform.deepseek.com

# Optional: Kimi / Moonshot (Gemini-class reasoning, competitive pricing)
KIMI_API_KEY=sk-...            # https://platform.moonshot.cn

# Optional: fal.ai (image generation and multimodal tasks)
FAL_KEY=...                    # https://fal.ai
```

> **Note:** Andromeda does not require an OpenAI API key. The system is built around open, cost-efficient, and ethically-aligned providers. OpenRouter gives access to Anthropic Claude, DeepSeek, and Gemini through a single key and is the recommended starting point.

```bash
pnpm run build
NODE_ENV=production node dist/_core/index.js
```

The RSI daemon initializes automatically. Within 30 seconds the first codebase scan begins. Within 5 minutes the first proposal is generated. If it passes all safety gates, it commits itself to your local repository.

### API

```bash
# Check RSI pipeline status and cumulative success rate
curl http://localhost:3000/api/rsi/status \
  -H "x-admin-key: $ADMIN_KEY"

# Trigger an immediate cycle (don't wait for the scheduler)
curl -X POST http://localhost:3000/api/rsi/trigger \
  -H "x-admin-key: $ADMIN_KEY"

# View the live proposal queue
curl http://localhost:3000/api/rsi/proposals \
  -H "x-admin-key: $ADMIN_KEY"

# Manually approve or reject a pending proposal
curl -X POST http://localhost:3000/api/rsi/proposals/{id}/approve \
  -H "x-admin-key: $ADMIN_KEY"
```

### Dashboard

The React dashboard (`client/`) provides a real-time view of the RSI pipeline: active proposals, safety gate results, RLHF reward scores, benchmark regression charts, and the full commit history of autonomous improvements. Run `pnpm run dev` to start the development server.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      Andromeda Runtime                       │
│                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌───────────────┐  │
│  │  RSI Engine  │───▶│  LLM Agent   │───▶│   Proposal    │  │
│  │  (Scheduler) │    │  (Specialist)│    │   Generator   │  │
│  └──────────────┘    └──────────────┘    └───────┬───────┘  │
│                                                   │          │
│  ┌────────────────────────────────────────────────▼────────┐ │
│  │                    Safety Pipeline                      │ │
│  │   Constitution → Invariants → Z3 → Shadow → Benchmark  │ │
│  └────────────────────────────────────────────────┬────────┘ │
│                                                   │          │
│  ┌──────────────┐    ┌──────────────┐    ┌────────▼────────┐ │
│  │  RLHF Store  │◀───│  Reward      │◀───│  Commit & Push  │ │
│  │ (119k pairs) │    │  Model       │    │  (GitHub)       │ │
│  └──────────────┘    └──────────────┘    └─────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

The system is a single Node.js process. There are no microservices, no message queues, no external orchestrators. The RSI engine, the HTTP API, the React dev server, and the safety pipeline all run in the same process — which is intentional. The rollback guarantees are only meaningful if the process that applies changes is the same process that can detect a crash and restore from snapshot.

---

---

## Benchmarks

Andromeda is evaluated on [SWE-bench](https://www.swebench.com/) — the standard benchmark for autonomous software engineering agents. Each task presents a real GitHub issue from a major open-source Python repository; the agent must produce a patch that makes the failing tests pass without breaking anything else.

### SWE-bench Verified (500 tasks)

> SWE-bench Verified is the human-validated subset of SWE-bench, curated to remove ambiguous or under-specified tasks. It is the standard leaderboard benchmark.

| Metric | Result |
|---|---|
| **Predictions generated** | 500 / 500 (100%) |
| **Resolved (Official Score)** | **19.20%** (96 / 500 instances) |
| **Resolve Rate (Evaluated)** | **28.66%** (96 / 335 clean patch applies) |
| **Model** | Claude Sonnet 4.5 via OpenRouter (localization) + DeepSeek Coder (repair) |
| **Prediction file** | [`data/swebench/andromeda_sota_v3_fixed_predictions.jsonl`](data/swebench/andromeda_sota_v3_fixed_predictions.jsonl) |

> *Note: The official score is 19.20% across all 500 instances. 165 instances failed to evaluate due to malformed patch generation (e.g., null git hashes). Among the 335 instances where patches applied cleanly, the resolve rate was 28.66%. See `data/swebench/SWEBENCH_RESULTS.md` for full details.*

### SWE-bench Full (2,294 tasks)

| Metric | Result |
|---|---|
| **Predictions generated** | 2,294 / 2,294 (100%) |
| **Patch rate** | 99.9% (2,291 non-empty patches) |
| **Prediction file** | [`data/swebench/andromeda_full_20260628_0922_predictions.jsonl`](data/swebench/andromeda_full_20260628_0922_predictions.jsonl) |

### Repositories Covered

astropy · django · matplotlib · seaborn · flask · requests · xarray · pylint · pytest · scikit-learn · sphinx · sympy

### Methodology

Predictions are generated using an **Agentless-style hierarchical pipeline** (Xia et al., 2024):

1. **Hierarchical Localization** — Claude Sonnet 4.5 (via OpenRouter) reads the repository structure and identifies the 3–5 source files most likely to require changes, then analyzes each file to pinpoint the specific function or class to modify.
2. **Multi-Candidate Repair** — Three candidate patches are generated per instance: the first at temperature 0 (deterministic best guess), subsequent candidates at temperature 0.4 for diversity. Primary model: DeepSeek Coder direct; fallback chain: DeepSeek V4 Flash → Claude Sonnet 4 via OpenRouter.
3. **Patch Validation and Ranking** — Each candidate is validated with `git apply --check`. Valid patches are ranked by size (shortest valid patch wins, minimizing invasiveness). Invalid patches fall back to format-correct candidates.

No oracle information, no test execution at inference time. The evaluation harness runs each selected patch inside an isolated Docker container and checks whether the issue's test suite passes.

---

## Token Efficiency

Andromeda is designed for **high-throughput, low-cost autonomous operation**. Several mechanisms work together to minimize token spend without sacrificing quality:

| Mechanism | How It Saves Tokens |
|---|---|
| **Neuroplastic Pipeline Adaptation** | `neuroplasticAdapter.ts` monitors the cost and pass-rate of each validation gate. Gates that have been passing at 100% are temporarily suspended — no tokens spent on checks that aren't catching anything. |
| **ROI-Targeted File Selection** | The codebase scanner ranks files by a composite score (complexity × coverage gap × churn rate). Only the highest-value target gets an LLM call each cycle — not a broad sweep of the entire codebase. |
| **Reward Model Pre-filter** | The `rewardModel.ts` scores every proposal before it enters the safety pipeline. Proposals predicted to fail are discarded immediately, before any compute is spent on Z3, shadow testing, or benchmark runs. |
| **Context Truncation** | File content sent to the LLM is capped at 8,000 characters. For large files, only the most relevant section (identified by the localization phase) is included. |
| **Emergent Specialization** | Rather than sending a generic prompt every cycle, the system selects the specialist role (security, performance, API design, generalist) with the highest recent competence score. Specialist prompts are shorter and more targeted than generalist ones. |
| **Multi-Model Self-Consistency (selective)** | The expensive secondary-model consistency check is only triggered for high-risk proposals — not every cycle. Low-risk improvements skip it entirely. |

In practice, a full RSI cycle costs approximately **$0.002–$0.008** depending on file size and whether the consistency check fires. A 48-hour autonomous run at 5-minute intervals (~576 cycles) costs roughly **$1–$5 in total API spend**.

---

## Roadmap

**Multi-file atomic proposals** — the current pipeline operates on one file at a time. Refactoring an interface that spans a module boundary requires coordinating changes across multiple files atomically. The `multiFileProposalPlanner.ts` module is the foundation for this.

**Distributed shadow testing** — running the full vitest suite in-place is fast but creates lock contention when the server is under load. The next version will run shadow tests in isolated Docker containers, eliminating the environment conflict entirely.

**Cross-instance federated learning** — `federatedKnowledgeGraph.ts` already implements a Merkle-hashed knowledge graph for sharing verified improvement patterns across instances. The roadmap includes a real gRPC transport layer so multiple Andromeda deployments can share RLHF signal without sharing raw code.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The short version: run `pnpm test` before opening a PR, do not modify test files to make them pass (the constitution forbids this and the CI will catch it), and do not modify the safety pipeline files without a detailed rationale.

---

## License

MIT — see [LICENSE](LICENSE).

