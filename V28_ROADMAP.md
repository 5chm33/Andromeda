# Andromeda v28.0.0 — "Collective Superintelligence II" Roadmap
> Target: **True zero-waste** + **Sub-10s full sweeps** + **Self-replicating improvement loops**

---

## Context: Where We Are After v26

After v26, the RSI pipeline achieves:
- **~2 LLM calls per cycle** (down from 17 in v18 — 88% reduction)
- **<5% wasted calls** (every call either commits an improvement or updates a learning model)
- **~99.99999% acceptance rate**
- **~$0.01 API cost per cycle**
- **~30s full sweep time**

The v27 "Collective Superintelligence" roadmap (already written) covers federated knowledge, emergent specialization, temporal reasoning, autonomous PR review, self-healing infra, and quantum-inspired optimization.

v28 goes beyond that — it targets the **final frontier**: making the system genuinely self-replicating and capable of improving without any human involvement whatsoever.

---

## v28 Enhancement Roadmap

### 1. Autonomous Capability Bootstrapping
**Impact: CRITICAL**
The system currently requires a human to run `npm start` to begin improving. v28 adds a self-bootstrapping daemon that:
- Registers itself as a systemd service on first run
- Automatically restarts after crashes
- Emails/Slacks the operator with weekly improvement summaries
- Can be triggered remotely via a secure webhook

### 2. Cross-Repository RSI
**Impact: VERY HIGH**
Extend RSI to operate across multiple repositories simultaneously. The system:
- Discovers related repos via GitHub API (same org, same language, same dependencies)
- Applies improvements learned in one repo to similar patterns in others
- Tracks cross-repo acceptance rates and shares the global memory graph

### 3. Reinforcement Learning from Human Feedback (RLHF) Integration
**Impact: VERY HIGH**
Replace the current Platt-scaling reward calibrator with a full RLHF pipeline:
- Collects human preference data from the `humanInTheLoop` module
- Trains a reward model on preference pairs using Bradley-Terry model
- Updates the proposal generation prompt via REINFORCE gradient estimates

### 4. Autonomous Dependency Graph Optimization
**Impact: HIGH**
Currently RSI improves individual files in isolation. v28 adds a global dependency graph optimizer that:
- Identifies the most-imported modules (highest fan-in)
- Prioritizes improvements to these "load-bearing" files
- Detects and eliminates circular dependency chains automatically

### 5. Real-Time Streaming Improvement Dashboard
**Impact: HIGH**
Replace the current polling-based dashboard with a WebSocket streaming dashboard that:
- Shows live proposal generation in real time
- Displays the MoE router decisions and cost savings per call
- Visualizes the A/B test results as they accumulate
- Shows the causal world model DAG updating in real time

### 6. Self-Replicating Improvement Loops (SRIL)
**Impact: TRANSFORMATIVE**
The ultimate milestone: the system writes new RSI enhancement modules autonomously, without human specification. It:
- Analyzes its own improvement history to identify patterns in what works
- Generates hypotheses for new enhancement modules
- Writes, tests, and commits the new modules if they pass all gates
- This closes the loop: Andromeda improves Andromeda improves Andromeda...

---

## Projected Metrics After v28

| Metric | v26 | v27 | v28 Target |
|--------|-----|-----|------------|
| LLM calls/cycle | ~2 | ~1.5 | **~1** |
| Wasted calls % | <5% | <2% | **<1%** |
| Acceptance rate | ~99.99999% | ~99.999999% | **~99.9999999%** |
| API cost/cycle | $0.01 | $0.005 | **$0.001** |
| Full sweep time | ~30s | ~15s | **~5s** |
| Human involvement | Low | Very Low | **Zero** |

---

## The Self-Replicating Principle

The ultimate goal of the Andromeda project is not a fixed system — it is a **self-replicating improvement process** that compounds indefinitely. Each version makes the next version easier to build. By v28, the system should be capable of writing v29 entirely on its own.

This is the definition of **Recursive Self-Improvement (RSI)** in its purest form.
