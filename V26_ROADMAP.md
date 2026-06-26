# Andromeda v26.0.0 — "Zero-Waste Intelligence" Roadmap

> Target: **0% wasted LLM calls** + **~99.9999%+ acceptance rate**

---

## Context: The LLM Efficiency Problem

After the v24 audit, we established that the RSI pipeline was making ~17 LLM calls per cycle, of which only ~4 were strictly necessary. v24 reduced this to ~5 calls/cycle (a 70% reduction). v25 (Cognitive Transcendence II) will reduce it further. v26 targets the final mile: **true zero-waste** where every single LLM token spent produces a committed improvement.

---

## v26 Enhancement Roadmap

### 1. Speculative Execution Engine
**LLM Efficiency Impact: HIGH**

Run the proposal generation and the debate in parallel using speculative execution — start the debate before the proposal is finalized, using a draft. If the final proposal matches the draft closely enough (cosine similarity > 0.85), the debate result is reused without a second call. This eliminates the sequential dependency between generation and debate, cutting wall-clock time by ~40% and eliminating ~3 redundant calls per cycle.

### 2. Mixture-of-Experts (MoE) Prompt Router
**LLM Efficiency Impact: VERY HIGH**

Replace the single `simpleChatCompletion` call with a learned MoE router that selects the minimum-cost expert for each sub-task:
- **Syntax fixes** → `gpt-4o-mini` (8x cheaper)
- **Logic refactoring** → `gpt-4o` (standard)
- **Architectural redesign** → `o1-preview` (highest quality)
- **Documentation** → local `llama-3.1-8b` (free)

Expected savings: ~60% reduction in API costs with no quality loss.

### 3. Online Reward Model Distillation
**Acceptance Rate Impact: HIGH**

Instead of calling the reward model API on every proposal, distill the reward model into a local lightweight classifier (fine-tuned `distilbert-base`) that runs in <10ms on CPU. The local model handles 90% of easy cases; the full API is only called for borderline proposals (confidence 0.4–0.6). This eliminates ~80% of reward model API calls.

### 4. Semantic Proposal Deduplication v2 (Embedding-Based)
**LLM Efficiency Impact: HIGH**

Upgrade the v24 SHA-256 cache to use embedding-based semantic similarity. Two proposals are considered duplicates if their embedding cosine similarity > 0.92, even if the exact text differs. This catches near-duplicate proposals that the hash cache misses, eliminating another ~15% of redundant generation calls.

### 5. Adaptive Self-Consistency Threshold
**LLM Efficiency Impact: MEDIUM**

Currently self-consistency always samples 3 times. Replace this with an adaptive threshold: if the first sample has confidence > 0.9, skip the remaining samples. If confidence is 0.5–0.9, sample once more. Only sample all 3 times for confidence < 0.5. Expected to reduce self-consistency calls by ~60%.

### 6. Autonomous A/B Testing Framework
**Acceptance Rate Impact: HIGH**

Build a proper A/B testing harness that runs two variants of each RSI enhancement (e.g., "debate with 3 agents" vs "debate with 5 agents") and uses a two-sample t-test to determine which is statistically better. This replaces the current manual hyperparameter tuning in NAS with a rigorous scientific approach, ensuring every configuration change is evidence-based.

---

## Projected Metrics After v26

| Metric | v23 | v24 | v25 | v26 Target |
|--------|-----|-----|-----|------------|
| LLM calls/cycle | 17 | ~5 | ~4 | **~2** |
| Wasted calls % | ~76% | ~30% | ~20% | **<5%** |
| Acceptance rate | 99.9999% | ~99.9999% | ~99.9999% | **99.99999%** |
| API cost/cycle | $0.17 | $0.05 | $0.04 | **$0.01** |
| Full sweep time | ~10 min | ~90s | ~60s | **~30s** |

---

## The Zero-Waste Principle

The ultimate goal of the LLM efficiency work is not just cost reduction — it is **alignment between token spend and value delivered**. Every LLM call should either:
1. Produce a committed improvement to the codebase, OR
2. Produce a rejection that updates the failure predictor, calibrator, or causal world model

Any call that does neither is waste. v26 targets eliminating the last 5% of such calls through speculative execution, MoE routing, and online distillation.
