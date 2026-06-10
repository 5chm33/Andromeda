# Andromeda SOTA Roadmap: Path to v7.0

This document outlines the final sprints required to achieve **State-of-the-Art (SOTA) Recursive Self-Improvement** for Andromeda. The goal of v7.0 is an agent that operates autonomously on a personal computer, learns from every interaction, safely modifies its own source code, and mathematically proves its improvement via automated evaluations without requiring massive computing power.

---

## Current State (v6.31)

The infrastructure is complete:
- **Generation:** Constitution-aware, AST-chunked, multi-file atomic proposals with import graph context.
- **Persistence:** Postgres/MySQL DB layer with JSON fallback.
- **Concurrency:** Redis distributed locks with in-process fallback.
- **Safety:** 4-stage CI validation pipeline (typecheck → test → build → smoke).
- **Proof:** `data/rsi_proof_history.json` records before/after score deltas for every cycle.

---

## Sprint 1: Autonomy & Visibility (v6.32 — In Progress)

The focus of v6.32 is removing manual intervention and surfacing the RSI process to the user.

1. **RSI Auto-Trigger Scheduler:** A cron job that fires `triggerRSICycleNow()` every 6 hours automatically (configurable). Currently, cycles require a manual API call.
2. **Proposal Review UI:** A React panel in the client that lists pending proposals, displays syntax-highlighted diffs, and provides Approve/Reject buttons.
3. **Eval Score Trending Chart:** A visual chart in the UI plotting the before/after score deltas from `data/rsi_proof_history.json` over time.
4. **Cross-Session Memory Consolidation:** Episodic memory entries older than 7 days are automatically summarized and moved to the long-term knowledge base to prevent context bloat.

---

## Sprint 2: Multi-Agent Parallel Dispatch (v6.33)

To scale reasoning without hitting context limits, the task planner must learn to delegate.

1. **Parallel Step Detection:** The planner analyzes the dependency graph of a decomposed task and identifies steps that can be executed concurrently.
2. **Sub-Agent Spawning:** For parallel steps, the orchestrator spawns lightweight, specialized sub-agents (e.g., a "Browser Agent" and a "Terminal Agent") with restricted context windows.
3. **Result Aggregation:** The main orchestrator waits for sub-agent completion and merges their findings into the central episodic memory.

---

## Sprint 3: Vision-First Browser Automation (v6.34)

DOM-based scraping is fragile. SOTA agents use vision.

1. **Screenshot-to-Coordinates:** Instead of relying on CSS selectors, the browser tool takes a viewport screenshot and passes it to a multimodal LLM (e.g., Claude 3.5 Sonnet or GPT-4o).
2. **Visual Element Identification:** The LLM identifies the target element and returns its exact X/Y coordinates.
3. **Coordinate-Based Interaction:** The agent clicks or types at the specific coordinates, bypassing anti-bot DOM obfuscation entirely.

---

## Sprint 4: Advanced Safety & Rollback (v6.35)

As the agent makes more complex multi-file changes, the safety net must be impenetrable.

1. **Shadow Sandbox Evaluation:** Before applying a proposal to the main codebase, the agent copies the files to an isolated directory, applies the patch, and runs the test suite. If it fails, the main codebase is never touched.
2. **Automated Revert Generation:** If a change passes tests but causes runtime errors later, the agent automatically generates a revert patch and applies it.
3. **Constitution Auto-Updating:** When a proposal is rejected by the user or fails the CI pipeline, the agent analyzes *why* and adds a new rule to `andromeda-constitution.json` so it never makes that mistake again.

---

## Sprint 5: The v7.0 Milestone (SOTA RSI)

v7.0 represents the completion of the core recursive self-improvement loop.

1. **Open-Ended Goal Seeking:** The agent can be given a high-level directive ("Improve your browser automation reliability by 10%") and will autonomously generate proposals, test them, and apply them until the metric is met.
2. **Self-Benchmarking:** The agent periodically runs the 70-task eval suite against older versions of itself to mathematically prove it is getting smarter.
3. **Full Autonomy:** The system can run indefinitely in the background, learning from user interactions during the day and optimizing its codebase at night.
