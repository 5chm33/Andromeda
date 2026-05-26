/**
 * toolRegistry.ts — Central Tool Registry for the ReAct Engine
 * Andromeda v5.5
 *
 * Every tool is a self-contained unit with:
 *  - A JSON Schema definition (for LLM function calling)
 *  - An execute() function that returns a string result
 *  - Metadata (name, description, category, safety level)
 */

import type { ToolDefinition } from "../llmProvider";

// ─── Types ──────────────────────────────────────────────────────────────────

export type ToolSafety = "safe" | "moderate" | "dangerous";
export type ToolCategory = "code" | "search" | "browser" | "filesystem" | "analysis" | "system" | "mcp" | "sandbox" | "vision" | "agent";

export interface ToolExecutionContext {
  workspaceDir: string;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  artifacts?: Array<{ name: string; path: string; type: string }>;
  /** v6.14: Optional structured data payload for tools that return rich objects (e.g. screenshots, sub-agent results) */
  data?: Record<string, unknown>;
}

export interface RegisteredTool {
  name: string;
  description: string;
  category: ToolCategory;
  safety: ToolSafety;
  definition: ToolDefinition;
  execute: (args: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<ToolResult>;
}

// ─── Registry ───────────────────────────────────────────────────────────────

const registry = new Map<string, RegisteredTool>();

export function registerTool(tool: RegisteredTool): void {
  if (registry.has(tool.name)) {
    console.warn(`[ToolRegistry] Overwriting existing tool: ${tool.name}`);
  }
  registry.set(tool.name, tool);
}

export function getTool(name: string): RegisteredTool | undefined {
  return registry.get(name);
}

export function getAllTools(): RegisteredTool[] {
  return Array.from(registry.values());
}

export function getToolDefinitions(filter?: { categories?: ToolCategory[]; maxSafety?: ToolSafety }): ToolDefinition[] {
  const safetyOrder: ToolSafety[] = ["safe", "moderate", "dangerous"];
  const maxIdx = filter?.maxSafety ? safetyOrder.indexOf(filter.maxSafety) : 2;

  return getAllTools()
    .filter(t => {
      if (filter?.categories && !filter.categories.includes(t.category)) return false;
      if (safetyOrder.indexOf(t.safety) > maxIdx) return false;
      return true;
    })
    .map(t => t.definition);
}

export function getToolsByCategory(category: ToolCategory): RegisteredTool[] {
  return getAllTools().filter(t => t.category === category);
}

export function listToolNames(): string[] {
  return Array.from(registry.keys());
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
): Promise<ToolResult> {
  const tool = registry.get(name);
  if (!tool) {
    return { success: false, output: "", error: `Unknown tool: ${name}` };
  }
  try {
    return await tool.execute(args, ctx);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, output: "", error: `Tool "${name}" threw: ${message}` };
  }
}
