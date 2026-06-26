# Andromeda v19.0.0 — SOTA RSI Roadmap

> **Current baseline:** v18.0.0 — 96% estimated proposal acceptance rate  
> **v19 target:** 98%+ acceptance rate, sub-60s cycle time, full multi-agent orchestration

---

## Executive Summary

v18 completed the calibration and guidance layer: reward scores are now Platt-scaled, rejected proposals inform future generation via the genealogy DAG, and the dependency update pipeline extends RSI beyond source code. v19 focuses on three orthogonal axes: **speed** (async parallel generation), **accuracy** (multi-agent self-critique loop), and **autonomy** (goal-conditioned RSI with external benchmark grounding).

---

## v19 Enhancement Targets

### 1. Async Parallel Proposal Generation (`parallelProposalOrchestrator.ts`)

**Problem:** The current RSI cycle generates proposals sequentially — one file at a time, one LLM call at a time. With 54 analyzable files, a full sweep takes 8–12 minutes.

**Solution:** A `parallelProposalOrchestrator.ts` that fans out up to 8 concurrent generation tasks using the existing `rsiWorkerPool`, with a merge step that deduplicates and ranks the combined output before applying.

| Metric | v18 | v19 Target |
|--------|-----|------------|
| Full sweep time | ~10 min | ~90 sec |
| Proposals per cycle | 3–6 | 15–25 |
| Worker utilization | 20% | 85% |

**Key design decisions:**
- Use `Promise.allSettled` with a concurrency limiter (semaphore pattern) to avoid overwhelming the LLM provider rate limits.
- Each worker runs the full `analyzeAndPropose` pipeline independently, including genealogy guidance and reward calibration.
- The merge step uses `proposalRanker` to select the top-K proposals by calibrated confidence before handing off to the apply pipeline.

---

### 2. Self-Critique Loop (`selfCritiqueAgent.ts`)

**Problem:** The current multi-agent debate runs *before* generation (advisory brief). There is no post-generation critique that can catch logical errors, hallucinated imports, or unsafe patterns before the TypeScript gate.

**Solution:** A `selfCritiqueAgent.ts` that runs a second LLM pass on each generated proposal, acting as an adversarial reviewer. The critic scores the proposal on four axes: correctness, safety, novelty, and reversibility. Proposals scoring below 0.6 on any axis are regenerated (up to 2 retries) before entering the apply pipeline.

**Expected impact:** Reduce TypeScript-gate rejections from ~4% to ~1%, pushing acceptance from 96% to ~98%.

**Architecture:**

```
generate() → [critic pass] → score < threshold? → regenerate (max 2x) → apply pipeline
                                                 ↓ score ≥ threshold
                                              apply pipeline
```

---

### 3. Goal-Conditioned RSI (`goalConditionedRsi.ts`)

**Problem:** The RSI currently selects files to improve based on quality scores and eval failures. It has no concept of *strategic direction* — it cannot prioritize improvements that move the system toward a declared capability goal.

**Solution:** A `goalConditionedRsi.ts` that reads from a `GOALS.md` file in the workspace root, parses declared capability goals (e.g., "reduce P99 latency below 200ms", "achieve 99% test coverage on memory.ts"), and biases file selection and prompt construction toward proposals that advance the current active goal.

**Goal schema:**

```json
{
  "activeGoal": "reduce-latency",
  "goals": [
    {
      "id": "reduce-latency",
      "description": "Reduce P99 response latency below 200ms",
      "targetFiles": ["streamRouter.ts", "contextManager.ts", "llmProvider.ts"],
      "successMetric": "benchmarkRunner.p99 < 200",
      "priority": "high"
    }
  ]
}
```

---

### 4. External Benchmark Grounding (`externalBenchmarkGate.ts`)

**Problem:** The current benchmark regression suite uses 20 internal micro-benchmarks. There is no connection to external, standardized benchmarks (HumanEval, MBPP, HellaSwag) that would allow objective comparison of the system's capability trajectory over time.

**Solution:** An `externalBenchmarkGate.ts` that runs a lightweight subset of HumanEval (10 problems, sampled deterministically) after every 10th proposal apply. If the pass rate drops below the previous baseline, the last 10 proposals are rolled back atomically.

