# server/experimental — Quarantined Autonomy Modules

This directory contains autonomy, swarm, neuromorphic, and speculative modules
that have **not yet demonstrated a measurable contribution** to the core repair
path (issue → sandbox → patch → validation → PR).

Per Elicit P4 recommendation: additions to this directory are frozen until each
component shows a measured lift in resolved rate, apply reliability, cost,
latency, or security-test performance via `server/causalMeasurement.ts`.

## Quarantine Gate

Modules here are NOT imported by `server/_core/initModules.ts` or any core path.
They are available for experimentation but require a passing `evaluateFeaturePromotion()`
result before graduating to the main `server/` directory.

## Core Repair Path (NOT quarantined)

The following files form the critical path and are exempt from quarantine:
- `server/sweBench*.ts` — SWE-bench pipeline
- `server/reactEngine.ts` — ReAct loop
- `server/llmRouter.ts` — model routing
- `server/agentToolInterface.ts` — typed tool interface
- `server/selfImproveGuard.ts` — RSI safety guard
- `server/evolutionarySearch.ts` — benchmark gate (telemetry only)
- `server/packages/policy-promotion/` — promotion contract
- `server/_core/` — server initialization
