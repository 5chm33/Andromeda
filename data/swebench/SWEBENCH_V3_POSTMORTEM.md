# SWE-bench v3 Postmortem & Roadmap to 70%+

## Executive Summary

On June 30, 2026, we ran the Andromeda v3 agent on a 50-instance validation subset of SWE-bench Verified. The agent achieved a **26.0% resolution rate** (13/50 instances). While this is a meaningful improvement over the 19.2% zero-shot baseline, it falls significantly short of the 40-70% target we projected.

This document analyzes exactly why the agent failed on 37 instances and outlines a concrete engineering roadmap to bridge the gap to 70%+.

## 1. The Numbers: Where We Are

| Metric | Result |
|--------|--------|
| **Validation Size** | 50 instances |
| **Resolved** | 13 (26.0%) |
| **Failed (Wrong Fix)** | 34 (68.0%) |
| **Failed (Pipeline Error)** | 3 (6.0%) |

The repository breakdown reveals a massive performance disparity:

- **Django**: 11/28 resolved (**39.3%**)
- **Astropy**: 2/22 resolved (**9.1%**)

The pipeline itself is highly stable. Of the 50 instances, 48 successfully generated and applied patches, and the test execution loop correctly provided pytest feedback. The failures are almost entirely **cognitive failures** (the model wrote the wrong code) rather than **infrastructure failures** (the agent crashed).

## 2. Failure Analysis: Why 37 Instances Failed

We analyzed the gold patches (the actual human fixes) versus the patches our agent generated for the failed instances. The failures fall into three distinct categories.

### A. Localization Failures (The "Missing Files" Problem)
**Impact: ~40% of failures**

In many cases, the agent simply did not edit all the necessary files. 

**Example: `django__django-11138`**
- **Gold Patch:** Edited 4 files (MySQL, Oracle, SQLite base, SQLite ops) across 157 lines.
- **Our Patch:** Edited 1 file (MySQL) across 20 lines.
- **Why it failed:** The issue was a cross-database timezone bug. Claude found the MySQL file, fixed it, and stopped looking. The tests failed because the Oracle and SQLite implementations were still broken.

**The Flaw:** Our current hierarchical localization asks Claude to identify the top 3-5 files, but we only ever feed the *top 1* file to the patch generation prompt if it seems sufficient. The agent lacks a "cross-file reasoning" step.

### B. Context Truncation (The "Blind Spot" Problem)
**Impact: ~35% of failures**

To fit within the 8192 token limit, we truncate large files (like `astropy`'s 150KB files) to show only the "relevant" functions.

**Example: `astropy__astropy-13398`**
- **Gold Patch:** 298 lines across 3 files, heavily modifying frame transformations.
- **Our Patch:** 35 lines in 1 file.
- **Why it failed:** The agent only saw the specific transformation function it was told to look at. It missed the broader class architecture and the `__init__.py` registrations required to make the new transformation work. It was operating with blinders on.

**The Flaw:** Truncating by function boundaries destroys class-level and module-level context. Astropy relies heavily on complex class hierarchies and decorators that are stripped out by our truncation logic.

### C. Domain Complexity (The "Math is Hard" Problem)
**Impact: ~25% of failures (mostly Astropy)**

Sometimes the agent finds the right file, sees the right context, but just writes the wrong logic because the domain is too complex.

**Example: `astropy__astropy-13977`**
- **Gold Patch:** 113 lines in `quantity.py` dealing with complex numpy `ufunc` interactions and unit conversions.
- **Our Patch:** 14 lines adding a naive `try/except` block.
- **Why it failed:** Claude didn't understand the underlying mathematics of how astropy `Quantity` objects interact with numpy universal functions. It tried to apply a superficial Python exception-handling fix to a deep algebraic bug.

## 3. The Roadmap to 70%+

To reach 70%+, we must move beyond single-prompt file editing and implement a true **agentic workflow**. Here is the step-by-step engineering roadmap.

### Step 1: Multi-File Patching (Expected gain: +15%)
Currently, the agent edits files in isolation. We must implement:
1. **Workspace Context:** Pass the full repository structure (tree) into every prompt.
2. **Multi-file Diff Generation:** Allow the model to output a single unified diff that touches multiple files simultaneously.
3. **Cross-reference Checking:** Before applying a patch, a separate LLM call must verify: "If I change this function signature in `a.py`, do I need to update callers in `b.py`?"

### Step 2: RAG-based Context Assembly (Expected gain: +10%)
Instead of naive truncation (cutting the file at 6000 chars), we need intelligent context assembly:
1. **Symbol Resolution:** If the target function uses `class FrameTransform`, the context window must automatically include the definition of `FrameTransform`, even if it's in another file.
2. **Skeleton Views:** Show the entire file as a skeleton (class names and function signatures only), with only the target functions fully expanded. This gives the model the "map" without blowing up the context window.

### Step 3: Execution-Guided Reasoning (Expected gain: +15%)
Our current traceback loop is reactive: *Generate patch -> Run tests -> Feed error back.*
We need a proactive, interactive loop:
1. **Print Debugging:** Allow the agent to write `print()` statements, run the tests, and see the output *before* it attempts to write the final fix.
2. **REPL Access:** Give the agent access to a Python REPL loaded with the repo's environment so it can test mathematical assumptions (critical for Astropy) before committing to a patch.

### Step 4: The Oracle Fallback (Expected gain: +5%)
For instances where the traceback loop fails 5 times:
1. **Web Search / Issue Traversal:** Allow the agent to search the internet or the repository's closed PRs for similar issues to understand how the maintainers typically solve this class of bug.

## Conclusion

The jump from 19% to 26% proves our infrastructure (Docker extraction, conda environments, traceback loops) is sound. The pipeline is no longer dropping patches or failing to run tests. 

The gap between 26% and 70% is entirely a reasoning and context-management gap. By implementing Multi-File Patching, RAG Context Assembly, and Execution-Guided Reasoning, we can give Claude Sonnet 4.5 the environment it needs to solve complex, multi-file software engineering problems.
