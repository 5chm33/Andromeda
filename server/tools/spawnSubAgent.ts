/**
 * spawnSubAgent.ts — Parallel Sub-Agent Spawning Tool
 * Andromeda v6.14
 *
 * Allows the main agent to spawn multiple lightweight sub-agents in parallel,
 * each with their own task, system prompt, and tool access. Results are
 * collected and returned to the parent agent.
 *
 * Use cases:
 *  - Parallel research: spawn 3 agents to research different topics simultaneously
 *  - Parallel code generation: spawn agents to write different modules at once
 *  - Parallel validation: spawn agents to check different aspects of a solution
 *  - Fan-out/fan-in: decompose a task, execute in parallel, merge results
 */
import { registerTool } from "./toolRegistry";
import type { ToolExecutionContext, ToolResult } from "./toolRegistry";
import { ReactEngine } from "../reactEngine";

const MAX_SUB_AGENTS = 8;
const SUB_AGENT_MAX_STEPS = 20;
const SUB_AGENT_TIMEOUT_MS = 120_000;

interface SubAgentTask {
  id: string;
  task: string;
  systemPrompt?: string;
}

interface SubAgentResult {
  id: string;
  task: string;
  output: string;
  success: boolean;
  steps: number;
  error?: string;
}

/**
 * Run a single sub-agent and collect its final output.
 */
