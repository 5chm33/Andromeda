# Andromeda AI — The Recursive Self-Improving Agent

![Version](https://img.shields.io/badge/version-v12.4.1-blue.svg)
![Coverage](https://img.shields.io/badge/coverage-100%25-success.svg)
![Tests](https://img.shields.io/badge/tests-2969_passing-success.svg)
![Status](https://img.shields.io/badge/status-SOTA-blueviolet.svg)

Andromeda is a **State-of-the-Art (SOTA) open-source AI agent** capable of true, unsimulated **Recursive Self-Improvement (RSI)**. 

Unlike typical agents that solve isolated issues and stop, Andromeda continuously reads its own source code, generates improvements, validates them in an isolated shadow environment, and autonomously pushes the verified changes to GitHub.

---

## 🌟 The v12.4.1 Milestone (SOTA Grade Achieved)

With the completion of the v12.4.x cycle, Andromeda has reached the peak of current open-source agent architecture. 

*   **A+ Architecture & Autonomy:** Executes a complete RSI loop (Analyze → Propose → Shadow Test → Guard → Apply → Commit).
*   **A+ Code Quality & Resilience:** 302 test files covering 100% of analyzable modules. Multi-layered guards (syntax, truncation, shadow tests, auto-rollback) ensure the agent cannot permanently corrupt its codebase.
*   **A+ Cost Efficiency:** "Cascade Routing" intelligently assigns `deepseek-v4-flash` to standard modules and `deepseek-v4-pro` to core engine files, enabling overnight running at minimal cost. Supports zero-cost local execution via Ollama.
*   **A UI/UX:** The newly redesigned RSI Command Center features a clean vertical layout, real-time telemetry, expandable diffs, and RLHF integration.
*   **Multi-Modal Mastery:** Full integration with `fal.ai` for image and video generation, plus TTS/STT capabilities.

---

## 🚀 Key Features

*   **Autonomous Self-Modification:** The agent safely edits its own logic, tests it, and commits it.
*   **External Repository Fixer:** Point Andromeda at any external GitHub repository to autonomously generate PRs and fix bugs.
*   **Multi-Agent Bus:** Planner, Coder, Reviewer, and Tester personas collaborate to solve complex problems.
*   **Episodic Memory:** Learns from past failures across sessions with semantic retrieval.
*   **Edge & Privacy Routing:** Intelligently falls back to local Ollama models (Llama 3, DeepSeek Coder) for 100% privacy and zero API cost.

---

## 🛠️ Quick Start

```bash
# 1. Clone
git clone https://github.com/5chm33/Andromeda.git
cd Andromeda

# 2. Install
pnpm install

# 3. Configure — copy and fill in your keys
cp .env.example .env.local
# Required: DEEPSEEK_API_KEY, OPENROUTER_API_KEY, GITHUB_TOKEN
# Optional: FAL_KEY, OLLAMA_BASE_URL

# 4. Build
pnpm run build

# 5. Run
node dist/_core/index.js
```

The server starts on port 3000. RSI auto-enables within 30 seconds and begins cycling every 5 minutes. Navigate to `http://localhost:3000/rsi` for the live Command Center.

---

## 📊 Codebase Health

| Metric | Value | Grade |
|---|---|---|
| Test files | 302 (100% coverage of analyzable modules) | A+ |
| Test pass rate | 2,969/2,969 (100%) | A+ |
| Unhandled test errors | 0 | A+ |
| TypeScript errors | 0 | A+ |
| Overall System Grade | | **A+ (SOTA)** |

---

## 📜 License

MIT — See [LICENSE](LICENSE)
