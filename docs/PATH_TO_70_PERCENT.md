# Andromeda: The Path to 70%+ on SWE-bench Verified

This document outlines the concrete engineering roadmap to elevate Andromeda from its current ~26% baseline to the 70%+ State-of-the-Art (SOTA) tier on the strict SWE-bench Verified dataset.

## 1. Cost Management & Model Strategy

The recent Claude Fable 5 test run revealed a critical cost issue: **Fable 5 is priced at Opus-tier levels** (~$15/MTok input, $75/MTok output), resulting in a cost of **~$4.57 per instance**. Running the full 500-instance benchmark with Fable 5 would cost over $2,200.

**The Strategy:**
1. **Default to `claude-sonnet-5`**: We have added a `claude-sonnet-5` preset using the native Anthropic API with prompt caching. This model is vastly cheaper (~$3/MTok input) and will be used for the bulk of instances.
2. **Fable 5 as Fallback**: Fable 5 should be reserved exclusively for instances that fail the `claude-sonnet-5` pipeline.
3. **Usage Tracking**: We have implemented token usage logging in the Anthropic native API integration to monitor costs in real-time.

## 2. Root Cause Analysis of Recent Failures

The failure of Fable 5 on `astropy__astropy-13236` highlighted a fundamental flaw in the context assembly pipeline:

**The Call-Chain Blind Spot:**
- The bug was located in the `_convert_data_to_col` function.
- The `buildSkeletonContext` function expands functions based on keyword matches from the issue description.
- The keyword `column` matched the `add_column` function, so it was expanded.
- `add_column` calls `_convert_data_to_col`, but because `_convert_data_to_col` didn't match any keywords directly, its body was **never shown to the consensus agents**.
- Fable 5 failed because it literally could not see the code it needed to fix during the consensus phase.

Similarly, the `extractFunctionLevelContext` used in the traceback loop only expands functions explicitly mentioned in the traceback. If the traceback only mentions test functions (which is common), the buggy source function is hidden.

## 3. The Engineering Roadmap

To reach 70%+, Andromeda must implement the following architectural upgrades:

### Phase 1: RAG-based Context Assembly (The Fix for Blind Spots)
*Expected gain: +10-15%*

The naive keyword-matching skeleton context must be replaced with intelligent, graph-based context assembly:
1. **Call-Chain Expansion**: If a function is expanded (e.g., `add_column`), the context builder must automatically parse its AST or regex to find local function calls (e.g., `self._convert_data_to_col`) and expand those callees as well.
2. **Traceback Source Mapping**: When a test fails, the system must trace the error back from the test function into the source files, expanding the actual source functions involved, not just the test functions.

### Phase 2: Execution-Guided Reasoning (Interactive REPL)
*Expected gain: +15-20%*

The current traceback loop is purely reactive: generate patch → run tests → feed error back. To solve complex mathematical or architectural bugs (like those in Astropy or Django), the agent needs a proactive loop:
1. **Print Debugging**: Allow the agent to inject `print()` statements into the codebase, run the tests, and observe the internal state *before* writing the final patch.
2. **REPL Access**: Provide the agent with a Python REPL attached to the repository's Docker container, allowing it to test assumptions and experiment with the API dynamically.

### Phase 3: Multi-File Patching & Cross-Reference Checking
*Expected gain: +10-15%*

Currently, the agent often fixes a bug in one file but fails to update the corresponding logic in related files (e.g., fixing MySQL but forgetting SQLite in Django).
1. **Workspace Context**: Pass the full repository directory tree into the prompt.
2. **Multi-File Diffs**: Allow the model to output a unified diff touching multiple files simultaneously.
3. **Cross-Reference Verification**: Implement an intermediate LLM step that asks: "If I change this function signature in `a.py`, do I need to update callers in `b.py`?"

## Conclusion

The infrastructure is stable. The Docker extraction, conda environments, and test execution pipelines are working flawlessly. The gap between 26% and 70% is entirely a **reasoning and context-management gap**. By implementing Call-Chain Expansion, Interactive REPL debugging, and Multi-File Patching, Andromeda will provide the LLM with the complete context and tooling necessary to achieve SOTA performance.
