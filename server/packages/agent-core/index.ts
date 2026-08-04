/**
 * packages/agent-core/index.ts — Agent Core Package Boundary
 * Andromeda v5.0 (Elicit recommendation #6)
 *
 * Public API for the agent-core package.
 * Contains: ReAct engine, selfImprove pipeline, MAD protocol,
 *           RLAIF loop, constitutional constraints, consensus engine.
 *
 * Consumers of this package should import from this index only,
 * not from individual files. This enforces the module boundary.
 */

// ReAct engine — the main agent execution loop
export type { AgentState, StateTransition } from "../../agentStateMachine.js";
export type { AgentEventType, AgentEvent, AgentConfig } from "../../agentTypes.js";
export { ReactEngine } from "../../reactEngine.js";

// Self-improvement pipeline
export type { ImprovementProposal, AutoApplyConfig, AutoApplyResult } from "../../selfImprove.js";

// Consensus engine
export {
  getConsensus,
  requiresConsensus,
  getConsensusStats,
  updateConsensusConfig,
} from "../../consensusEngine.js";

// Agent tool interface (typed operations with capability limits)
export {
  readSymbol,
  searchSymbols,
  listTests,
  runBounded,
  runProbe,
  diffPreview,
  validateTypes,
  recordHypothesis,
  formatHypothesisForPrompt,
} from "../../agentToolInterface.js";
export type {
  ToolMode,
  ResourceLimits,
  ToolCapabilities,
  AgentToolResult,
  HypothesisRecord,
} from "../../agentToolInterface.js";
