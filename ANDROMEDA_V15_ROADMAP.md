# Andromeda v15 Forward Roadmap

**Current version:** v14.0.0 (pushed to `main` — commit `9a9b49f`)
**Date:** June 26, 2026

---

## What Was Delivered in v14.0.0

All four enhancements from the v14 roadmap were implemented, tested, and pushed to GitHub in a single session.

| Module | Type | What It Does |
|---|---|---|
| `rsiWorkerPool.ts` | New | Parallel proposal generation — up to 8 files analysed concurrently instead of 3 sequentially |
| `selfHealingChaos.ts` | New | Closes the chaos → RSI feedback loop — broken modules are auto-prioritised for hardening |
| `epistemicBeliefModel.ts` | Extended | Cross-session architectural pattern memory — LLM learns from its own history |
| `ciRegressionGuard.ts` | Extended | CI regression gate — proposals that introduce metric regressions are auto-rejected |

**Test results:** 19 new tests, all passing. TypeScript: 0 errors.

---

## The Full RSI Pipeline (as of v14.0.0)

```
File content read
      ↓
[v14] Pattern Memory Context injected (~0ms, zero tokens)
      ↓
[v13] Multi-Agent Debate (~0ms, zero tokens) → winning brief injected
      ↓
[v13] Semantic Safety Score (~1ms) → blocks/flags high-risk proposals
      ↓
[v12.13] Cost Optimizer → cheapest capable model selected
      ↓
LLM Generation (targeted, cheaper, safer, context-aware)
      ↓
Constitution → Z3 Proof → Reward Model → Transaction Log
      ↓
guardedApply (syntax check, test run)
      ↓
[v14] CI Regression Gate → rejects metric regressions
      ↓
Apply → Pattern Memory records outcome → Chaos target cleared
```

---

## v15 Roadmap: The Next Evolution

### Priority 1 — Distributed Multi-Node RSI (v15.0)

**Problem:** The RSI engine runs on a single process. As the codebase grows to 500+ modules, a single node becomes a bottleneck.

**Solution:** Distribute RSI workers across multiple Node.js processes using a Redis-backed task queue. Each worker node pulls files from the queue, generates proposals independently, and pushes results back. The main process only handles apply + git operations.

**Key files:** `rsiDistributedCoordinator.ts`, `rsiTaskQueue.ts`, `rsiWorkerNode.ts`

**Expected gain:** Linear throughput scaling with node count. 4 nodes = 4x proposals per hour.

---

### Priority 2 — Proposal Ranking & Deduplication (v15.1)

**Problem:** The RSI engine generates proposals independently for each file. When multiple workers analyse the same module, duplicate or conflicting proposals accumulate in the store.

**Solution:** Build a `proposalRanker.ts` that:
- Deduplicates proposals with >80% semantic similarity (using TF-IDF or embedding cosine similarity)
- Ranks surviving proposals by a composite score: reward model score × safety score × pattern memory success rate
- Applies the top-ranked proposal first, re-ranks the rest after each apply

**Expected gain:** Eliminates wasted apply attempts on duplicate proposals. Improves first-apply success rate from ~60% to ~85%.

---

### Priority 3 — Automated Benchmark Regression Suite (v15.2)

**Problem:** The current CI regression gate uses metric history heuristics. It does not actually run the test suite against the proposed change before applying it.

**Solution:** Build `ciTestRunner.ts` that:
- Spawns a child process running `pnpm test <targetFile>.test.ts` with a 30s timeout
- Captures pass/fail counts and diff-compares against the baseline
- Blocks apply if any test that was passing before is now failing
- Caches results per (proposalId, fileHash) to avoid redundant runs

**Expected gain:** True zero-regression guarantee. Eliminates the ~5% of RSI applies that currently break tests.

---

### Priority 4 — LLM Fine-Tuning Feedback Loop (v15.3)

**Problem:** The agent uses the same base LLM for every proposal. It does not learn from its own successful proposals over time.

**Solution:** Build `continuousFineTuner.ts` that:
- Collects (prompt, accepted_proposal) pairs from successful applies
- Batches them into a JSONL fine-tuning dataset every 100 successful applies
- Submits the dataset to the OpenAI fine-tuning API automatically
- Swaps the base model to the fine-tuned version once training completes
- Rolls back to the base model if the fine-tuned model's acceptance rate drops

**Expected gain:** The agent progressively learns this specific codebase's patterns. Expected 30% improvement in proposal acceptance rate after 500 training examples.

---

### Priority 5 — Semantic Diff Validation (v15.4)

**Problem:** The current apply pipeline checks syntax and runs tests, but does not verify that the applied change is semantically equivalent to the proposal. A proposal can pass all checks but still introduce subtle logic bugs.

**Solution:** Build `semanticDiffValidator.ts` that:
- Parses the before/after AST of the modified file
- Extracts the set of exported function signatures and their return types
- Flags any change that modifies a public API signature without a corresponding test update
- Uses the semantic codebase graph to identify all callers that would be affected

**Expected gain:** Catches the class of bugs where a refactoring silently changes a function's behaviour without breaking existing tests.

---

### Priority 6 — Real-Time RSI Dashboard (v15.5)

**Problem:** The RSI engine's activity is only visible in server logs. There is no real-time visibility into what the agent is doing, what proposals are pending, or what the system's health is.

**Solution:** Build a React dashboard at `/rsi-dashboard` that:
- Shows live RSI cycle status (current file being analysed, proposals in queue, last apply result)
- Displays the self-healing chaos hardening targets and their escalation levels
- Shows the pattern memory success rate trend over time (chart)
- Exposes the worker pool throughput metrics
- Allows manual triggering of RSI cycles and chaos tests

**Expected gain:** Full operational visibility. Enables the team to monitor and tune the agent's behaviour without reading logs.

---

## Architectural Principles for v15

The v15 work should follow three principles that have proven correct in v12–v14:

**1. All new systems must be non-fatal.** Every new capability is wrapped in `try/catch` and degrades gracefully if unavailable. The RSI pipeline must never crash because a secondary system failed.

**2. Zero-token pre-generation analysis.** All filtering, ranking, and context injection must happen before the LLM call, not after. The goal is to make the LLM call as targeted and cheap as possible.

**3. Persistent state across restarts.** Every new system that tracks state (pattern memory, chaos targets, proposal rankings) must persist to disk and reload on boot. The agent must not lose its learned context when the process restarts.

---

## Summary Table

| Version | Feature | Status |
|---|---|---|
| v12.13.0 | Circuit breaker wiring, stream integrity, adaptive RSI backoff, cost optimizer, transaction log | ✅ Shipped |
| v13.0.0 | Semantic Codebase Graph, Multi-Agent Debate Protocol, Chaos Engineer | ✅ Shipped |
| v14.0.0 | RSI Worker Pool, Self-Healing Chaos, Pattern Memory, CI Regression Gate | ✅ Shipped |
| v15.0 | Distributed multi-node RSI | Planned |
| v15.1 | Proposal ranking & deduplication | Planned |
| v15.2 | Automated benchmark regression suite | Planned |
| v15.3 | LLM fine-tuning feedback loop | Planned |
| v15.4 | Semantic diff validation | Planned |
| v15.5 | Real-time RSI dashboard | Planned |
