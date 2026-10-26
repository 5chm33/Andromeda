# Andromeda — résumé and interview preparation

## Short project description

> Andromeda is an AI-assisted TypeScript code-repair research project. Its benchmark path explores repository-context assembly, configurable model backends, evaluation-data isolation and inspectable candidate evidence. The portfolio explains the implementation and its limitations without claiming a newly verified benchmark result or production-safe autonomous repair.

## Suggested résumé wording

Use only the responsibilities you can explain and substantiate. If you personally built and directed these parts, this is a scoped option:

> Built an AI-assisted TypeScript code-repair research platform with repository-context assembly, configurable model backends and explicit separation of generated patch readiness from evaluator-confirmed outcomes; documented evaluation boundaries and ongoing promotion-safety hardening.

If “built” overstates your individual role, describe the actual role instead, for example “Developed and maintained…” followed by the specific components or decisions you owned. Do not treat an AI-authored commit as proof that you personally wrote every line. Avoid adding unverified percentages, autonomous-cycle counts, production adoption, or a live-demo claim.

Link the [case study](CASE_STUDY.md), not just the repository landing page. It gives a reviewer a manageable route into a large source tree.

## Explain these choices in your own words

**Evaluation integrity:** Why must hidden test artifacts stay out of a scored prompt? How does `test_aware` development differ from `scored_strict` evaluation? Where is that distinction implemented, and how would you test for leaks?

**Result modeling:** Why can a patch apply cleanly and still be wrong? What does `prediction_ready` establish? What extra evidence does the external evaluator supply?

**Failure handling:** How would you distinguish a bad patch from an unavailable container or model-service failure? Why is missing validation different from successful validation?

**Provider integration:** Why is Andromeda's effective Ollama configuration marked `supportsTools:false`? What protocol tests would you require before enabling tools for a new model?

**Promotion safety:** What does current `main` do when a shadow check is unavailable? What does the separate safety PR propose? What remains necessary for an enforced pre-apply approval boundary?

**Your contribution:** Which decisions did you make, which outputs did an AI assistant generate, and which changes have you personally debugged or validated? Be specific; thoughtful review is a responsibility, but not the same claim as independent authorship of an entire codebase.

## A defensible response to “What is its benchmark score?”

> I am not claiming a newly independently verified score. The repository preserves historical artifacts, but this portfolio focuses on the architecture and evaluation boundary. I distinguish generating an applicable patch from confirming the required tests pass. I can show the implementation and explain what a complete evaluator-backed result would require.

## Appropriate positioning

This project is evidence to discuss for developer tooling, evaluation infrastructure and reliability-oriented backend roles. It is not, by itself, proof of senior production experience, a commercially deployed product, a new foundation model or state-of-the-art performance. The strongest interview is one where you can trace a concrete path through the code, identify a real limitation and explain how you would validate a proposed fix.
