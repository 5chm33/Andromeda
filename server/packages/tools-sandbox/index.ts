/**
 * packages/tools-sandbox/index.ts — Tools & Sandbox Package Boundary
 * Andromeda v5.0 (Elicit recommendation #6)
 *
 * Public API for the tools-sandbox package.
 * Contains: tool registry, all registered tools, git sandbox,
 *           Docker sandbox, polyglot RSI executor.
 *
 * This package is responsible for all external execution —
 * filesystem, shell, Docker, git, browser, and network operations.
 * All operations are mediated through the tool registry and
 * the agentToolInterface capability gates.
 */

// Tool registry — the central registry for all agent tools
export {
  registerTool,
  getTool,
  getAllTools,
  getToolDefinitions,
  getToolsByCategory,
  listToolNames,
  executeTool,
} from "../../tools/index.js";
export type {
  RegisteredTool,
  ToolResult,
  ToolExecutionContext,
  ToolSafety,
  ToolCategory,
} from "../../tools/toolRegistry.js";

// Git sandbox — safe git operations with allowlist enforcement
export {
  GitCommandNotAllowedError,
  gitSandbox,
  gitSandboxAsync,
} from "../../gitSandbox.js";
