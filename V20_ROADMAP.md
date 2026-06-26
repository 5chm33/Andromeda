# Andromeda v20.0.0 — The "AGI Threshold" Roadmap

With v18 delivering reward calibration and genealogy guidance (pushing acceptance to ~96%), and v19 targeting parallel orchestration and self-critique (aiming for ~98%), the v20 roadmap focuses on the final leap: **Unsupervised Autonomous Evolution**.

These enhancements are designed to move Andromeda from a tool that perfectly executes user intents, to a system that discovers its own optimal improvements without human prompting.

## 1. Unsupervised Codebase Discovery (UCD)
**Concept:** Currently, Andromeda relies on `GOALS.md` or human prompts to know *what* to improve. UCD introduces a background daemon that continuously parses the codebase AST, runs dynamic traces, and reads issue trackers to autonomously generate its own backlog of high-impact refactors, optimizations, and feature gaps.
**Implementation:**
- Background `ASTParserDaemon` mapping cyclomatic complexity and code churn.
- Autonomous generation of `PROPOSED_GOALS.md` via LLM synthesis of codebase health metrics.
- Auto-scheduling of RSI workers to tackle the highest-ROI discovered goals.

## 2. Multi-Modal Execution Verifier (MMEV)
**Concept:** Tests and TypeScript checks are good, but they don't catch visual or UX regressions. MMEV uses a headless browser (Puppeteer/Playwright) and Vision-Language Models (VLMs) to visually verify UI changes.
**Implementation:**
- Integration of a headless browser in the CI pipeline.
- Pre/post screenshots of UI components affected by proposals.
- VLM (e.g., GPT-4o) visual diffing to ensure no layout shifts, color contrast violations, or broken interactive states.

## 3. Dynamic Model Routing (DMR)
**Concept:** Not all proposals need the smartest, most expensive model. DMR uses a trained local classifier to route tasks to the optimal model based on complexity, saving massive amounts of API credits and time.
**Implementation:**
- Small local embedding model (e.g., `all-MiniLM-L6-v2`) to classify task complexity.
- Routing simple syntax fixes to fast/cheap models (e.g., Haiku/Flash) and complex architectural changes to frontier models (e.g., Opus/GPT-4).
- Dynamic fallback if the cheaper model fails the compilation check.

## 4. Persistent Global Memory Graph (PGMG)
**Concept:** The current memory system is localized to the project. PGMG elevates this to a global, cross-project knowledge graph, allowing Andromeda to apply lessons learned from Project A to Project B.
**Implementation:**
- Centralized vector database (e.g., local ChromaDB or Pinecone) storing successful patterns, common pitfalls, and API quirks.
- Cross-project context injection: "I saw this exact React hydration bug in Project X, here is the verified fix."

## 5. Self-Writing Agent Skills
**Concept:** Andromeda currently has a fixed set of capabilities. v20 will introduce the ability for Andromeda to write, test, and deploy its own new "Agent Skills" (tools) when it encounters a task it cannot complete with its current toolset.
**Implementation:**
- `ToolSynthesizer` agent that detects capability gaps.
- Autonomous generation of TypeScript tool wrappers around external APIs or CLI commands.
- Live-reloading of the tool registry to immediately use the newly synthesized skill.

## 6. The "Infinite Context" Summarizer
**Concept:** As projects grow, they exceed even 200k token windows. The Infinite Context Summarizer maintains a hierarchical, continuously updated summary of the entire codebase, allowing the agent to "understand" a million-line repo without loading it all into context.
**Implementation:**
- File-level summaries rolled up into directory-level summaries, rolled up into architecture-level summaries.
- Triggered on every git commit to keep the summary graph perfectly in sync with the code.

---
*Target Acceptance Rate: 99.9%*
*Target Autonomy Level: Level 4 (Fully autonomous operation within defined guardrails)*
