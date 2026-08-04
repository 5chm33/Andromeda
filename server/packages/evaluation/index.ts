/**
 * packages/evaluation/index.ts — Evaluation Package Boundary
 * Andromeda v5.0 (Elicit recommendation #6)
 *
 * Public API for the evaluation package.
 * Contains: SWE-bench harness, benchmark manifest emitter,
 *           traceback loop, model config, held-out evaluation gate.
 *
 * IMPORTANT — Evaluation integrity rules:
 *   1. The development set (50 instances) is for fast iteration only.
 *   2. The held-out set must never be used for tuning or prompt engineering.
 *   3. Every run must emit a manifest.json with full reproducibility metadata.
 *   4. Scores reported externally must come from the held-out set only.
 *
 * See: scripts/swebench_sota_agent_v4.py --sample --seed for the
 *      canonical evaluation invocation.
 */

// SWE-bench harness
export type { HarnessStatus, EvalResult } from "../../sweBenchHarness.js";
export {
  runBaseline,
  comparePrePostRsi,
  getHarnessStatus,
  resetHarnessStatus,
  getPerformanceSummary,
} from "../../sweBenchHarness.js";

// Traceback loop — iterative patch repair
export type { PatchApplicationOptions } from "../../sweBenchTracebackLoop.js";
export { allowRecoveryPatchApplication } from "../../sweBenchTracebackLoop.js";
