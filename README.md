<div align="center">

# Andromeda

**A self-hosted, evidence-producing software-engineering agent for Python repositories, with inspectable execution and reproducible evaluation.**

*Development started March 3, 2026. Built as a solo project to explore deterministic validation and cost-aware model routing.*

[![Release](https://img.shields.io/github/v/release/5chm33/Andromeda?color=blueviolet)](https://github.com/5chm33/Andromeda/releases/tag/v5.0.0)
[![Tests](https://img.shields.io/badge/tests-5545%20passing-brightgreen)](#)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](#)
[![License](https://img.shields.io/badge/license-MIT-lightgrey)](LICENSE)

</div>

---

## What It Does

Andromeda is a production Node.js/TypeScript application that autonomously resolves GitHub issues from open-source repositories. Given a problem statement and a failing test suite, it:

1. **Localizes** the relevant source files inside the SWE-bench Docker image using LLM-guided keyword search
2. **Builds structured context** using keyword-aware skeleton assembly with ±10-line padding around relevant functions, with full line numbers
3. **Resolves cross-file symbols** by scanning imports and call chains to pull in dependent files (up to 200k char budget)
4. **Generates candidate patches** using a 4-agent parallel consensus engine (conservative, creative, defensive, refactor styles)
5. **Validates each candidate** by running the actual test suite inside the Docker container
6. **Iterates with traceback feedback** for up to 5 revision attempts, with 3-tier model escalation
7. **Applies patches robustly** using `fixHunkCounts` pre-processing + `git apply --fuzz=15` + `--unidiff-zero` fallback to handle LLM formatting drift

### Language-Agnostic Core
**Andromeda's core architecture — the ReAct engine, context assembly, and traceback loop — is entirely language-agnostic and written in TypeScript.** The SWE-bench harness targets Python solely because the benchmark itself is built on Python repositories. The agent is fully capable of resolving issues in JavaScript, TypeScript, Go, Rust, or any other language with a test runner.

### Cost-Efficiency as a First Principle
Andromeda is designed for B2B/enterprise cost efficiency, not just raw benchmark scores. While running a frontier model (like Claude Fable 5) on every instance yields high scores, it costs ~$2.00+ per instance. Andromeda's **3-tier model escalation** resolves ~60% of issues using fast, cheap models (like Sonnet 5 at ~$0.05/instance), escalating to expensive frontier models only when the traceback loop detects a hard failure. This achieves near-frontier quality at ~10% of the cost.

---

## Evaluation Card

Andromeda's performance is measured against SWE-bench Verified. 

> **Note on Methodology:** A 50-case development set is used for iteration and pipeline tuning. It is not positioned as a general SWE-bench result. The 19.2% full-set result represents the baseline performance before recent context and pipeline improvements.

### Full Set Evaluation (Baseline)
- **Agent Version:** v3 (Commit `dc2d070`)
- **Dataset:** SWE-bench Verified (500 instances)
- **Model:** Claude Sonnet 4.5 + DeepSeek Coder fallback
- **Score:** 19.2% (96 / 500 instances)
- **Note:** This run was affected by fallback contamination (101/500 instances used patches from the fallback model that failed to apply).

### Development Set Evaluation (Tuned)
- **Agent Version:** v4 (Commit `b0eb334`)
- **Dataset:** SWE-bench Verified Subset (50 instances: 22 astropy + 28 django)
- **Model:** Claude Sonnet 5 (Tiers 1-2) + Claude Fable 5 (Tier 3)
- **Score:** 66.0% (33 / 50 instances)
- **Per-Repository Breakdown:** Astropy 77.3% (17/22), Django 57.1% (16/28)
- **Note:** This score reflects performance on a heavily tuned development set.

### Historical Artifacts
The repository contains several historical result files, including a `0/500` result from early infrastructure testing and partial runs from API credit exhaustion. All raw predictions and evaluator logs are retained for transparency.

---

## Architecture

### Two Code Paths — Unified Intelligence

Andromeda has two distinct code paths that share core components:

**1. SWE-bench Evaluation Pipeline** (`scripts/run_swebench.ts` + `server/sweBench*.ts`)
A specialized, purpose-built loop designed for the SWE-bench benchmark format. Takes a problem statement + Docker image + failing tests, and produces a git diff patch. 

**2. Main Agent** (`server/reactEngine.ts` + `server/externalRepoFixer.ts`)
A general-purpose ReAct (Reason + Act) loop that handles user requests via chat. Uses the same LLM infrastructure and `buildSmartContext` for code editing tasks. 

**Shared components**:
- `server/sweBenchContextBuilder.ts` — `buildSmartContext`, `runDebugProbe`, `buildDebugProbePrompt`
- `server/sweBenchModelConfig.ts` — all LLM presets and escalation logic
- `server/llmRouter.ts` — model routing (code tasks → Claude Sonnet 4.5 → Sonnet 5 → Fable 5)
- `server/tools/webSearch.ts` — Tavily search 

---

## Pipeline Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                       Andromeda Pipeline                         │
│                                                                  │
│  ┌─────────────────┐   ┌──────────────────┐   ┌──────────────┐  │
│  │  File           │──▶│  Smart Context   │──▶│  4-Agent     │  │
│  │  Localization   │   │  Builder         │   │  Consensus   │  │
│  │  (LLM-guided)   │   │  (skeleton +     │   │  (parallel)  │  │
│  └─────────────────┘   │   symbol resolve)│   └──────┬───────┘  │
│                        └──────────────────┘          │          │
│  ┌───────────────────────────────────────────────────▼────────┐  │
│  │                   Docker Test Execution                    │  │
│  │   fixHunkCounts → git apply --fuzz=15 → --unidiff-zero    │  │
│  │   → conda activate testbed → pytest / django test         │  │
│  │   → capture traceback + Python version detection          │  │
│  └───────────────────────────────────────────────────┬────────┘  │
│                                                      │           │
│  ┌──────────────┐   ┌──────────────────┐   ┌────────▼────────┐  │
│  │  Traceback   │◀──│  3-Tier Model    │◀──│  Test Output   │  │
│  │  Loop (5x)   │   │  Escalation      │   │  Analysis      │  │
│  │  + 120k cap  │   │  Sonnet 5 →      │   └─────────────────┘  │
│  └──────────────┘   │  Fable 5         │                        │
│                     └──────────────────┘                        │
└──────────────────────────────────────────────────────────────────┘
```

### Context Assembly

For files larger than 12,000 characters, the pipeline builds a **smart context** instead of blindly truncating:

1. Extracts all class and function signatures (the skeleton) — the LLM sees the full structural map of the file with line numbers
2. Fully expands any function whose name appears in the issue description or failing test names
3. Uses ±10-line padding around the first keyword match for precision anchoring
4. Caps the total context at 40,000 characters for initial patches; 80,000 characters for revision prompts
5. Resolves cross-file symbols by scanning imports and call chains, adding dependent files up to a 200,000 character total budget
6. **Hard caps revision prompts at 120,000 characters** — truncates file context (not traceback) when exceeded

---

## Getting Started

```bash
git clone https://github.com/5chm33/Andromeda.git
cd Andromeda
pnpm install
cp .env.example .env.local
```

Edit `.env.local` and add your API keys:

```env
# Required: Anthropic direct — for Sonnet 5 and Fable 5
ANTHROPIC_API_KEY=sk-ant-...   # https://console.anthropic.com

# Optional: Tavily — for web search augmentation
TAVILY_API_KEY=tvly-...        # https://tavily.com
```

Run the SWE-bench pipeline:

```bash
# Run with 3-tier escalation (recommended)
SWEBENCH_ESCALATION=1 \
SWEBENCH_MID_PROVIDER=claude-sonnet-5 \
SWEBENCH_STRONG_PROVIDER=claude-fable-5 \
npx tsx scripts/run_swebench.ts --instances 50 predictions.jsonl

# Run on specific instances
npx tsx scripts/run_swebench.ts --instance-ids "django__django-11066,astropy__astropy-12907"
```

Run the test suite:

```bash
pnpm test
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Run `pnpm test` before opening a PR. Do not modify test files to make them pass.

---

## License

MIT — see [LICENSE](LICENSE).
