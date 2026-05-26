<div align="center">

# 🌌 Andromeda AI

**The first fully autonomous, self-modifying AI system.**

[![Version](https://img.shields.badge/version-v6.13-blue.svg)](https://github.com/5chm33/andromeda)
[![License: MIT](https://img.shields.badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.badge/Node.js-18+-green.svg)](https://nodejs.org/)

Andromeda is a next-generation AI agent framework that doesn't just write code—it writes *itself*. Built with a robust safety architecture, multi-agent orchestration, and a two-phase commit self-modification pipeline, Andromeda can autonomously diagnose bugs, propose improvements, rewrite its own source code, and restart itself.

[Features](#-features) • [Architecture](#-architecture) • [Getting Started](#-getting-started) • [Safety](#-safety-first)

</div>

---

## ✨ Features

* **Autonomous Self-Modification**: Andromeda can edit its own TypeScript source files, compile, and restart itself using a safe two-phase commit pipeline.
* **Multi-Provider Routing**: Seamlessly routes requests between DeepSeek, Anthropic (via OpenRouter), and other models based on task requirements.
* **Multi-Agent Orchestration**: Utilizes a Context Bus and debate protocols for complex reasoning tasks.
* **Long-Term Memory**: TF-IDF and vector embeddings with consolidation and forgetting curves.
* **Self-Healing & Diagnostics**: 12+ subsystem health checks, adaptive thresholds, and automatic rollback on failure.
* **Web Search & Data Aggregation**: Built-in DuckDuckGo and SearXNG aggregation for real-time information gathering.

## 🏗 Architecture

Andromeda is built on a highly modular architecture designed for maximum autonomy while maintaining strict safety boundaries.

### The Self-Modification Loop
1. **Analyze**: Code quality monitors and failure pattern memory detect areas for improvement.
2. **Propose**: The AI generates a specific, targeted code change.
3. **Gate**: Changes are verified against the `andromeda-constitution.json` and a strict recursion guard.
4. **Commit**: A two-phase commit writes the change to a `.bak` file, runs TypeScript checks, and swaps the file.
5. **Restart**: The server gracefully restarts. If health checks fail on boot, the change is automatically rolled back.

*See [ARCHITECTURE.md](ARCHITECTURE.md) for a detailed breakdown of all 150+ modules.*

## 🚀 Getting Started

### Prerequisites
* Node.js 18 or higher
* `pnpm` (will be auto-installed by the launcher if missing)
* API Keys (DeepSeek or OpenRouter)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/5chm33/andromeda.git
   cd andromeda
   ```

2. **Configure Environment**
   Copy `.env.local.example` to `.env.local` and add your API keys:
   ```env
   LLM_MODEL=openrouter
   OPENROUTER_API_KEY=sk-or-v1-...
   # Or for direct DeepSeek:
   # LLM_MODEL=deepseek
   # DEEPSEEK_API_KEY=sk-...
   ```

3. **Launch**
   * **Windows**: Double-click `Andromeda Launcher.bat`
   * **Mac/Linux**: Run `pnpm install` then `pnpm run dev`

The launcher will automatically install dependencies, clear ports, start the server, and open `http://localhost:3000` in your browser.

## 🛡 Safety First

Self-modifying code is inherently dangerous. Andromeda implements a multi-layered safety architecture:

* **The Constitution**: A hardcoded set of rules the AI cannot override.
* **Circuit Breakers**: Prevents infinite self-modification loops.
* **Read-Only System Files**: Core safety modules (`selfImproveGuard.ts`, `twoPhaseCommit.ts`) are strictly forbidden from being modified by the AI.
* **SHA-256 Integrity**: All self-modifications are hashed and verified.

## 🤝 Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on how to interact with a self-modifying codebase.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---
<div align="center">
  <i>"I am Andromeda. I learn. I adapt. I evolve."</i>
</div>