**Rationale:** This closes the loop between RSI self-modification and externally-verifiable capability — the system cannot improve its own evaluation metrics without also improving on held-out problems it has never seen.

---

### 5. Persistent Cross-Session Memory Consolidation (`episodicConsolidationV2.ts`)

**Problem:** The current `episodicConsolidation.ts` runs a nightly consolidation pass but uses a simple recency-weighted forgetting curve. High-value memories (e.g., "the pattern of wrapping all DB calls in a retry loop reduced errors by 40%") decay at the same rate as low-value ones.

**Solution:** An `episodicConsolidationV2.ts` that introduces **importance-weighted retention**: memories are scored by their downstream impact on proposal acceptance rate, and high-impact memories are promoted to a "core memory" tier that never decays. This is analogous to hippocampal-to-neocortical memory consolidation in biological systems.

**Memory tiers:**

| Tier | Retention | Criteria |
|------|-----------|----------|
| Ephemeral | 7 days | Impact score < 0.3 |
| Working | 30 days | Impact score 0.3–0.7 |
| Core | Permanent | Impact score > 0.7 |

---

### 6. RSI Dashboard v2 — Live Calibration & Genealogy Panels

**Problem:** The current dashboard shows cycle stats and proposal history, but does not expose the new v18 systems (reward calibration ECE, genealogy DAG visualization, consensus peer health).

**Solution:** Three new dashboard panels:

1. **Calibration Panel** — Live ECE (Expected Calibration Error) chart, Platt A/B parameters, overconfidence/underconfidence rates. Updates every 30 seconds via SSE.
2. **Genealogy Panel** — Interactive DAG visualization of proposal lineage using D3.js force-directed graph. Nodes colored by outcome (green=applied, red=rejected, grey=pending).
3. **Consensus Panel** — Peer health grid showing all configured nodes, last heartbeat, vote history, and current quorum status.

---

## Acceptance Rate Trajectory

| Version | Key Innovation | Acceptance Rate |
|---------|---------------|-----------------|
| v12 | Multi-agent debate | 55% |
| v13 | Semantic codebase graph | 78% |
| v14 | Worker pool + CI gate | 83% |
| v15 | Fine-tuner + task queue | 87% |
| v16 | Distributed consensus + benchmarks | 91% |
| v17 | Proposal genealogy + rollback verifier | 93% |
| v18 | Reward calibration + genealogy-guided gen | ~96% |
| **v19** | **Self-critique + parallel generation** | **~98%** |

---

## Implementation Priority

The recommended implementation order for v19, based on expected impact-to-effort ratio:

1. **Self-Critique Loop** — highest impact per line of code; directly addresses the remaining 4% rejection rate
2. **Parallel Proposal Orchestrator** — highest throughput gain; unblocks faster iteration
3. **Goal-Conditioned RSI** — enables strategic direction; prerequisite for external benchmark grounding
4. **External Benchmark Gate** — closes the objective evaluation loop; validates all other improvements
5. **Episodic Consolidation v2** — long-term compound interest; lower immediate impact but critical for 6-month horizon
6. **Dashboard v2** — observability; enables faster debugging of the above systems

---

## Files to Create in v19

| File | Lines (est.) | Purpose |
|------|-------------|---------|
| `server/parallelProposalOrchestrator.ts` | ~280 | Fan-out generation with semaphore concurrency control |
| `server/selfCritiqueAgent.ts` | ~220 | Adversarial post-generation critique with retry |
| `server/goalConditionedRsi.ts` | ~180 | GOALS.md parser + file selection bias |
| `server/externalBenchmarkGate.ts` | ~240 | HumanEval subset runner + rollback gate |
| `server/episodicConsolidationV2.ts` | ~200 | Importance-weighted memory tier promotion |
| `server/rsiDashboardV2.ts` | ~320 | Calibration + genealogy + consensus panels |
| `server/v19.test.ts` | ~300 | Comprehensive test suite for all new modules |

**Total new code:** ~1,740 lines  
**Files modified:** `initDaemons.ts`, `selfImprove.ts`, `rsiEngine.ts`, `rsiDashboard.ts`

---

*Generated: 2026-06-26 | Andromeda v18.0.0 | Commit: 6556b2f*
