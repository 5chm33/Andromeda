<div align="center">
  <img src="https://raw.githubusercontent.com/5chm33/Andromeda/main/client/public/vite.svg" alt="Andromeda Logo" width="120" />
</div>

<h1 align="center">Andromeda RSI</h1>

<div align="center">
  <strong>The first open-source, fully autonomous Recursive Self-Improvement (RSI) engine.</strong>
</div>
<br />

<div align="center">
  <a href="#overview">Overview</a> •
  <a href="#how-it-works">How it Works</a> •
  <a href="#benchmarks">Benchmarks</a> •
  <a href="#getting-started">Getting Started</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#roadmap">Roadmap</a>
</div>
<br />

Andromeda is a State-of-the-Art (SOTA) autonomous AI system that writes its own code, runs its own tests, and iteratively improves its own architecture without human intervention. 

Unlike standard coding assistants (Copilot, Cursor) or agentic frameworks (AutoGPT), Andromeda implements a **closed-loop evolutionary algorithm** bounded by a strict, LLM-enforced Constitution and a 2,700+ suite of CI regression tests.

It is designed to run locally, securely, and continuously.

---

## Overview

At its core, Andromeda is an AI system that treats its own source code as its environment. It analyzes its own bottlenecks, proposes algorithmic improvements, writes the code, validates it against a massive test suite, and applies the changes if they mathematically improve the system's performance score.

### Key Capabilities

- **Autonomous Proposal Generation**: Continuously analyzes the codebase to find optimization opportunities (e.g., O(N^2) to O(N) refactors, memory leaks, missing abstractions).
- **Hybrid Cost Routing**: Intelligently routes tasks across a 3-tier model architecture. Uses local Ollama models (FREE) for pre-screening, OpenRouter (Gemini Flash/DeepSeek V3) for routine tasks, and premium models (Claude Opus/DeepSeek R1) only for high-impact architectural changes.
- **Constitutional Guardrails**: All self-modifications must pass a strict `andromeda-constitution.json` check to prevent the system from lobotomizing its own safety checks, weakening test assertions, or modifying forbidden core files.
- **Behavioral Regression Engine**: CI Stage 2.5 runs targeted contract tests on modified functions *before* the full test suite, ensuring the AI doesn't break existing behavioral contracts.
- **RAG Context Optimizer**: Injects past failure history, dependency graphs, and behavioral contracts into the AI's prompt during proposal generation, dramatically reducing hallucination rates.

## How it Works

Andromeda runs as a background daemon (the `ContinuousImprover` and `RSIEngine`). Every cycle follows a strict 6-stage pipeline:

1. **Analyze**: The system selects a target file based on cyclomatic complexity and historical bug density.
2. **Contextualize**: The RAG Optimizer pulls dependency graphs and past failure history for the target file.
3. **Propose**: The Hybrid Router selects the optimal LLM (based on task complexity and cost) to generate a concrete code modification.
4. **Constitution Check**: A separate, isolated LLM instance verifies the proposed diff against the strict system Constitution.
5. **CI Validation**: The proposal is applied in a sandbox. The system runs the TypeScript compiler, the Behavioral Regression tests, and the full 2,700+ Vitest suite.
6. **Apply or Rollback**: If all tests pass and the capability score improves, the change is committed. If anything fails, the system rolls back instantly and stores the failure in its Long-Term Memory to avoid repeating the mistake.

## Benchmarks

Andromeda is evaluated on its ability to autonomously improve its own codebase without human intervention.

| Metric | v1.0.0 (Baseline) | v11.1.0 (Current) |
|--------|-------------------|-------------------|
| Test Suite Size | 1,200 tests | 2,772 tests |
| Autonomous Success Rate | 12% | **85%** |
| Cost per RSI Cycle | $0.45 | **$0.02** (Hybrid) |
| Self-Healing Latency | Manual | < 120 seconds |

## Getting Started

### Prerequisites
- Node.js (v20+)
- pnpm (v9+)
- Optional but recommended: [Ollama](https://ollama.com/) for zero-cost local execution

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-username/Andromeda.git
   cd Andromeda
   ```

2. **Install dependencies:**
   ```bash
   pnpm install
   ```

3. **Configure environment:**
   ```bash
   cp .env.local.example .env.local
   ```
   Edit `.env.local` and add your preferred API keys. You only need ONE of the following:
   - `OPENAI_API_KEY`
   - `OPENROUTER_API_KEY`
   - `DEEPSEEK_API_KEY`
   - `OLLAMA_BASE_URL` (for local-only execution)

4. **Build and Start:**
   ```bash
   pnpm build
   pnpm start
   ```

5. **Access the Dashboard:**
   Open `http://localhost:3000` in your browser to view the real-time RSI Dashboard, Swarm Voting metrics, and Cost Optimization stats.

## Architecture

Andromeda is built on a modular, multi-agent architecture:

- **Swarm Specialist Voting**: Proposals are evaluated by a panel of specialist agents (Security, Performance, Architecture). A proposal requires consensus to proceed.
- **Episodic & Long-Term Memory**: The system remembers every failed proposal. Over weeks, it consolidates these episodic failures into abstract architectural principles (e.g., "Never use `execSync` without a timeout").
- **Algorithmic Discovery V2**: A dedicated engine that actively searches for novel capabilities and algorithmic optimizations outside the bounds of predefined benchmarks.
- **Cross-Domain Adapters**: While currently focused on its own TypeScript codebase, the architecture is domain-agnostic. Adapters exist for Robotics/IoT actuation and Zero-Shot Knowledge Transfer.

## Safety & Security

Allowing an AI to write and execute its own code is inherently dangerous. Andromeda mitigates this through:

1. **The Constitution**: A hardcoded JSON ruleset that the AI cannot modify. It explicitly forbids weakening test assertions, modifying the constitution itself, or accessing the host filesystem outside the project directory.
2. **Immutable Test Suite**: The AI is strictly forbidden from modifying test files (enforced at the git diff level). It can only modify source code to pass the tests.
3. **Execution Sandbox**: All proposals are evaluated in an isolated CI pipeline before being applied to the active runtime.

## Roadmap

- [x] Phase 1: Core RSI Engine & CI Pipeline
- [x] Phase 2: Swarm Consensus & Long-Term Memory
- [x] Phase 3: Hybrid Cost Routing & Behavioral Regression Tests
- [x] Phase 4: Full Multi-Node Federated Learning (v11.0+)
- [ ] Phase 5: Zero-Shot Transfer to non-code domains (Q4 2026)

## License

MIT License - See [LICENSE](LICENSE) for details.

---
*Built autonomously by Andromeda.*

## v11.6.0 SOTA Upgrades
- **RLHF 119k Injection:** The proposal generation prompt is now wired to 119,756 validated DPO pairs, feeding past successes and failures directly into the AI's context window.
- **Total Sandbox Security:** `cloudProvisioning.ts`, `dependencyResolver.ts`, and all Git commands are now strictly sandboxed via regex whitelists.
- **GC Score Fixed:** The Goal Completion dimension of the RSI benchmark now accurately scores empty states, unlocking the 100/100 cap.
- **Live Cost Tracking:** Real-time per-provider USD tracking with a daily spending cap.
- **Ollama Zero-Cost Routing:** Background RSI cycles automatically route to local Ollama if available.
- **Forever-Run Daemon:** Built-in PM2 ecosystem config and systemd templates for headless deployment.
