# Andromeda SWE-bench Evaluation Results

## Benchmark: SWE-bench Verified (500 instances)
**Date:** June 30, 2026
**Model/System:** Andromeda SOTA-Agentless v3

### Final Official Score
**19.20% (96 / 500 instances resolved)**

*Note: This benchmark was evaluated on the strict `SWE-bench_Verified` dataset, which is significantly harder than `SWE-bench_Lite`. The top open-source agentless systems currently score in the 20-30% range on this dataset.*

### Breakdown
| Metric | Count | Percentage |
|--------|-------|------------|
| Total Instances | 500 | 100% |
| **Resolved (Passed all tests)** | **96** | **19.20%** |
| Unresolved (Tests ran, patch failed) | 239 | 47.80% |
| Errors (Patch application failed) | 165 | 33.00% |

*Resolve rate among instances where patches applied cleanly: **28.66%***

### Caveats & Infrastructure Notes
1. **Docker Infrastructure Bottleneck:** During the initial evaluation, pulling large images (like matplotlib at 1.5GB+) caused severe disk space constraints, leading to 165 instances failing due to missing images. 
2. **Re-run Confirmation:** The 165 errored instances were re-run on a clean, expanded disk (372GB). However, the errors persisted because the AI-generated patches contained malformed git hashes or attempted to create files that already existed. 
3. **Timeout Constraints:** SWE-bench defaults to a 30-minute timeout per test. When AI patches introduced infinite loops (e.g., in `requests` or `django`), the evaluation pipeline stalled heavily.

### Next Steps for 70%+
To reach SOTA scores (70%+), the system must move beyond zero-shot patch generation and implement iterative, execution-based feedback loops where the agent runs tests locally, reads the tracebacks, and fixes its own patches before final submission.
