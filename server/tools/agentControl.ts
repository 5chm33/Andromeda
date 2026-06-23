/**
 * agentControl.ts — Agent Control Tools (ask_human, terminate, planning)
 * Andromeda v5.5
 */

import { registerTool } from "./toolRegistry";
import type { ToolExecutionContext, ToolResult } from "./toolRegistry";

// ─── Ask Human ──────────────────────────────────────────────────────────────
// This tool signals the ReAct engine to pause and request user input.
// The engine intercepts this tool call and emits an SSE event to the frontend.

registerTool({
  name: "ask_human",
  description: "Ask the user a question and wait for their response. Use when you need clarification, confirmation for a destructive action, or additional information.",
  category: "system",
  safety: "safe",
  definition: {
    type: "function",
    function: {
      name: "ask_human",
      description: "Ask the user a question and pause until they respond. Use when you need clarification, confirmation before a destructive action, or additional information to proceed.",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string", description: "The question to ask the user" },
        },
        required: ["question"],
      },
    },
  },
  execute: async (args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolResult> => {
    // The ReAct engine intercepts this before execute() is called.
    // If it somehow reaches here, return the question as output.
    return { success: true, output: `[WAITING FOR HUMAN] ${args.question}` };
  },
});

// ─── Terminate ──────────────────────────────────────────────────────────────
// Signals the ReAct engine that the task is complete.

registerTool({
  name: "terminate",
  description: "Signal that the task is complete. Call this when you have finished the user's request and delivered the final answer.",
  category: "system",
  safety: "safe",
  definition: {
    type: "function",
    function: {
      name: "terminate",
      description: "Signal that the current task is complete. Call this ONLY when you have fully answered the user's question or completed their request. Include a final summary.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string", description: "A brief summary of what was accomplished" },
        },
        required: ["summary"],
      },
    },
  },
  execute: async (args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolResult> => {
    return { success: true, output: String(args.summary ?? "Task completed.") };
  },
});

// ─── Create Plan ────────────────────────────────────────────────────────────
// Allows the agent to create a structured plan before executing.

registerTool({
  name: "create_plan",
  description: "Create a structured step-by-step plan for a complex task. Use at the beginning of multi-step tasks.",
  category: "system",
  safety: "safe",
  definition: {
    type: "function",
    function: {
      name: "create_plan",
      description: "Create a structured step-by-step plan for a complex task. Each step should be a concrete, actionable item. Use this at the beginning of multi-step tasks to organize your approach.",
      parameters: {
        type: "object",
        properties: {
          goal: { type: "string", description: "The overall goal of the plan" },
          steps: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "number", description: "Step number" },
                title: { type: "string", description: "Brief title of the step" },
                description: { type: "string", description: "Detailed description of what to do" },
              },
              required: ["id", "title"],
            },
            description: "Ordered list of steps to accomplish the goal",
          },
        },
        required: ["goal", "steps"],
      },
    },
  },
  execute: async (args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolResult> => {
    const goal = String(args.goal ?? "");
    const steps = (args.steps as Array<{ id: number; title: string; description?: string }>) ?? [];
    const formatted = steps.map(s => `  ${s.id}. ${s.title}${s.description ? ` — ${s.description}` : ""}`).join("\n");
    return { success: true, output: `Plan created:\nGoal: ${goal}\nSteps:\n${formatted}` };
  },
});
