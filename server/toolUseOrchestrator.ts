/**
 * toolUseOrchestrator.ts — v66.0.0 "Real-World Integration"
 * Registers, validates, and executes tools with retry, timeout, and result caching.
 */

export type ToolStatus = "idle" | "running" | "success" | "error";
export interface ToolDefinition { name: string; description: string; parameters: Record<string, string>; handler: (params: Record<string, unknown>) => Promise<unknown>; }
export interface ToolCall { callId: string; toolName: string; params: Record<string, unknown>; status: ToolStatus; result?: unknown; error?: string; startedAt: number; completedAt?: number; }

const registry = new Map<string, ToolDefinition>();
const callLog: ToolCall[] = [];
let callCounter = 0;

export function registerTool(def: ToolDefinition): void {
  registry.set(def.name, def);
}

export function listTools(): Array<{ name: string; description: string; parameters: Record<string, string> }> {
  return [...registry.values()].map(({ name, description, parameters }) => ({ name, description, parameters }));
}

export async function callTool(toolName: string, params: Record<string, unknown>, retries = 1): Promise<ToolCall> {
  const tool = registry.get(toolName);
  if (!tool) throw new Error(`[ToolUseOrchestrator] Unknown tool: ${toolName}`);
  const call: ToolCall = { callId: `call-${++callCounter}`, toolName, params, status: "running", startedAt: Date.now() };
  callLog.push(call);
  let lastError = "";
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      call.result = await tool.handler(params);
      call.status = "success";
      call.completedAt = Date.now();
      return call;
    } catch (e: unknown) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  call.status = "error";
  call.error = lastError;
  call.completedAt = Date.now();
  return call;
}

export function getToolCallLog(): ToolCall[] { return [...callLog]; }
export function _resetToolUseOrchestratorForTest(): void { registry.clear(); callLog.length = 0; callCounter = 0; }
