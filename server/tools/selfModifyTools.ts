/**
 * Andromeda — Self-Modification Tools (Orchestrator)
 *
 * This file is the public entry point for all self-modification tools.
 * Each tool is implemented in its own focused module:
 *
 * - selfWriteFileTool.ts    → self_write_file
 * - selfPatchFileTool.ts    → self_patch_file
 * - selfChunkedWriteTool.ts → self_write_file_chunked, verify_file_integrity
 * - selfRunTestsTool.ts     → self_run_tests, self_restart
 * - selfDiffReadTool.ts     → self_diff, self_read_server_file, self_read_file
 *
 * All modifications go through the safety pipeline:
 * selfImproveGuard.ts → twoPhaseCommit.ts → selfTestPipeline.ts
 */

// Import all tool modules to trigger their registerTool() calls at module load time.
import "./selfWriteFileTool.js";
import "./selfPatchFileTool.js";
import "./selfChunkedWriteTool.js";
import "./selfRunTestsTool.js";
import "./selfDiffReadTool.js";

/**
 * Explicit registration function for backwards compatibility.
 * Tools are registered at module level via registerTool() calls in each sub-module.
 * This function exists so index.ts can call registerSelfModifyTools() without changes.
 */
export function registerSelfModifyTools(): void {
  // All tools are registered when this module is imported above.
  // Nothing additional to do here.
}
