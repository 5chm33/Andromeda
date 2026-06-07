/**
 * agentTypes.ts — v6.25
 * Core agent types: AgentEventType, AgentEvent, AgentConfig.
 * Extracted from reactEngine.ts (god-module split).
 */
import type { ToolResult } from "./tools/toolRegistry.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type AgentEventType =
  | "thinking"       // Agent is reasoning
  | "tool_call"      // Agent decided to call a tool
  | "tool_result"    // Tool returned a result
  | "text"           // Agent is producing text output
  | "plan"           // Agent created a plan
  | "ask_human"      // Agent needs user input
  | "human_response" // User responded
  | "error"          // An error occurred
  | "done"           // Agent finished
  | "step_start"     // New step in the loop
  | "step_end"       // Step completed
  | "interrupted"    // v5.39: Agent was interrupted by user
  | "redirected"     // v5.39: Agent was redirected to new instructions
  | "paused"         // v5.39: Agent is paused, waiting for resume
  | "resumed";       // v5.39: Agent resumed after pause

export interface AgentEvent {
  type: AgentEventType;
  step?: number;
  content?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: ToolResult;
  plan?: Array<{ id: number; title: string; description?: string }>;
  error?: string;
  summary?: string;
  totalSteps?: number;
  tokenUsage?: { prompt: number; completion: number; total: number };
  filesModified?: string[];  // v5.38: Track files created/modified by the agent
  workingDir?: string;       // v5.38: The primary working directory for ZIP download
  parallelCount?: number;    // v5.41: Number of tools executed in parallel
  cachedCount?: number;      // v5.41: Number of cache hits this step
  stepDurationMs?: number;   // v5.41: Time taken for this step
}

export interface AgentConfig {
  maxSteps: number;
  maxTokens: number;
  temperature: number;
  systemPrompt?: string;
  workspaceDir: string;
  toolCategories?: string[];
  onEvent: (event: AgentEvent) => void;
  signal?: AbortSignal;
  sessionId?: string;  // v5.75: Per-conversation session ID for token budget tracking
}

export interface PendingHumanQuestion {
  question: string;
  resolve: (answer: string) => void;
}

// v5.39: Interrupt/Steer types
export interface PendingRedirect {
  newInstructions: string;
  resolve: () => void;
}

export type AgentState = "running" | "paused" | "interrupted" | "completed";

// v5.41: Tool result cache entry
export interface CacheEntry {
  result: ToolResult;
  timestamp: number;
}


