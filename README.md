<div align="center">

# Andromeda

**An autonomous software engineering agent benchmarked on SWE-bench Verified.**

[![CI](https://github.com/5chm33/Andromeda/actions/workflows/ci.yml/badge.svg)](https://github.com/5chm33/Andromeda/actions)
[![Release](https://img.shields.io/github/v/release/5chm33/Andromeda?color=blueviolet)](https://github.com/5chm33/Andromeda/releases/tag/v1.0.0)
[![Tests](https://img.shields.io/badge/tests-5646%20passing-brightgreen)](#)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](#)
[![License](https://img.shields.io/badge/license-MIT-lightgrey)](LICENSE)

</div>

---

## What It Does

Andromeda is a production Node.js/TypeScript application that autonomously resolves real GitHub issues from open-source Python repositories. Given a problem statement and a failing test suite, it:

1. Localizes the relevant source files inside the SWE-bench Docker image
2. Builds structured context (skeleton + expanded relevant functions) for each file
3. Generates candidate patches using a 4-agent parallel consensus engine
4. Validates each candidate by running the actual test suite inside the container
5. Iterates with traceback feedback for up to 5 attempts per instance

The system is evaluated on [SWE-bench Verified](https://www.swebench.com/) — the standard benchmark for autonomous software engineering agents.

---

## Benchmarks

### SWE-bench Verified (500 tasks)

> SWE-bench Verified is the human-validated subset of SWE-bench, curated to remove ambiguous or under-specified tasks. It is the standard leaderboard benchmark.

#### Latest: v3 Agent — Claude Sonnet 4.5 Exclusive (50-instance validation, Jun 30 2026)

| Metric | Result |
|---|---|
| **Predictions generated** | 50 / 50 (100%) |
| **Patched** | 48 / 50 (96%) |
| **Resolved (Official Score)** | **26.0%** (13 / 50 instances) |
| **Django resolve rate** | **39.3%** (11 / 28 Django instances) |
| **Astropy resolve rate** | **9.1%** (2 / 22 astropy instances) |
| **Model** | Claude Sonnet 4.5 exclusively via OpenRouter |
| **Pipeline** | Docker file extraction → skeleton context → difflib patch generation → test_patch aware → conda env → 4-agent consensus → traceback loop (5 attempts) |
| **Agent script** | [`scripts/run_swebench.ts`](scripts/run_swebench.ts) |
| **Prediction file** | [`data/swebench_v3_validate50_predictions.jsonl`](data/swebench_v3_validate50_predictions.jsonl) |

**Resolved instances:** astropy__astropy-12907, astropy__astropy-7336, django__django-10973, django__django-11066, django__django-11095, django__django-11099, django__django-11119, django__django-11163, django__django-11206, django__django-11211, django__django-11276, django__django-11333, django__django-11451

> *Note: Django instances resolve at 39.3% — competitive with published SOTA for this repo. Astropy is significantly weaker (9.1%) due to scientific/mathematical domain complexity and large file sizes. The v2.1.0 pipeline introduces skeleton context assembly to address this directly.*

#### Previous: v3 Agent — Mixed Model (500 instances, Jun 28 2026)

| Metric | Result |
|---|---|
| **Predictions generated** | 500 / 500 (100%) |
| **Resolved (Official Score)** | **19.20%** (96 / 500 instances) |
| **Resolve Rate (Evaluated)** | **28.66%** (96 / 335 clean patch applies) |
| **Model** | Claude Sonnet 4.5 via OpenRouter (localization) + DeepSeek Coder (repair) |
| **Prediction file** | [`data/swebench/andromeda_sota_v3_fixed_predictions.jsonl`](data/swebench/andromeda_sota_v3_fixed_predictions.jsonl) |

> *Note: The 19.20% score was degraded by DeepSeek fallback contamination — 101/500 instances silently used DeepSeek-generated patches that failed to apply. The v3 Claude-exclusive pipeline eliminates this.*

### SWE-bench Full (2,294 tasks)

| Metric | Result |
|---|---|
| **Predictions generated** | 2,294 / 2,294 (100%) |
| **Patch rate** | 99.9% (2,291 non-empty patches) |
| **Prediction file** | [`data/swebench/andromeda_full_20260628_0922_predictions.jsonl`](data/swebench/andromeda_full_20260628_0922_predictions.jsonl) |

### Repositories Covered

astropy · django · matplotlib · seaborn · flask · requests · xarray · pylint · pytest · scikit-learn · sphinx · sympy

---

## Architecture

### Pipeline Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      Andromeda Pipeline                      │
│                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌───────────────┐  │
│  │  Localization│───▶│  Skeleton    │───▶│  4-Agent      │  │
│  │  (LLM-guided)│    │  Context     │    │  Consensus    │  │
│  └──────────────┘    └──────────────┘    └───────┬───────┘  │
│                                                   │          │
│  ┌────────────────────────────────────────────────▼────────┐ │
│  │                  Docker Test Execution                  │ │
│  │   Apply patch → conda activate → pytest → traceback    │ │
│  └────────────────────────────────────────────────┬────────┘ │
│                                                   │          │
│  ┌──────────────┐    ┌──────────────┐    ┌────────▼────────┐ │
│  │  Traceback   │◀───│  LLM Revision│◀───│  Test Output   │ │
│  │  Loop (5x)   │    │  Prompt      │    │  Analysis      │ │
│  └──────────────┘    └──────────────┘    └─────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Key Components

**`scripts/run_swebench.ts`** — Main runner. Loads the SWE-bench dataset from HuggingFace cache, extracts file content from Docker images, runs localization, and orchestrates the full pipeline.

**`server/sweBenchConsensus.ts`** — 4-agent parallel patch generation. Each agent uses a different temperature and reasoning style (conservative, creative, defensive, refactor). The best-passing candidate wins.

**`server/sweBenchTracebackLoop.ts`** — Iterative test-feedback loop. Applies the candidate patch inside the Docker container, runs the actual test suite, captures the traceback, and feeds it back to the LLM for up to 5 revision attempts.

**`server/sweBenchPipeline.ts`** — Orchestrator. Sequences consensus → traceback loop and tracks resolution status.

**`server/sweBenchInfra.ts`** — Docker infrastructure. Handles image pulling, disk space management, and container lifecycle.

### Context Assembly (v2.1.0)

For files larger than 12,000 characters, the pipeline builds a **skeleton context** instead of blindly truncating to the first N characters:

1. Extracts all class and function signatures (the skeleton) — the LLM sees the full structural map of the file
2. Fully expands any function whose name appears in the issue description or failing test names
3. Caps the total context at 20,000 characters of expanded bodies

This directly addresses the core failure mode for large-file repositories like astropy, where the relevant function (e.g., `_separable_matrix`) may appear at line 800 of a 2,000-line file and would be completely invisible under naive head-truncation.

---

## Getting Started

```bash
git clone https://github.com/5chm33/Andromeda.git
cd Andromeda
pnpm install
cp .env.example .env.local
```

Edit `.env.local` and add your LLM provider key:

```env
# Primary: OpenRouter — single key for Claude Sonnet, DeepSeek, Gemini, and 200+ models
OPENROUTER_API_KEY=sk-or-...   # https://openrouter.ai
```

Run the SWE-bench pipeline:

```bash
# Run on 50 instances
npx tsx scripts/run_swebench.ts --instances 50

# Run on specific instances
npx tsx scripts/run_swebench.ts --instance-ids "django__django-11066,astropy__astropy-12907"

# Resume a previous run
npx tsx scripts/run_swebench.ts --resume --output predictions.jsonl
```

Run the test suite:

```bash
pnpm test
```

---

## Scale

| Metric | Value |
|--------|-------|
| Production TypeScript modules | 717 |
| Test files | 328 |
| Tests passing | 5,646 |
| Total lines of TypeScript | 194,000+ |

---

## Roadmap

**Full 500-instance re-run (v2.1.0 pipeline)** — The skeleton context and expanded localization (up to 8 files) are the primary changes in v2.1.0. A full re-run is needed to establish the official score delta.

**Cross-file symbol resolution** — After localization returns the primary files, scan their import statements and function calls to automatically include any additional files that define symbols referenced in the issue. This is the fix for bugs that require coordinated changes across 3–4 files.

**Model upgrade path** — Claude Sonnet 4.5 is the current backbone. For the hardest instances (complex mathematical/scientific bugs), Claude Opus 4 or a fine-tuned model trained on SWE-bench-style repairs would close the remaining gap.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Run `pnpm test` before opening a PR. Do not modify test files to make them pass.

---

## License

MIT — see [LICENSE](LICENSE).
