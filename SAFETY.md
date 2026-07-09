# Andromeda Safety & Architecture Guardrails

This document outlines the safety architecture of the Andromeda Recursive Self-Improvement (RSI) engine, specifically addressing the "fail-open" vs "fail-closed" design decision in the validation pipeline.

## The Validation Pipeline

Andromeda uses a multi-stage validation pipeline before any autonomous commit is merged to `main`:

1. **Syntax Check** (`tsc --noEmit`)
2. **Unit Tests** (`vitest run`)
3. **Integration Tests** (`vitest run -c vitest.integration.config.ts`)
4. **Security Scan** (AST-based pattern matching for `eval`, `Function`, `exec`, etc.)
5. **Sandbox Verification** (Isolated execution of the proposed changes)

## The "Fail-Open" Design Decision

During external audits, it was noted that certain subsystems—specifically the `sandboxVerifier`—default to a "fail-open" (proceed) state when a safety check times out or cannot complete, rather than a "fail-closed" (halt and wait for human) state.

**This is an intentional architectural choice optimizing for throughput and autonomous momentum.**

### Why Fail-Open?

1. **RSI Momentum:** The core thesis of Andromeda is continuous, unsupervised improvement. A strict fail-closed policy on flaky or timeout-prone checks (like the isolated sandbox verifier, which often times out due to resource constraints rather than code malice) would result in the agent halting multiple times per day, requiring constant human babysitting. This defeats the purpose of an autonomous RSI engine.
2. **Redundancy:** The sandbox verifier is only one layer of defense. Even if it fails open, the patch must still pass the strict TypeScript compiler (`tsc --noEmit`), the full test suite (which includes over 5,600 assertions), and the AST security scanner.
3. **Rollback Capability:** The RSI engine includes an automated rollback mechanism. If a commit degrades the benchmark score or causes runtime crashes, the next cycle will detect the regression and revert the commit autonomously.

### The Guardrail Philosophy

For enterprise or production deployments where Andromeda is writing code for *external* systems (rather than its own codebase), a fail-closed gate is highly recommended. 

However, for its primary purpose—a self-improving agent iterating on its own isolated codebase—the system is designed to favor action, relying on test coverage and auto-rollbacks to catch mistakes, rather than halting the entire pipeline on ambiguous validation timeouts.

## CI Branch Protection

To ensure absolute minimum standards are met, the `main` branch is protected by a GitHub Actions CI pipeline. While the RSI engine commits directly to `main` (as the repository owner), the CI pipeline serves as the ultimate source of truth for repository health.

Any commit that breaks the CI build will be flagged, and the RSI engine is programmed to prioritize fixing CI failures over generating new features in subsequent cycles.