async function runSubAgent(
  subTask: SubAgentTask,
  ctx: ToolExecutionContext,
): Promise<SubAgentResult> {
  return new Promise((resolve) => {
    const events: string[] = [];
    let lastTextContent = "";
    let stepCount = 0;
    let timedOut = false;

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      resolve({
        id: subTask.id,
        task: subTask.task,
        output: lastTextContent || "(sub-agent timed out)",
        success: false,
        steps: stepCount,
        error: `Sub-agent timed out after ${SUB_AGENT_TIMEOUT_MS}ms`,
      });
    }, SUB_AGENT_TIMEOUT_MS);

    const engine = new ReactEngine({
      maxSteps: SUB_AGENT_MAX_STEPS,
      maxTokens: 0, // auto-detect from model
      temperature: 0.5,
      workspaceDir: ctx.workspaceDir,
      systemPrompt: subTask.systemPrompt ?? `You are a focused sub-agent. Complete the given task efficiently and concisely. When done, call terminate() with your complete result.`,
      signal: ctx.signal,
      sessionId: `sub_${subTask.id}_${Date.now()}`,
      onEvent: (event) => {
        if (timedOut) return;
        stepCount = event.step ?? stepCount;

        if (event.type === "text" && event.content) {
          lastTextContent = event.content;
          events.push(event.content);
        }

        if (event.type === "done") {
          clearTimeout(timeoutHandle);
          const finalOutput = event.summary || lastTextContent || events.join("\n\n");
          resolve({
            id: subTask.id,
            task: subTask.task,
            output: finalOutput.slice(0, 50_000),
            success: true,
            steps: stepCount,
          });
        }

        if (event.type === "error") {
          clearTimeout(timeoutHandle);
          resolve({
            id: subTask.id,
            task: subTask.task,
            output: lastTextContent || "",
            success: false,
            steps: stepCount,
            error: event.content ?? "Sub-agent error",
          });
        }
      },
    });

    engine.run(subTask.task).catch((err) => {
      if (!timedOut) {
        clearTimeout(timeoutHandle);
        resolve({
          id: subTask.id,
          task: subTask.task,
          output: lastTextContent || "",
          success: false,
          steps: stepCount,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
  });
}

async function executeSpawnSubAgent(
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
): Promise<ToolResult> {
  // Parse tasks
  let tasks: SubAgentTask[];

  if (Array.isArray(args.tasks)) {
    tasks = args.tasks.map((t: any, i: number) => ({
      id: String(t.id ?? `sub_${i + 1}`),
      task: String(t.task ?? ""),
      systemPrompt: t.systemPrompt ? String(t.systemPrompt) : undefined,
    }));
  } else if (args.task) {
    // Single task shorthand
    tasks = [{ id: "sub_1", task: String(args.task), systemPrompt: args.systemPrompt ? String(args.systemPrompt) : undefined }];
  } else {
    return { success: false, output: "", error: "Either 'tasks' array or 'task' string is required" };
  }

  if (tasks.length === 0) return { success: false, output: "", error: "No tasks provided" };
  if (tasks.length > MAX_SUB_AGENTS) {
    return { success: false, output: "", error: `Too many sub-agents (max ${MAX_SUB_AGENTS}, got ${tasks.length})` };
  }

  const emptyTasks = tasks.filter(t => !t.task.trim());
  if (emptyTasks.length > 0) {
    return { success: false, output: "", error: `Tasks ${emptyTasks.map(t => t.id).join(", ")} have empty task strings` };
  }

  console.log(`[SpawnSubAgent] Spawning ${tasks.length} sub-agent(s) in parallel...`);
  const startMs = Date.now();

  // Execute all sub-agents in parallel
  const results = await Promise.allSettled(
    tasks.map(task => runSubAgent(task, ctx))
  );

  const elapsed = Date.now() - startMs;
  const subResults: SubAgentResult[] = results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return {
      id: tasks[i].id,
      task: tasks[i].task,
      output: "",
      success: false,
      steps: 0,
      error: r.reason instanceof Error ? r.reason.message : String(r.reason),
    };
  });

  const successCount = subResults.filter(r => r.success).length;
  console.log(`[SpawnSubAgent] Completed ${successCount}/${tasks.length} sub-agents in ${elapsed}ms`);

  // Format output
  const header = `Parallel Sub-Agent Results (${successCount}/${tasks.length} succeeded, ${elapsed}ms total)\n${"─".repeat(60)}\n`;
  const body = subResults.map(r => {
    const status = r.success ? "✓" : "✗";
    const steps = `[${r.steps} steps]`;
    const errorNote = r.error ? `\n  ERROR: ${r.error}` : "";
    return `${status} Sub-Agent ${r.id} ${steps}: ${r.task.slice(0, 100)}\n${r.output}${errorNote}`;
  }).join("\n\n" + "─".repeat(40) + "\n\n");

  return {
    success: successCount > 0,
    output: (header + body).slice(0, 200_000),
    data: { results: subResults, elapsed, successCount, totalCount: tasks.length },
  };
}

registerTool({
  name: "spawn_sub_agent",
  description: "Spawn multiple sub-agents in parallel, each with their own task. Use for fan-out parallelism: research multiple topics, write multiple modules, or validate multiple aspects simultaneously. Results are merged and returned.",
  category: "system",
  safety: "moderate",
  definition: {
    type: "function",
    function: {
      name: "spawn_sub_agent",
      description: "Spawn one or more sub-agents running in parallel. Each sub-agent gets its own task and runs independently. All results are collected and returned together. Use when you can decompose a task into independent parallel subtasks for speed. Maximum 8 sub-agents per call.",
      parameters: {
        type: "object",
        properties: {
          tasks: {
            type: "array",
            description: "Array of sub-agent tasks to run in parallel. Each task runs in its own isolated agent instance.",
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "Unique identifier for this sub-agent (e.g., 'research_1', 'module_auth')" },
                task: { type: "string", description: "The complete task description for this sub-agent to execute" },
                systemPrompt: { type: "string", description: "Optional custom system prompt for this sub-agent (overrides default)" },
              },
              required: ["id", "task"],
            },
          },
          task: {
            type: "string",
            description: "Shorthand for a single sub-agent task (use 'tasks' array for multiple)",
          },
          systemPrompt: {
            type: "string",
            description: "System prompt for the single task shorthand",
          },
        },
      },
    },
  },
  execute: executeSpawnSubAgent,
});
