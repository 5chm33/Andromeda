/**
 * tools/index.ts — Auto-register all built-in tools
 * Andromeda v5.40
 *
 * Import this file once to register all tools with the registry.
 */

// Each import triggers the registerTool() call at module level
import "./webSearch";
import "./pythonExecute";
import "./bashExecute";
import "./fileOps";
import "./webBrowse";
import "./agentControl";
import "./dockerSandbox";
import "./gitOps";
import "./selfAwareness";
import "./advancedFileOps"; // v5.36: Advanced file ops for Manus-level coding
import "./vision";             // v5.39: Screenshot capture and vision LLM analysis
import "./browserAutomation";  // v5.39: Full browser automation (click, type, scroll, extract)
import "./agentMemory";        // v5.40: Cross-session memory (store, recall, list)
import { registerSelfTestTools } from "./selfTestRunner";
import "./selfModifyTools"; // v5.54: self_write_file, self_run_tests (server-scoped), self_restart
import "./atomicModifyTools"; // v5.68: self_atomic_modify — multi-file atomic transactions
import "./selfDiagnoseTools"; // v5.75: self_diagnose, self_generate_tests, self_review, self_benchmark
import "./selfImprovementTools"; // v5.97: self_smoke_test, self_behavioral_test, self_compile_pipeline, self_benchmark_suite, self_dep_upgrade, self_dep_graph, self_chunked_write
import "./spawnSubAgent"; // v6.14: spawn_sub_agent — parallel multi-agent execution
import { registerVisualGroundingTools } from "./visualGroundingTool"; // v9.15: Playwright visual grounding

// Register self-test tools (they use a registration function instead of module-level calls)
registerSelfTestTools();
// Register visual grounding tools (Playwright annotated screenshots + click-by-index)
registerVisualGroundingTools();

// Re-export the registry for convenience
export {
  registerTool,
  getTool,
  getAllTools,
  getToolDefinitions,
  getToolsByCategory,
  listToolNames,
  executeTool,
} from "./toolRegistry";

export type {
  RegisteredTool,
  ToolResult,
  ToolExecutionContext,
  ToolSafety,
  ToolCategory,
} from "./toolRegistry";
