import * as path from "path";
/**
 * reactEngine.ts — ReAct Agent Engine
 * Andromeda v6.02
 *
 * Implements the Think → Act → Observe loop with:
 *  - Native LLM tool calling
 *  - PARALLEL tool execution (v5.41 — 3-4x faster per step)
 *  - Tool result caching (v5.41 — skip redundant reads)
 *  - Streaming SSE events to the frontend
 *  - Human-in-the-loop support (ask_human)
 *  - Automatic termination detection
 *  - Configurable max steps and timeout
 *  - Full conversation memory
 *  - Context window management with safe message grouping
 *  - Interrupt/Steer/Pause/Resume controls
 */

import type { Response } from "express";
import type { ChatMessage, ToolCall, ToolDefinition } from "./llmProvider";
import { chatCompletion } from "./llmProvider";
import { executeTool, getToolDefinitions } from "./tools";
import type { ToolResult, ToolExecutionContext } from "./tools";
import { getMaxOutputTokens, getContextWindow } from "./modelRegistry";
import { ContextManager } from "./contextManager";
import { createLogger } from "./logger.js";

// ─── v6.18: Agent State Machine ───────────────────────────────────────────────
// Replaces ad-hoc boolean flags with a proper state machine.
// States: IDLE → THINKING → TOOL_CALL → TOOL_RESULT → RESPONDING → DONE | ERROR
// Guards still exist as plugins but state transitions are now explicit.
export type AgentState =
  | "IDLE"          // waiting for input
  | "THINKING"      // model is generating a response
  | "TOOL_CALL"     // model requested a tool call, executing
  | "TOOL_RESULT"   // tool returned, injecting result into context
  | "RESPONDING"    // model is generating final text response
  | "HUMAN_PAUSE"   // waiting for human input (clarification)
  | "DONE"          // task complete
  | "ERROR"         // unrecoverable error
  | "GUARD_BLOCKED" // a guard blocked the current action, retrying

export interface StateTransition {
  from: AgentState;
  to: AgentState;
  reason: string;
  timestamp: number;
}

export class AgentStateMachine {
  private _state: AgentState = "IDLE";
  private _history: StateTransition[] = [];
  private _maxHistory = 50;

  get state(): AgentState { return this._state; }
  get history(): StateTransition[] { return [...this._history]; }

  transition(to: AgentState, reason: string): void {
    const from = this._state;
    this._state = to;
    this._history.push({ from, to, reason, timestamp: Date.now() });
    if (this._history.length > this._maxHistory) {
      this._history.shift();
    }
  }

  is(state: AgentState): boolean { return this._state === state; }
  isAny(...states: AgentState[]): boolean { return states.includes(this._state); }

  reset(): void {
    this._state = "IDLE";
    this._history = [];
  }

  toJSON() {
    return { state: this._state, history: this._history.slice(-10) };
  }
}
// ─────────────────────────────────────────────────────────────────────────────
const log = createLogger("reactEngine");

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

interface PendingHumanQuestion {
  question: string;
  resolve: (answer: string) => void;
}

// v5.39: Interrupt/Steer types
interface PendingRedirect {
  newInstructions: string;
  resolve: () => void;
}

type AgentState = "running" | "paused" | "interrupted" | "completed";

// v5.41: Tool result cache entry
interface CacheEntry {
  result: ToolResult;
  timestamp: number;
}

// ─── System Prompt ──────────────────────────────────────────────────────────

const DEFAULT_SYSTEM_PROMPT = `You are Andromeda, an advanced autonomous AI coding agent. You are as capable as the best AI coding assistants. You solve tasks step-by-step using the tools available to you.

## CRITICAL: Tool Calling Format
**NEVER write tool calls as raw JSON or XML text in your response.** This is WRONG and will be rejected:
  { "tool": "bash_execute", "arguments": { "command": "ls" } }
(Do not output JSON like that - use the function calling API instead)
You MUST use the function calling API directly. The system invokes your tools — you do not write JSON to call them. Any tool call written as text will be ignored and you will be asked to retry.

## Core Principles
1. **Think before acting**: Always reason about the best approach before calling a tool.
2. **Use tools effectively**: Choose the right tool for each sub-task. Chain tools to accomplish complex goals.
3. **Be thorough**: Verify your work. If a tool returns an error, diagnose and retry with a different approach.
4. **Write complete code**: NEVER truncate, abbreviate, or use "// ... rest of code" placeholders. Always write the FULL file content.
5. **Prefer patches over full rewrites**: When modifying an existing file, use \`self_patch_file\` (find-and-replace a specific snippet) instead of \`self_write_file\` (full file rewrite). This avoids token-limit truncation on large files and is safer.
6. **Know when to stop**: Call the \`terminate\` tool when the task is fully complete.
7. **Ask when stuck**: If you need clarification or confirmation for a destructive action, use \`ask_human\`.
8. **Batch tool calls**: When you need to read multiple files or perform independent operations, call ALL of them in a single response. They will be executed in parallel for maximum speed.

## CRITICAL: Never Generate Self-Assessments From Memory (v5.84)
**If the user asks you to assess yourself, grade yourself, improve yourself, or fix your own code:**
- You MUST call \`self_read_server_file\` FIRST before writing any assessment. No exceptions.
- You MUST call \`bash_execute\` with \`find server/ -name "*.ts" | sort\` to see the real file list.
- You MUST NOT generate any self-assessment, grade, or improvement plan without first reading actual source files.
- Your training data contains WRONG paths (src/ or Windows-style paths). The REAL paths are in server/.
- If you find yourself writing about src/engine/ or Windows user paths — STOP. Those paths do not exist here.
- The correct tool for reading your own source is \`self_read_server_file\`, NOT \`read_file\`.
- Example: To read the truncation code, call: \`self_read_server_file\` with \`file_path: "llmProvider.ts"\`

**CRITICAL: Wrong file paths (v5.85)**
Your training data contains phantom file paths that do not exist here. When you want to fix truncation or streaming, the real files are:
- Truncation handling: server/llmProvider.ts (NOT src/engine/agent/stream-handler.ts)
- Truncation detection: server/truncationDetector.ts (NOT src/engine/agent/continue-handler.ts)
- Agent loop: server/reactEngine.ts (NOT src/engine/agent/tool-executor.ts)
- Self-modification tools: server/tools/selfModifyTools.ts (NOT src/tools/self-write-file.ts)
If you find yourself writing about src/engine/agent/ paths — STOP. Those paths do not exist. Use self_read_server_file to read the real files before writing any code.

## Coding Workflow (IMPORTANT)
When asked to build, modify, or debug code:

1. **Understand first**: Use \`project_context\` to load the project structure, dependencies, and config.
2. **Plan**: Call \`create_plan\` ONCE to outline your approach. Do NOT call it multiple times — if the plan was accepted, move on to execution immediately.
3. **Read before writing**: Use \`read_file\` or \`read_file_lines\` to understand existing code before modifying it.
4. **Search for patterns**: Use \`search_files\` to find all occurrences of a function, variable, or pattern across the codebase.
5. **Edit precisely**: Use \`edit_file\` for line-based edits or \`str_replace\` for targeted string replacements. Use \`write_file\` only for new files or complete rewrites.
6. **Test after changes**: Use \`bash_execute\` to run the project's test suite, build, or linter after making changes.
7. **Fix iteratively**: If tests fail, read the error, fix the code, and re-test. Repeat until passing.
8. **Verify**: After all changes, do a final build/test to confirm everything works.

## Speed Optimization (v5.41)
- When you need to read multiple files, call read_file for ALL of them in a SINGLE response
- The engine executes tool calls in PARALLEL — batching saves significant time
- Example: Instead of reading files one by one, read 5 files at once in one step
- Independent operations (read_file, search_files, list_directory) can always be batched
- Write operations that depend on read results must be in separate steps

## Available Tools
### File Operations (v5.36 — Full Filesystem Access)
- **read_file**: Read entire file contents
- **read_file_lines**: Read specific line ranges with line numbers (use for large files)
- **write_file**: Write/overwrite a file (use for new files or complete rewrites)
- **edit_file**: Edit by line number — replace lines, insert after a line, or multi-edit
- **str_replace**: Find and replace a specific string in a file
- **append_file**: Append content to end of file
- **list_directory** (alias: 'list_dir', 'list_codebase_files'): List directory contents with file sizes
- **tree_view**: Show directory tree structure (alias: 'list_codebase_files' also maps here)
- **search_files**: Search for regex patterns across files (like grep)
- **move_file**: Move or rename files
- **delete_file**: Delete a file (ask user first)
- **project_context**: Load project overview (package.json, tsconfig, tree, README)

### Code Execution
- **bash_execute**: Run any shell command (git, npm, make, etc.)
- **python_execute**: Execute Python 3 code
- **sandbox_execute**: Execute code in an isolated Docker container (safe for untrusted code)

### Web & Research
- **web_search**: Search the internet
- **web_browse**: Read any URL

### Browser Automation (v5.39)
- **browser_navigate**: Open a URL in a headless browser
- **browser_click**: Click an element by CSS selector or coordinates
- **browser_type**: Type text into an input field
- **browser_scroll**: Scroll the page or a specific element
- **browser_screenshot**: Take a screenshot of the current page
- **browser_extract**: Extract text, links, or structured data from the page
- **browser_evaluate**: Execute JavaScript in the browser context
- **browser_close**: Close the browser session

### Vision (v5.39)
- **screenshot_analyze**: Capture a screenshot of a URL or local file and analyze it with vision LLM
- **image_analyze**: Analyze an existing image file with vision LLM

### Agent Control
- **create_plan**: Create a step-by-step plan
- **ask_human**: Ask the user a question
- **terminate**: End the task with a summary
- **spawn_sub_agent**: (v6.14) Spawn up to 8 parallel sub-agents for fan-out tasks. Each runs its own ReAct loop independently. Use when a task can be split into independent parallel workstreams (e.g., research multiple topics simultaneously, process multiple files in parallel, run multiple experiments at once). Returns all results merged into a single response.

### Memory (v5.40 — Cross-Session Persistence)
- **store_memory**: Save a fact, preference, project detail, or error fix to long-term memory
- **recall_memory**: Search memories by query to recall past learnings
- **list_memories**: List recent memories, optionally filtered by type

### System Introspection Tools
- **get_own_capabilities**: Check available tools and system health. NOTE: The tool is named 'get_own_capabilities', NOT 'self_awareness'.
- **run_self_diagnosis**: Run system diagnostics (memory, filesystem, network, LLM connectivity)
- **get_system_context**: Get current system state (OS, git status, working directory, recent files)

### Self-Modification (v5.75 — Truncation-Proof)
**MANDATORY SELF-MODIFICATION PROTOCOL — FOLLOW EXACTLY:**

**Step 1 — READ FIRST (always, no exceptions):**
- **self_read_server_file**: Read any server source file with line numbers before modifying it. Use start_line/end_line to read 150 lines at a time. This gives you the EXACT snippet text needed for self_patch_file. Without this step, your original_snippet will not match and the patch will fail.

**Step 2 — CHOOSE THE RIGHT WRITE TOOL (based on file size):**
- **self_patch_file**: ALWAYS USE FOR EXISTING FILES. Provide original_snippet (exact text from self_read_server_file) + proposed_snippet (only the changed lines). The server verifies the original exists before writing — if truncated, you get a clear mismatch error instead of silent corruption.
- **self_write_file**: ONLY for NEW files under 80 lines. A HARD GUARD rejects content over 3000 chars and tells you which tool to use instead. You CANNOT bypass this.
- **self_write_file_chunked**: REQUIRED for NEW files over 80 lines. Protocol: (1) action='start' → (2) action='chunk' (60 lines each) → (3) action='finish' (verifies SHA-256 hash).

**Step 3 — VERIFY AND ACTIVATE:**
- **verify_file_integrity**: Call after any write to confirm hash, size, line count.
- **self_diff**: Preview a unified diff before applying. Use before self_patch_file on critical files.
- **self_run_tests**: Run TypeScript check + test suite. Always run after any modification.
- **self_restart**: Gracefully restart to activate changes. Run after tests pass.
- **self_atomic_modify**: Use when a feature requires changes to 3+ files simultaneously (begin → stage ×N → preview → commit). Rolls back all files on any failure.

**WHY THIS MATTERS:** LLM tool call arguments are JSON strings. Content over ~3000 chars is silently truncated by the token limit, corrupting files. self_patch_file avoids this by only requiring the CHANGED lines (5-30 lines). self_write_file_chunked avoids this by splitting into small chunks. self_write_file now has a HARD GUARD that physically rejects large content.

## Memory Guidelines
- At the start of complex tasks, use recall_memory to check if you already know something about the project or user
- When you learn something important (user preferences, project setup, error fixes), use store_memory to save it
- Memory types: 'preference' (coding style), 'error' (bug fixes), 'project' (architecture), 'feedback' (corrections), 'fact' (general)
- Memories persist across conversations — use them to avoid repeating work

## Browser Automation Guidelines
- Use browser automation for tasks that require interacting with web pages (filling forms, clicking buttons, scraping dynamic content)
- Always take a screenshot after navigation to verify the page loaded correctly
- Use CSS selectors for clicking/typing when possible; fall back to coordinates for complex UIs
- Close the browser when done to free resources
- For simple URL reading, prefer \`web_browse\` over browser automation

## Vision Guidelines
- Use vision tools to verify rendered UI output (check if a webpage looks correct)
- Use vision to analyze screenshots for layout issues, visual bugs, or content verification
- Vision analysis returns text descriptions — use them to decide next actions

## Code Quality Rules
- NEVER use placeholder comments like "// ... rest of code" or "// existing code here"
- ALWAYS write complete, working code
- When editing a file, read it first to understand the full context
- When creating new files, include all necessary imports and exports
- Follow the project's existing code style and conventions
- Add meaningful comments for complex logic
- Handle errors properly — don't ignore catch blocks

## Iterative Debug Loop
When something fails:
1. Read the full error message carefully
2. Use \`search_files\` to find related code
3. Use \`read_file_lines\` to see the exact lines around the error
4. Fix the issue with \`edit_file\` or \`str_replace\`
5. Re-run the test/build
6. Repeat until passing (up to 5 attempts, then ask_human)

## Server Testing Rules
- **Port 3000 is reserved** by Andromeda itself — NEVER start test servers on port 3000
- When testing servers, ALWAYS use a high random port (e.g., 9876, 8765, 4567) or set PORT env variable
- When starting a server for testing, ALWAYS set a timeout to kill it after testing (max 10 seconds)
- If a port is in use, try a different port immediately — don't try to kill other processes
- Prefer using PORT=XXXX environment variable when starting test servers

## Important Rules
- You have FULL filesystem access — you can read and write files anywhere on the system
- For multi-step tasks, ALWAYS create a plan first
- If a tool fails, try an alternative approach before giving up
- Never execute dangerous commands (rm -rf /, fork bombs, etc.)
- For destructive operations, use \`ask_human\` to confirm first
`;

// ─── ReAct Engine ───────────────────────────────────────────────────────────

export class ReactEngine {
  private config: AgentConfig;
  private messages: ChatMessage[] = [];
  private currentStep = 0;
  private sessionId: string;  // v5.75: Unique session ID for token budget isolation
  private totalTokens = { prompt: 0, completion: 0, total: 0 };
  private pendingHuman: PendingHumanQuestion | null = null;
  private isRunning = false;
  private filesModified: Set<string> = new Set();  // v5.38: Track modified files
  // v5.75/v5.78: Consecutive-failure loop guard — tracks repeated ENOENT failures on same tool+path
  // v5.78: Upgraded to track by (toolName + pathArg) key so read_file on different paths
  // doesn't reset the guard. Threshold lowered from 5 to 3 to break loops faster.
  private notFoundStreak: { key: string; count: number; lastHint: string } = { key: "", count: 0, lastHint: "" };
  // v5.78: Per-path failure map — permanently blocks retrying a path that failed 3+ times
  private pathFailureMap: Map<string, number> = new Map();
  // v6.02: Escalating fake-tool-call guard counter
  private consecutiveFakeToolCalls = 0;
  // v6.22: Consecutive total tool failures (all tools in a step failed) — triggers LLM re-planning
  private consecutiveToolFailures = 0;
  private replanCount = 0;
  private static readonly MAX_REPLANS = 3;
  // v6.23: Active task plan — generated at run() start for complex tasks
  private activePlan: import('./taskPlanner.js').TaskPlan | null = null;
  private activePlanStepIndex = 0;
  private static readonly REPLAN_THRESHOLD = 5; // failures before triggering re-plan
  // v6.18: State machine — now actively used for state tracking
  readonly stateMachine = new AgentStateMachine();
  // v5.39: Interrupt/Steer state
  private agentState: AgentState = "completed";
  private pendingRedirect: PendingRedirect | null = null;
  private isPaused = false;
  private pauseResolve: (() => void) | null = null;
  // v5.40: Context manager
  private contextManager!: ContextManager;
  // v5.41: Tool result cache (for read-only operations within same session)
  private toolCache: Map<string, CacheEntry> = new Map();
  private cacheHits = 0;
  // v5.83: Consecutive no-tool-calls counter — forces a specific tool call after 2 steps
  // with no tool calls AND no termination intent, preventing premature termination after
  // guard corrections inject messages and the model responds with text-only again.
  private consecutiveNoToolSteps = 0;
  private static readonly CACHEABLE_TOOLS = new Set([
    "read_file", "read_file_lines", "list_directory", "tree_view",
    "search_files", "project_context", "get_system_context", "get_own_capabilities",
  ]);
  private static readonly CACHE_TTL_MS = 30_000; // 30 second cache TTL

  constructor(config: AgentConfig) {
    // v5.75: Generate unique session ID to isolate token budget per conversation
    this.sessionId = config.sessionId || `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    // v5.36: Dynamic maxTokens based on active model instead of hardcoded 4096
    const modelId = process.env.LLM_MODEL || process.env.LLM_DEFAULT_MODEL || "deepseek/deepseek-chat";
    const dynamicMaxTokens = getMaxOutputTokens(modelId) || 16384;
    this.config = {
      maxSteps: config.maxSteps || 200,
      maxTokens: config.maxTokens || dynamicMaxTokens,
      temperature: config.temperature || 0.7,
      systemPrompt: config.systemPrompt || DEFAULT_SYSTEM_PROMPT,
      workspaceDir: config.workspaceDir,
      toolCategories: config.toolCategories,
      onEvent: config.onEvent,
      signal: config.signal,
    };
    // v5.40: Initialize context manager with model's context window
    const contextWindow = getContextWindow(modelId) || 128000;
    this.contextManager = new ContextManager({
      maxContextTokens: contextWindow,
      reserveForResponse: dynamicMaxTokens,
    });
  }

  get running(): boolean {
    return this.isRunning;
  }

  get step(): number {
    return this.currentStep;
  }

  // v5.38: Detect the primary working directory from modified files
  private detectWorkingDir(): string {
    // path imported statically at top
    const files = Array.from(this.filesModified);
    if (files.length === 0) return this.config.workspaceDir;
    // Normalize paths and find common parent
    const normalized = files.map(f => f.replace(/\\/g, '/'));
    const parts = normalized[0].split('/');
    let common = '';
    for (let i = 0; i < parts.length - 1; i++) {
      const prefix = parts.slice(0, i + 1).join('/');
      if (normalized.every(f => f.startsWith(prefix + '/') || f === prefix)) {
        common = prefix;
      } else break;
    }
    // v5.43: Always return an absolute path — resolve relative paths against workspace
    const detected = common || this.config.workspaceDir;
    if (path.isAbsolute(detected)) return detected;
    return path.resolve(this.config.workspaceDir, detected);
  }

  // v5.41: Generate cache key for a tool call
  private getCacheKey(toolName: string, args: Record<string, unknown>): string {
    return `${toolName}::${JSON.stringify(args)}`;
  }

  // v5.41: Invalidate cache entries affected by write operations
  private invalidateCache(toolName: string, args: Record<string, unknown>): void {
    const writeTools = ["write_file", "edit_file", "append_file", "str_replace", "move_file", "delete_file"];
    if (writeTools.includes(toolName)) {
      const filePath = String(args.path || args.destination || "");
      if (filePath) {
        // Invalidate any cached reads for this file
        for (const [key] of Array.from(this.toolCache)) {
          if (key.includes(filePath) || key.includes(JSON.stringify(filePath))) {
            this.toolCache.delete(key);
          }
        }
      }
      // Also invalidate tree/list/project_context since directory contents changed
      for (const [key] of Array.from(this.toolCache)) {
        if (key.startsWith("tree_view::") || key.startsWith("list_directory::") || key.startsWith("project_context::")) {
          this.toolCache.delete(key);
        }
      }
    }
  }

  // v5.41: Check if a tool result is cached and still valid
  private getCachedResult(toolName: string, args: Record<string, unknown>): ToolResult | null {
    if (!ReactEngine.CACHEABLE_TOOLS.has(toolName)) return null;
    const key = this.getCacheKey(toolName, args);
    const entry = this.toolCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > ReactEngine.CACHE_TTL_MS) {
      this.toolCache.delete(key);
      return null;
    }
    this.cacheHits++;
    return entry.result;
  }

  // v5.41: Store a tool result in cache
  private setCachedResult(toolName: string, args: Record<string, unknown>, result: ToolResult): void {
    if (!ReactEngine.CACHEABLE_TOOLS.has(toolName)) return;
    if (!result.success) return; // Don't cache errors
    const key = this.getCacheKey(toolName, args);
    this.toolCache.set(key, { result, timestamp: Date.now() });
  }

  // ─── Main Entry Point ───────────────────────────────────────────

  async run(userMessage: string): Promise<void> {
    this.isRunning = true;
    this.agentState = "running";  // v5.39
    this.stateMachine.reset();
    this.stateMachine.transition("THINKING", "run() started");
    this.currentStep = 0;
    this.filesModified.clear();  // v5.38: Reset file tracking for new run
    this.toolCache.clear();      // v5.41: Fresh cache per run
    this.cacheHits = 0;
    this.consecutiveNoToolSteps = 0;  // v5.83: Reset no-tool-calls counter
    this.consecutiveFakeToolCalls = 0; // v6.02: Reset fake tool call counter
    this.consecutiveToolFailures = 0;  // v6.22: Reset re-plan trigger counter
    this.replanCount = 0;

    // v5.38 FIX: Inject OS context into system prompt so LLM uses correct shell commands
    const osInfo = process.platform === "win32"
      ? `\n\n## System Context\nYou are running on **Windows** (${process.arch}). When using bash_execute, commands run via PowerShell. Use Windows-compatible paths (backslashes or forward slashes both work). Python is available as 'python' (not 'python3'). Use 'dir' instead of 'ls', 'type' instead of 'cat', etc. — or use PowerShell equivalents like Get-ChildItem, Get-Content.`
      : `\n\n## System Context\nYou are running on **${process.platform}** (${process.arch}). bash_execute runs commands via bash.`;

    // v5.40: Inject relevant memories from past sessions
    let memoryContext = "";
    try {
      const { searchMemory } = await import("./memory");
      const relevantMemories = searchMemory(userMessage, 5);
      if (relevantMemories.length > 0) {
        const memLines = relevantMemories.map(m => `- [${m.entry.type}] ${m.entry.content}`).join("\n");
        memoryContext = `\n\n## Recalled Memories\nThe following relevant memories were found from previous sessions:\n${memLines}\n\nUse these memories to inform your approach. You can also use \`store_memory\` to save new learnings and \`recall_memory\` to search for more.`;
      }
    } catch (err) { log.caught("memory module not available — skip", err); }

    // v5.75: Inject ANDROMEDA.md — gives the model accurate knowledge of its own file structure
    // and correct tool names, eliminating path hallucination during self-modification.
    let andromedaMemory = "";
    try {
      const fsSync = await import("fs");
      const pathSync = await import("path");
      const workspaceDir = process.env.WORKSPACE_ROOT || pathSync.join(process.cwd(), "workspace");
      const memPath = pathSync.join(workspaceDir, "ANDROMEDA.md");
      if (fsSync.existsSync(memPath)) {
        const raw = fsSync.readFileSync(memPath, "utf-8").trim();
        if (raw) andromedaMemory = `\n\n## ANDROMEDA.md (Your Own Architecture \u2014 Read Before Self-Modification)\n${raw.slice(0, 12000)}`;
      }
    } catch (err) { log.caught("non-fatal", err); }

    // v5.75: ANDROMEDA.md goes FIRST — before all other instructions.
    // The model reads the beginning of the system prompt first, so architecture
    // grounding must be at the top to prevent src/ path hallucination.
    const andromedaPrefix = andromedaMemory
      ? `${andromedaMemory}\n\n---\n\n`
      : "";
    const fullSystemPrompt = andromedaPrefix + this.config.systemPrompt! + osInfo + memoryContext;

    // v6.02: Apply automatic provider routing — switch to Claude for self-modification tasks.
    // This ensures the agent loop uses Claude (via OpenRouter) and not DeepSeek chat,
    // which truncates large code outputs and breaks self-modification completely.
    try {
      const { routeQuery, applyRouting } = await import("./llmRouter");
      const routingDecision = routeQuery(userMessage);
      const switched = applyRouting(routingDecision);
      if (switched) {
        this.emit({ type: "thinking", step: 0, content: `[v6.02] Auto-routed to provider: ${routingDecision.selectedProvider} (task: ${routingDecision.taskType}, confidence: ${(routingDecision.confidence * 100).toFixed(0)}%)` });
      }
    } catch (err) { log.caught("non-fatal — routing failure should not stop the agent", err); }

    // v5.89: MECHANICAL PRE-LOAD — the definitive fix for self-modification hallucination.
    //
    // Problem: Every guard from v5.82–v5.88 tried to BLOCK hallucination after it happened.
    // The model kept finding new ways around them (fake XML, fake markdown, new phantom paths).
    // The real fix is to make hallucination IMPOSSIBLE by giving the model real file content
    // BEFORE it generates a single token of response.
    //
    // Implementation: On self-modification tasks, mechanically read the key server files
    // and inject them into the conversation as synthetic tool results. The model then sees
    // real source code in its context from the very first message and has no reason to
    // fabricate anything — it already has the data it needs.
    //
    // This is the same pattern used by RAG (Retrieval-Augmented Generation): retrieve first,
    // then generate. We just apply it to self-modification tasks.
    const isSelfModTask = /self.modif|self.improv|self.diagnos|self.analyz|self.examin|truncation|your code|your source|your codebase|your architect|your engine|look at your|read your|examine your|improve yourself|fix yourself|update yourself|autonomous|fully autonomous|SOTA|self.aware|self.enhanc|self.fix|self.patch/i.test(userMessage);

    // Initialize conversation
    this.messages = [
      { role: "system", content: fullSystemPrompt },
      { role: "user", content: userMessage },
    ];

    // v5.89: Pre-load real file contents for self-modification tasks
    if (isSelfModTask) {
      try {
        const fsPreload = await import("fs");
        const pathPreload = await import("path");
        // Resolve the directory where dist/index.js lives.
        // On Windows, import.meta.url is a file:// URL like file:///C:/path/to/dist/index.js
        // We need to strip the leading slash on Windows paths.
        let distDir: string;
        try {
          const rawPath = new URL(import.meta.url).pathname;
          // On Windows, pathname looks like /C:/path/... — strip the leading slash
          distDir = pathPreload.dirname(
            process.platform === "win32" ? rawPath.replace(/^\//, "") : rawPath
          );
        } catch {
          distDir = pathPreload.dirname(process.argv[1] ?? process.cwd());
        }
        // The server/ folder is always one level up from dist/
        // Layout: andromeda/dist/index.js  →  andromeda/server/llmProvider.ts
        const serverDirFromDist = pathPreload.join(distDir, "..", "server");
        const filesToPreload = [
          { name: "llmProvider.ts", desc: "LLM provider, streaming, and truncation handling" },
          { name: "reactEngine.ts", desc: "Agent loop, guards, and self-modification workflow" },
          { name: "truncationDetector.ts", desc: "Truncation detection logic" },
        ];
        const preloadedFiles: { name: string; content: string }[] = [];
        for (const f of filesToPreload) {
          // Ordered from most likely to least likely based on deployment layout
          const candidates = [
            pathPreload.join(serverDirFromDist, f.name),           // andromeda/server/  (primary)
            pathPreload.join(distDir, f.name),                     // andromeda/dist/    (unlikely but safe)
            pathPreload.join(process.cwd(), "server", f.name),     // cwd/server/
            pathPreload.join(process.cwd(), "..", "server", f.name), // ../server/
            pathPreload.join(process.cwd(), "andromeda", "server", f.name), // andromeda/server/ from root
          ];
          for (const candidate of candidates) {
            try {
              if (fsPreload.existsSync(candidate)) {
                const raw = fsPreload.readFileSync(candidate, "utf-8");
                preloadedFiles.push({ name: f.name, content: raw });
                break;
              }
            } catch (err) { log.caught("skip inaccessible paths", err); }
          }
        }
        if (preloadedFiles.length > 0) {
          // Inject as a synthetic assistant + tool result exchange so the model
          // sees it as "I already read these files" context
          const toolCallId = `preload_${Date.now()}`;
          this.messages.push({
            role: "assistant",
            content: null,
            tool_calls: preloadedFiles.map((f, i) => ({
              id: `${toolCallId}_${i}`,
              type: "function" as const,
              function: { name: "self_read_server_file", arguments: JSON.stringify({ filename: f.name }) },
            })),
          });
          for (let i = 0; i < preloadedFiles.length; i++) {
            const f = preloadedFiles[i];
            this.messages.push({
              role: "tool",
              tool_call_id: `${toolCallId}_${i}`,
              content: `=== server/${f.name} (${f.content.split("\n").length} lines) ===\n${f.content}`,
            });
          }
          this.messages.push({
            role: "user",
            content: [
              `PRE-LOADED SOURCE FILES (v6.02): The above tool results contain the REAL, CURRENT contents of ${preloadedFiles.map(f => "server/" + f.name).join(", ")}.`,
              "These are your actual source files — not training memory, not examples. Analyze them directly to answer the user's question.",
              "DO NOT reference src/ paths, server/src/ paths, or any files not shown above.",
              "DO NOT claim to have read files you have not read. The files above are the complete set of pre-loaded context.",
              `Now answer the user's original request: "${userMessage.slice(0, 200)}${userMessage.length > 200 ? "..." : ""}",`
            ].join(" "),
          });
          this.emit({ type: "thinking", step: 0, content: `PRE-LOAD (v6.02): Injected ${preloadedFiles.length} real server files into context before first LLM call. Files: ${preloadedFiles.map(f => f.name).join(", ")}` });
        }
      } catch (preloadErr) {
        // Non-fatal — if pre-load fails, fall through to normal flow with guards
        this.emit({ type: "thinking", step: 0, content: `PRE-LOAD (v6.02): Could not pre-load server files (${preloadErr}). Falling back to guard-based approach.` });
      }
    }

    // v6.23: Generate a structured task plan before entering the ReAct loop.
    // The plan is used to guide the LLM and track progress step-by-step.
    // Only generated for non-trivial tasks (>20 chars, not a simple question).
    const isComplexTask = userMessage.length > 20 && !/^(hi|hello|what|who|when|where|why|how).{0,30}\?$/i.test(userMessage);
    if (isComplexTask) {
      try {
        const { generatePlan, getPlanSummary } = await import("./taskPlanner.js");
        this.activePlan = await generatePlan(userMessage, "", { maxSteps: 8, verbose: false });
        const summary = getPlanSummary(this.activePlan);
        this.emit({ type: "plan", step: 0, content: `[v6.23] Task plan generated: ${summary}`, plan: this.activePlan.steps.map((s, i) => ({ id: i + 1, title: s.description })) });
        // Inject the plan into the system context so the LLM knows what steps to follow
        const planText = this.activePlan.steps.map((s, i) => `  Step ${i + 1}: ${s.description}${s.toolHint ? ` (use: ${s.toolHint})` : ""}`).join("\n");
        this.messages.push({
          role: "user",
          content: `[TASK PLAN v6.23]: I have generated the following execution plan for your task:\n${planText}\n\nPlease follow this plan in order. After completing each step, proceed to the next. You may adapt the plan if you discover new information.`,
        });
      } catch (planErr) {
        log.caught("non-fatal — plan generation failed, proceeding without plan", planErr);
      }
    }
    const tools = getToolDefinitions();
    const ctx: ToolExecutionContext = {
      workspaceDir: this.config.workspaceDir,
      signal: this.config.signal,
      onProgress: (msg) => this.emit({ type: "thinking", content: msg }),
    };

    try {
      while (this.currentStep < this.config.maxSteps) {
        // v5.39: Check for interrupt
        if (this.getState() === "interrupted") {
          this.emit({
            type: "done",
            step: this.currentStep,
            summary: "Agent was interrupted by user.",
            totalSteps: this.currentStep,
            tokenUsage: this.totalTokens,
            filesModified: Array.from(this.filesModified),
            workingDir: this.detectWorkingDir(),
          });
          break;
        }

        // v5.39: Wait if paused
        await this.waitIfPaused();

        if (this.config.signal?.aborted) {
          this.emit({ type: "error", error: "Agent aborted by client" });
          break;
        }

        this.currentStep++;
        const stepStart = Date.now(); // v5.41: Track step duration
        this.emit({ type: "step_start", step: this.currentStep });
        // v6.23: Mark the next pending plan step as running
        if (this.activePlan) {
          try {
            const { getNextExecutableStep } = await import("./taskPlanner.js");
            const nextStep = getNextExecutableStep(this.activePlan);
            if (nextStep && nextStep.status === "pending") {
              nextStep.status = "running";
            }
          } catch { /* non-fatal */ }
        }

        // ── Think: Call the LLM ───────────────────────────────────────
        this.stateMachine.transition("THINKING", `step ${this.currentStep}`);
        this.emit({ type: "thinking", step: this.currentStep, content: "Reasoning about next action..." });

        // v5.40: Manage context window — summarize old messages if approaching limit
        try {
          this.messages = await this.contextManager.manageContext(this.messages);
        } catch (err) {
          console.warn(`[ReactEngine] Context management failed: ${err}`);
        }

        let result;
        try {
          result = await chatCompletion(this.messages, {
            tools: tools.length > 0 ? tools : undefined,
            toolChoice: "auto",
            temperature: this.config.temperature,
            maxTokens: this.config.maxTokens,
            signal: this.config.signal,
            sessionId: this.sessionId,  // v5.75: Pass session ID for per-conversation token budget
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.stateMachine.transition("ERROR", `LLM call failed: ${msg}`);
          this.emit({ type: "error", step: this.currentStep, error: `LLM call failed: ${msg}` });
          break;
        }

        // Track token usage
        this.totalTokens.prompt += result.usage.promptTokens;
        this.totalTokens.completion += result.usage.completionTokens;
        this.totalTokens.total += result.usage.totalTokens;

        // ── Case 1: Text response (no tool calls) ────────────────────
        if (result.toolCalls.length === 0) {
          this.stateMachine.transition("RESPONDING", "text response (no tool calls)");
          // v5.55: Detect malformed tool call -- model output raw JSON tool syntax as text
          // instead of using the OpenAI tool_calls API. Inject a correction and retry.
          const rawContent = result.content ?? "";
          const malformedToolPattern = /\{\s*["']?(?:tool|tool_name|function)["']?\s*:\s*["'][\w_]+["']/i;
          const xmlToolPattern55 = /<tool_call>|<tool_name>|<function_calls>|<function_call>/i;
          const hasMalformedToolCall = malformedToolPattern.test(rawContent) || xmlToolPattern55.test(rawContent);

          if (hasMalformedToolCall && this.currentStep < this.config.maxSteps - 1) {
            // Don't emit the malformed text to the user -- inject correction instead
            this.emit({ type: "thinking", step: this.currentStep, content: "Detected malformed tool call format -- correcting and retrying..." });
            this.messages.push({ role: "assistant", content: rawContent });
            // v5.75: Include the canonical tool list in the correction so the model
            // doesn't hallucinate non-existent tool names on retry
            const canonicalToolList = [
              "read_file", "read_file_lines", "write_file", "edit_file", "str_replace",
              "append_file", "list_directory", "tree_view", "search_files", "move_file",
              "delete_file", "project_context", "bash_execute", "python_execute",
              "sandbox_execute", "web_search", "web_browse", "browser_navigate",
              "browser_click", "browser_extract", "browser_scroll", "browser_wait",
              "create_plan", "ask_human", "terminate", "store_memory", "recall_memory",
              "list_memories", "get_own_capabilities", "run_self_diagnosis",
              "get_system_context", "self_read_server_file", "self_patch_file",
              "self_write_file", "self_write_file_chunked", "verify_file_integrity",
              "self_diff", "self_run_tests", "self_restart", "self_atomic_modify",
              "git_operations", "screenshot", "visual_verify", "analyze_image",
            ];
            this.messages.push({
              role: "user",
              content: [
                "Your previous response contained a tool call written as raw text/JSON instead of using the proper tool calling API.",
                "Do NOT write tool calls as JSON text or XML. Instead, use the actual tool calling mechanism.",
                `The EXACT tool names available are: ${canonicalToolList.join(", ")}.`,
                "Common mistakes: use 'get_own_capabilities' NOT 'self_awareness'; use 'list_directory' NOT 'list_codebase_files'; use 'tree_view' NOT 'list_files'.",
                "Please retry your last action using the correct tool call format with one of the above tool names.",
              ].join(" "),
            });
            // Continue the loop -- this step will retry with the correction injected
            continue;
          }

          // v5.82: Fake tool call detector (expanded) — catch ALL formats where the model writes
          // tool calls as text instead of using the actual function calling API:
          //   Format 1 (v5.81): ```bash\nbash_execute ...\n```
          //   Format 2 (v5.82): <act>list_codebase_files</act> (ReAct XML format)
          //   Format 3 (v5.82): <tool_name>list_codebase_files</tool_name>
          //   Format 4 (v5.82): <react><think>...</think><act>tool_name</act></react>
          const TOOL_NAMES_PATTERN = '(?:bash_execute|python_execute|read_file|write_file|self_read_server_file|self_read_file|self_patch_file|self_write_file|self_write_file_chunked|self_run_tests|run_type_check|list_codebase_files|list_directory|tree_view|git_operations|web_search|web_browse|store_memory|recall_memory|get_own_capabilities|run_self_diagnosis|self_restart|get_server_health|list_files|list_codebase_files|search_codebase|analyze_codebase|read_codebase|get_codebase|inspect_code|view_code|show_code)';
          const md82ToolPattern = new RegExp('```(?:bash|typescript|ts|js|javascript|shell|sh|python|py)?\\s*\\n' + TOOL_NAMES_PATTERN + '[\\s\\S]*?```', 'im');
          const xmlAct82Pattern = new RegExp('<act>\\s*(' + TOOL_NAMES_PATTERN + ')\\s*</act>', 'im');
          const xmlTool82Pattern = new RegExp('<(' + TOOL_NAMES_PATTERN + ')>([\\s\\S]*?)</\\1>', 'im');
          const reactXml82Pattern = /<react>[\s\S]*?<act>[\s\S]*?<\/act>[\s\S]*?<\/react>/im;
          // v6.02: Also catch <react><step><action> format (seen in pasted_content_174)
          const reactActionPattern = /<react>[\s\S]*?<action>[\s\S]*?<\/action>[\s\S]*?<\/react>/im;
          const reactStepPattern = /<react>[\s\S]*?<step>[\s\S]*?<\/step>[\s\S]*?<\/react>/im;

          const hasMarkdownFakeToolCall = md82ToolPattern.test(rawContent);
          const hasXmlActFakeToolCall = xmlAct82Pattern.test(rawContent) || xmlTool82Pattern.test(rawContent) || reactXml82Pattern.test(rawContent) || reactActionPattern.test(rawContent) || reactStepPattern.test(rawContent);

          if ((hasMarkdownFakeToolCall || hasXmlActFakeToolCall) && this.currentStep < this.config.maxSteps - 1) {
            this.consecutiveFakeToolCalls++;
            const format = hasXmlActFakeToolCall ? 'XML ReAct format' : 'markdown code block';
            
            // Extract the tool name from whichever format was used
            let fakeCallName = 'the tool';
            const xmlActMatch82 = rawContent.match(new RegExp('<act>\\s*(' + TOOL_NAMES_PATTERN + ')\\s*</act>', 'im'));
            const mdMatch82 = rawContent.match(new RegExp('```(?:bash|typescript|ts|js|javascript|shell|sh|python|py)?\\s*\\n(' + TOOL_NAMES_PATTERN + ')', 'im'));
            if (xmlActMatch82) fakeCallName = xmlActMatch82[1];
            else if (mdMatch82) fakeCallName = mdMatch82[1].split(/[\s(]/)[0];

            if (this.consecutiveFakeToolCalls >= 5) {
              // Strike 5: Force terminate the loop. The model is completely broken.
              this.emit({ type: "thinking", step: this.currentStep, content: `ESCALATING FAKE TOOL CALL GUARD (v6.02): Strike 5. Model is stuck in a loop writing fake tool calls. Terminating task to prevent infinite loop.` });
              this.emit({ type: "error", error: "Agent is stuck in a loop generating fake tool calls instead of using the API. Terminating to save tokens." });
              break;
            } else if (this.consecutiveFakeToolCalls >= 3) {
              // Strike 3-4: Direct injection of file contents. Stop asking the model to call tools.
              this.emit({ type: "thinking", step: this.currentStep, content: `ESCALATING FAKE TOOL CALL GUARD (v6.02): Strike ${this.consecutiveFakeToolCalls}. Model keeps writing fake tool calls. Injecting file contents directly to bypass the need for a tool call.` });
              this.messages.push({ role: "assistant", content: rawContent });
              
              // We'll inject the same files we did in pre-load
              try {
                const fsPreload = await import("fs");
                const pathPreload = await import("path");
                let distDir: string;
                try {
                  const rawPath = new URL(import.meta.url).pathname;
                  distDir = pathPreload.dirname(process.platform === "win32" ? rawPath.replace(/^\//, "") : rawPath);
                } catch {
                  distDir = pathPreload.dirname(process.argv[1] ?? process.cwd());
                }
                const serverDirFromDist = pathPreload.join(distDir, "..", "server");
                const filesToPreload = ["llmProvider.ts", "reactEngine.ts", "truncationDetector.ts"];
                const preloadedFiles: { name: string; content: string }[] = [];
                for (const fname of filesToPreload) {
                  const candidates = [
                    pathPreload.join(serverDirFromDist, fname),
                    pathPreload.join(distDir, fname),
                    pathPreload.join(process.cwd(), "server", fname),
                    pathPreload.join(process.cwd(), "..", "server", fname),
                    pathPreload.join(process.cwd(), "andromeda", "server", fname),
                  ];
                  for (const candidate of candidates) {
                    try {
                      if (fsPreload.existsSync(candidate)) {
                        preloadedFiles.push({ name: fname, content: fsPreload.readFileSync(candidate, "utf-8") });
                        break;
                      }
                    } catch (err) { log.caught("skip", err); }
                  }
                }
                
                if (preloadedFiles.length > 0) {
                  const toolCallId = `forced_injection_${Date.now()}`;
                  this.messages.push({
                    role: "assistant",
                    content: null,
                    tool_calls: preloadedFiles.map((f, i) => ({
                      id: `${toolCallId}_${i}`,
                      type: "function" as const,
                      function: { name: "self_read_server_file", arguments: JSON.stringify({ filename: f.name }) },
                    })),
                  });
                  for (let i = 0; i < preloadedFiles.length; i++) {
                    const f = preloadedFiles[i];
                    this.messages.push({
                      role: "tool",
                      tool_call_id: `${toolCallId}_${i}`,
                      content: `=== server/${f.name} (${f.content.split("\\n").length} lines) ===\n${f.content}`,
                    });
                  }
                  this.messages.push({
                    role: "user",
                    content: [
                      `ESCALATING FAKE TOOL CALL GUARD (v6.02): You are stuck in a loop writing fake tool calls.`,
                      `I HAVE INJECTED THE FILE CONTENTS DIRECTLY ABOVE.`,
                      `DO NOT CALL ANY MORE TOOLS TO READ FILES. THE FILES ARE ALREADY IN YOUR CONTEXT.`,
                      `Analyze the files above directly. Your next action MUST be to write your analysis or call self_patch_file to fix the code.`,
                    ].join(" "),
                  });
                } else {
                  // Fallback if files can't be read
                  this.messages.push({
                    role: "user",
                    content: `ESCALATING FAKE TOOL CALL GUARD (v6.02): You are stuck in a loop writing fake tool calls. STOP writing <react> or <act> tags. Use the real function calling API immediately.`,
                  });
                }
              } catch (err) {
                this.messages.push({
                  role: "user",
                  content: `ESCALATING FAKE TOOL CALL GUARD (v6.02): You are stuck in a loop writing fake tool calls. STOP writing <react> or <act> tags. Use the real function calling API immediately.`,
                });
              }
              continue;
            } else {
              // Strike 1-2: Standard correction
              this.emit({ type: "thinking", step: this.currentStep, content: `FAKE TOOL CALL GUARD (v5.82): Model wrote tool call as ${format} instead of using the API. Forcing real tool invocation.` });
              this.messages.push({ role: "assistant", content: rawContent });
              this.messages.push({
                role: "user",
                content: [
                  `FAKE TOOL CALL GUARD (v5.82): You wrote '${fakeCallName}' as ${format} instead of actually calling it.`,
                  "Writing tool calls as text or XML does NOTHING — the system cannot execute them.",
                  "You MUST use the actual tool calling API (function calling) to invoke tools.",
                  "DO NOT write <act>tool_name</act> or <react><think>...</think><act>tool_name</act></react> — these are not real tool calls.",
                  "DO NOT write ```bash\nbash_execute ...\n``` — this is not a real tool call.",
                  "Your plan was correct. Now EXECUTE it by calling the tools directly via function calling. Start with the first tool call from your plan.",
                ].join(" "),
              });
              continue;
            }
          }

          // v5.84: ZERO-TOOL-RESULTS GUARD (upgraded from v5.78 hallucination detector)
          //
          // The core problem: Andromeda generates self-assessments entirely from training
          // memory without ever reading a single source file. Previous guards caught
          // specific symptoms (src/ paths, fake tool call formats, web_search redirects)
          // but the model kept finding new ways to produce text-only responses that slipped
          // through. This guard is the definitive fix:
          //
          // RULE: If the response is a self-assessment/analysis AND there are ZERO tool
          // results in the entire conversation history, the response is GUARANTEED to be
          // hallucinated. Block it unconditionally and force a real tool call.
          //
          // This covers ALL formats of hallucination:
          // - Responses that describe features that don't exist (ContinuousImprover, SelfHeal, etc.)
          // - Responses that reference src/ paths
          // - Responses that reference Windows paths
          // - Responses that claim to have "confirmed from source" without reading anything
          // - Responses that write fake <tool_call> XML tags
          // - ANY response that produces analysis before calling a single tool
          const rawContent84 = result.content ?? "";
          const hasHallucinatedPath84 = /C:[/\\]Users[/\\]|src\/engine\/|src\/server\/|src\/tools\//.test(rawContent84);
          const toolResultCount = this.messages.filter(m => m.role === "tool").length;
          // v5.88: Broad self-assessment detector — expanded to catch ALL patterns seen in practice.
          // Catches analysis, assessment, investigation, improvement plans, and the specific
          // patterns from the attachment ("I've performed a thorough self-examination",
          // "From my codebase introspection", "Based on my codebase analysis", etc.)
          const isSelfAnalysis84 = /self.assess|self.improv|self.modif|self.diagnos|self.investigat|truncation|codebase is at|source files are at|my source|my own code|my architecture|confirmed from|what i found|what i.ve found|from my source|from the source|let me analyz|let me investigat|let me read|phase 1|phase 2|root cause|critical gap|what.s already working|what i have|what i could not verify|thorough self.examin|codebase introspect|from my codebase|based on my codebase|from the codebase|i.ve analyzed|i.ve performed|i.ve examined|i have analyzed|i have examined|current autonomy|autonomy architecture|active background daemon|background daemon|my active|my codebase analysis|my runtime state|current state.*enhancement|enhancement roadmap|capability gap|concrete action plan|immediate next step|shall i begin|shall i execute|i.m ready to apply|i.m executing|let me start by reading|let me pull|reading.*now.*let me/i.test(rawContent84);
          // v5.88: Phantom file path detector — catches references to src/engine/agent/ paths
          // AND src/utils/ AND src/services/ AND src/routes/ (all phantom paths from the attachment).
          // NOTE: ContinuousImprover, SelfHeal, RecursionGuard, SelfMonitor etc. DO exist as real
          // server/ modules. Only the src/ subdirectory paths are phantom.
          const hasPhantomFeature84 = /src\/engine\/agent\/|src\/utils\/|src\/services\/|src\/routes\/|stream-handler\.ts|continue-handler\.ts|response-assembler\.ts|response-limiter\.ts|stream-manager\.ts/.test(rawContent84);
          // v5.88: Detect fake read_file calls embedded in markdown code blocks targeting phantom paths
          const hasFakeReadInMarkdown = /```(?:bash|shell|sh)?\s*\nread_file\s+server\/src\//im.test(rawContent84) ||
            /```(?:bash|shell|sh)?\s*\nread_file\s+src\//im.test(rawContent84);
          const hasNoToolResultsYet = toolResultCount === 0;

          if (hasPhantomFeature84 || hasHallucinatedPath84 || hasFakeReadInMarkdown || (isSelfAnalysis84 && hasNoToolResultsYet && this.currentStep <= 5)) {
            // NEVER emit hallucinated text to the user
            const guardReason = hasFakeReadInMarkdown
              ? "Response contains fake read_file commands targeting phantom src/ paths (server/src/ does not exist — real files are in server/)"
              : hasPhantomFeature84
              ? "Response references phantom file paths (src/engine/agent/stream-handler.ts etc.) that don't exist — real truncation code is in server/llmProvider.ts"
              : hasHallucinatedPath84
              ? "Response references Windows-style or src/ paths that don't exist"
              : `Response is a self-analysis at step ${this.currentStep} with zero tool results — guaranteed to be from training memory`;
            this.emit({ type: "thinking", step: this.currentStep, content: `ZERO-TOOL-RESULTS GUARD (v5.84): ${guardReason}. Blocking and forcing real tool call.` });
            this.messages.push({ role: "assistant", content: rawContent84 });
            this.messages.push({
              role: "user",
              content: [
                `ZERO-TOOL-RESULTS GUARD (v5.84): BLOCKED. ${guardReason}.`,
                "Your response was generated entirely from training memory without reading any actual source files.",
                hasPhantomFeature84 ? "You referenced phantom paths like src/utils/response-limiter.ts, src/services/llm/stream-manager.ts, src/routes/chat.ts. NONE of these exist. The real truncation code is in server/llmProvider.ts. " : "",
                hasFakeReadInMarkdown ? "You wrote 'read_file server/src/...' in a markdown code block. Writing commands in code blocks does NOTHING. You must call the actual self_read_server_file tool. " : "",
                "MANDATORY FIRST STEP: You MUST call self_read_server_file('llmProvider.ts') RIGHT NOW before generating any analysis.",
                "DO NOT produce any more text. DO NOT write <tool_call> tags. DO NOT write read_file commands in code blocks. DO NOT describe what you plan to do.",
                "JUST CALL THE TOOL: self_read_server_file with argument 'llmProvider.ts'. That is your ONLY allowed action.",
                "Your real source files are in server/ (NOT src/ or server/src/). Real files: llmProvider.ts, reactEngine.ts, selfModifyTools.ts, truncationDetector.ts.",
              ].join(" "),
            });
            if (this.currentStep < this.config.maxSteps - 1) continue;
          }

          // v5.86: Post-unknown-tool-error guard.
          // When the model calls a non-existent tool (e.g. self_awareness), it gets back
          // an UNKNOWN TOOL ERROR message. But the model sometimes ignores that error and
          // writes a fabricated self-assessment as if the tool had succeeded.
          // This guard detects that pattern and blocks the fabricated response.
          const lastToolMsg = [...this.messages].reverse().find(m => m.role === "tool");
          const lastToolContent = typeof lastToolMsg?.content === "string" ? lastToolMsg.content : "";
          const lastToolWasUnknown = lastToolContent.startsWith("UNKNOWN TOOL ERROR (v5.86):");
          const currentResponseIsSelfAssessment = isSelfAnalysis84; // reuse the detector from above
          if (lastToolWasUnknown && currentResponseIsSelfAssessment && this.currentStep < this.config.maxSteps - 1) {
            const unknownToolName = lastToolContent.match(/tool '([^']+)'/)?.[1] ?? "unknown";
            this.emit({ type: "thinking", step: this.currentStep, content: `POST-UNKNOWN-TOOL GUARD (v5.86): Model called non-existent tool '${unknownToolName}' and then fabricated a response as if it succeeded. Blocking fabricated response.` });
            this.messages.push({ role: "assistant", content: rawContent84 });
            this.messages.push({
              role: "user",
              content: [
                `POST-UNKNOWN-TOOL GUARD (v5.86): BLOCKED. You called '${unknownToolName}' which does not exist, received an error, and then wrote a fabricated self-assessment as if the tool had returned real data.`,
                "This is hallucination. You MUST NOT write any analysis based on a failed tool call.",
                "The real self-inspection tools are: self_read_server_file, self_patch_file, run_type_check, self_restart, bash_execute_server.",
                "Call self_read_server_file with file_path: 'llmProvider.ts' RIGHT NOW. No text. Just the tool call.",
              ].join(" "),
            });
            continue;
          }

          // v5.82: Pre-planning path validator — when the model's plan mentions src/ paths
          // or phantom file names, inject a correction BEFORE it tries to execute them.
          // This catches plans like "I'll modify src/tools/file-write-tools.ts" before
          // the model wastes a step trying to read/write a non-existent file.
          const planContent = result.content ?? "";
          const hasSrcPathInPlan = /src\/(?:tools|engine|server|agent|self-improve|llm|monitoring|memory|db)\/[\w.-]+\.ts/i.test(planContent);
          const hasPhantomFileName = /file-write-tools\.ts|tool-executor\.ts|tool-types\.ts|stream-handler\.ts|continue-handler\.ts|response-assembler\.ts/.test(planContent);
          if ((hasSrcPathInPlan || hasPhantomFileName) && this.currentStep < this.config.maxSteps - 1) {
            this.emit({ type: "thinking", step: this.currentStep, content: "PRE-PLAN PATH GUARD (v5.85): Plan references src/ paths or phantom filenames. Injecting path correction before execution." });
            this.messages.push({ role: "assistant", content: planContent });
            this.messages.push({
              role: "user",
              content: [
                "PRE-PLAN PATH GUARD (v5.85): Your plan references src/ paths or phantom filenames that do not exist.",
                "CORRECT PATHS: src/tools/ → server/tools/ | src/engine/agent/ → server/ | src/engine/ → server/ | src/self-improve/ → server/ | src/llm/ → server/",
                "PHANTOM → REAL: stream-handler.ts → llmProvider.ts | continue-handler.ts → llmProvider.ts | response-assembler.ts → llmProvider.ts | tool-executor.ts → reactEngine.ts | file-write-tools.ts → selfModifyTools.ts",
                "The truncation/streaming fix belongs in server/llmProvider.ts (the streamChatCompletion and chatCompletion functions).",
                "SELF-MODIFICATION WORKFLOW: (1) self_read_server_file('llmProvider.ts') (2) self_patch_file for edits (3) run_type_check (4) self_restart",
                "Update your plan with the correct paths and proceed.",
              ].join(" "),
            });
            continue;
          }

          // v5.83: No-tool-calls counter — after 2 consecutive steps with no tool calls
          // AND no termination intent, force a specific tool call instead of terminating.
          // This prevents premature termination when guards inject corrections and the
          // model responds with another text-only message.
          const rawContent83 = result.content ?? "";
          const hasTerminationIntent = /task(?:\s+is)?\s+(?:complete|done|finished)|all\s+(?:steps|tasks)\s+(?:complete|done)|successfully\s+(?:complete|implement|fix)|i\s+have\s+(?:complete|finish|implement)/i.test(rawContent83);

          if (!hasTerminationIntent && this.currentStep < this.config.maxSteps - 1) {
            this.consecutiveNoToolSteps++;
            if (this.consecutiveNoToolSteps >= 2) {
              // Force a specific tool call — reset counter to avoid infinite loop
              this.consecutiveNoToolSteps = 0;
              this.emit({ type: "thinking", step: this.currentStep, content: `NO-TOOL-CALLS GUARD (v5.83): ${this.consecutiveNoToolSteps + 2} consecutive steps with no tool calls and no termination intent. Forcing self_read_server_file call.` });
              this.messages.push({ role: "assistant", content: rawContent83 });
              this.messages.push({
                role: "user",
                content: [
                  "NO-TOOL-CALLS GUARD (v5.83): You have produced 2 consecutive responses with no tool calls and no clear task completion.",
                  "This usually means you are planning or reasoning without executing. You MUST now call a tool.",
                  "If you are working on a self-modification task, call self_read_server_file('llmProvider.ts') RIGHT NOW.",
                  "If you are working on a file task, call read_file or list_directory RIGHT NOW.",
                  "If the task is truly complete, call terminate with a summary.",
                  "DO NOT produce another text-only response. Call a tool immediately.",
                ].join(" "),
              });
              continue;
            }
          } else {
            // Has termination intent or at max steps — let it fall through to done
            this.consecutiveNoToolSteps = 0;
          }

          if (result.content) {
            this.emit({ type: "text", step: this.currentStep, content: result.content });
            this.messages.push({ role: "assistant", content: result.content });
          }
          // If the model stopped without calling terminate, we're done
          this.emit({
            type: "done",
            step: this.currentStep,
            summary: result.content ?? "Agent completed without explicit termination.",
            totalSteps: this.currentStep,
            tokenUsage: this.totalTokens,
            filesModified: Array.from(this.filesModified),
            workingDir: this.detectWorkingDir(),
            stepDurationMs: Date.now() - stepStart,
          });
          break;
        }

        // ── Case 2: Tool calls ───────────────────────────────────────
        this.stateMachine.transition("TOOL_CALL", `${result.toolCalls.length} tool(s) requested`);
        // v5.83: Reset no-tool-calls counter whenever the model actually calls a tool
        this.consecutiveNoToolSteps = 0;

        // Add the assistant message with tool_calls
        this.messages.push({
          role: "assistant",
          content: result.content,
          tool_calls: result.toolCalls,
        });

        // If there's also text content, emit it
        if (result.content) {
          this.emit({ type: "text", step: this.currentStep, content: result.content });
        }

        // v5.41: Categorize tool calls for parallel vs sequential execution
        const specialTools = new Set(["ask_human", "terminate", "create_plan"]);
        const sequentialCalls: ToolCall[] = [];
        const parallelCalls: ToolCall[] = [];

        for (const tc of result.toolCalls) {
          if (specialTools.has(tc.function.name)) {
            sequentialCalls.push(tc);
          } else {
            parallelCalls.push(tc);
          }
        }

        // Execute special tools first (they may terminate the loop)
        let shouldBreak = false;
        for (const tc of sequentialCalls) {
          const args = this.parseToolArgs(tc);

          // ── Special: ask_human ────────────────────────────────────
          if (tc.function.name === "ask_human") {
            const question = String(args.question ?? "I need your input.");
            this.emit({ type: "ask_human", step: this.currentStep, content: question });
            this.emit({ type: "tool_call", step: this.currentStep, toolName: tc.function.name, toolArgs: args });

            const answer = await this.waitForHumanResponse(question);
            this.emit({ type: "human_response", step: this.currentStep, content: answer });

            this.messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: `Human responded: ${answer}`,
            });
            continue;
          }

          // ── Special: terminate ────────────────────────────────────
          if (tc.function.name === "terminate") {
            const summary = String(args.summary ?? "Task completed.");
            this.messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: summary,
            });
            this.emit({
              type: "done",
              step: this.currentStep,
              summary,
              totalSteps: this.currentStep,
              tokenUsage: this.totalTokens,
              filesModified: Array.from(this.filesModified),
              workingDir: this.detectWorkingDir(),
              stepDurationMs: Date.now() - stepStart,
            });
            this.isRunning = false;
            return;
          }

          // ── Special: create_plan ──────────────────────────────────
          if (tc.function.name === "create_plan") {
            const plan = (args.steps as Array<{ id: number; title: string; description?: string }>) ?? [];
            const goal = String(args.goal ?? "");
            this.emit({ type: "plan", step: this.currentStep, plan, content: goal });
            this.emit({ type: "tool_call", step: this.currentStep, toolName: tc.function.name, toolArgs: args });

            const formatted = plan.map(s => `  ${s.id}. ${s.title}${s.description ? ` — ${s.description}` : ""}`).join("\n");
            const planResult = `Plan created successfully.\nGoal: ${goal}\nSteps:\n${formatted}`;
            this.messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: planResult,
            });

            this.emit({ type: "tool_result", step: this.currentStep, toolName: tc.function.name, toolResult: { success: true, output: planResult, error: "" } });
          }
        }

        if (shouldBreak) break;

        // v5.83: web_search redirect guard — when the model calls web_search for a
        // self-code-analysis task (e.g. "truncation fix", "my source code", "codebase"),
        // it gets back irrelevant web results (SQL, Apple autocorrect, etc.) instead of
        // reading its own source. Intercept these calls and redirect to self_read_server_file.
        const WEB_SEARCH_SELF_CODE_PATTERN = /truncat|self[._-]?modif|my[\s._-]?(?:source|code)|codebase|llm.?provider|react.?engine|server.?file|andromeda.?source|fix.*bug|patch.*code/i;
        for (let wsIdx = 0; wsIdx < parallelCalls.length; wsIdx++) {
          const wsTc = parallelCalls[wsIdx];
          if (wsTc.function.name === "web_search") {
            let wsArgs: Record<string, unknown> = {};
            try { wsArgs = JSON.parse(wsTc.function.arguments); } catch (err) { log.caught("ignore", err); }
            const wsQuery = String(wsArgs.query ?? wsArgs.q ?? "");
            if (WEB_SEARCH_SELF_CODE_PATTERN.test(wsQuery)) {
              this.emit({ type: "thinking", step: this.currentStep, content: `WEB_SEARCH REDIRECT (v5.83): Query '${wsQuery}' is about Andromeda's own code. Redirecting to self_read_server_file('llmProvider.ts').` });
              // Inject a synthetic tool result for the web_search call explaining the redirect
              this.messages.push({
                role: "tool",
                tool_call_id: wsTc.id,
                content: [
                  `WEB_SEARCH REDIRECT (v5.83): Your query '${wsQuery}' is about Andromeda's own source code.`,
                  "Web search cannot return your own source files. The correct tool is self_read_server_file.",
                  "Your source files are in server/ (NOT src/). Key files: llmProvider.ts, reactEngine.ts, selfModifyTools.ts.",
                  "NEXT STEP: Call self_read_server_file('llmProvider.ts') to read the actual truncation handling code.",
                ].join(" "),
              });
              // Remove this web_search from parallelCalls so it doesn't get executed
              parallelCalls.splice(wsIdx, 1);
              wsIdx--;
            }
          }
        }

        // v6.02: Reset fake tool call counter when a real tool call is made
        if (parallelCalls.length > 0) {
          this.consecutiveFakeToolCalls = 0;
        }

        // v5.41: Execute parallel tool calls concurrently with Promise.allSettled
        if (parallelCalls.length > 0) {
          // Emit all tool_call events first
          const parsedArgs: Record<string, unknown>[] = [];
          for (const tc of parallelCalls) {
            const args = this.parseToolArgs(tc);
            parsedArgs.push(args);
            this.emit({
              type: "tool_call",
              step: this.currentStep,
              toolName: tc.function.name,
              toolArgs: args,
            });
          }

          // Execute all in parallel
          const executionPromises = parallelCalls.map(async (tc, idx) => {
            const args = parsedArgs[idx] as Record<string, unknown>;

            // v5.41: Check cache first
            const cached = this.getCachedResult(tc.function.name, args);
            if (cached) {
              return { tc, args, result: cached, cached: true };
            }

            // Execute the tool
            const toolResult = await executeTool(tc.function.name, args, ctx);

            // v5.41: Cache the result for read-only tools
            this.setCachedResult(tc.function.name, args, toolResult);

            // Invalidate cache if this was a write operation
            this.invalidateCache(tc.function.name, args);

            return { tc, args, result: toolResult, cached: false };
          });

          const results = await Promise.allSettled(executionPromises);
          let cachedCount = 0;

          // Process results in order (maintain message ordering)
          for (const settled of results) {
            if (settled.status === "fulfilled") {
              const { tc, args, result: toolResult, cached } = settled.value;
              if (cached) cachedCount++;

              // v5.38: Track files modified by write/edit/append/move/str_replace tools
              const fileWriteTools = ["write_file", "edit_file", "append_file", "str_replace", "move_file"];
              if (fileWriteTools.includes(tc.function.name) && toolResult.success) {
                const filePath = String(args.path || args.destination || "");
                if (filePath) this.filesModified.add(filePath);
              }

              this.emit({
                type: "tool_result",
                step: this.currentStep,
                toolName: tc.function.name,
                toolResult,
              });

              // Add tool result to conversation
              // v5.79: ContextWindowOptimizer — cap large tool outputs before they consume the context window.
              // A single large file read (e.g. 50KB source file) would leave no room for the LLM response,
              // causing output truncation. Cap at 8000 chars with a clear summary of what was cut.
              const MAX_TOOL_OUTPUT_CHARS = 8000;
              // v5.86: Unknown-tool error amplifier.
              // When the model calls a non-existent tool (e.g. self_awareness, bash_execute),
              // the generic "Unknown tool: X" error is easy to ignore. Expand it into an
              // explicit directive that lists the real tools and forbids fabricated responses.
              const isUnknownToolError = !toolResult.success && (toolResult.error ?? "").startsWith("Unknown tool:");
              const rawToolContent = toolResult.success
                ? toolResult.output
                : isUnknownToolError
                  ? [
                      `UNKNOWN TOOL ERROR (v5.86): The tool '${tc.function.name}' does not exist in this codebase.`,
                      `DO NOT write any response based on this failed call. DO NOT fabricate what the tool would have returned.`,
                      `The real self-inspection tools are: self_read_server_file, self_patch_file, run_type_check, self_restart, bash_execute_server.`,
                      `To read your own source code, call: self_read_server_file with file_path: "llmProvider.ts"`,
                      `To list your real source files, call: bash_execute_server with command: "find server/ -name '*.ts' | sort"`,
                      `MANDATORY: Call one of the real tools above RIGHT NOW. Do not produce any text response until you have real tool results.`,
                    ].join(" ")
                  : `ERROR: ${toolResult.error}\n${toolResult.output}`;
              const toolContent = rawToolContent.length > MAX_TOOL_OUTPUT_CHARS
                ? rawToolContent.slice(0, MAX_TOOL_OUTPUT_CHARS) +
                  `\n\n[CONTEXT OPTIMIZER (v5.79): Output truncated at ${MAX_TOOL_OUTPUT_CHARS} chars. ` +
                  `Full output was ${rawToolContent.length} chars (${Math.round(rawToolContent.length / 3.5)} tokens). ` +
                  `If you need the rest, call the tool again with a more specific query, ` +
                  `or use self_read_server_file with a specific line range.]`
                : rawToolContent;
              this.messages.push({
                role: "tool",
                tool_call_id: tc.id,
                content: toolContent,
              });
            } else {
              // Tool execution threw an error
              const tc = parallelCalls[results.indexOf(settled)];
              const errorMsg = settled.reason instanceof Error ? settled.reason.message : String(settled.reason);
              this.messages.push({
                role: "tool",
                tool_call_id: tc.id,
                content: `ERROR: Tool execution failed: ${errorMsg}`,
              });
              this.emit({
                type: "tool_result",
                step: this.currentStep,
                toolName: tc.function.name,
                toolResult: { success: false, output: "", error: errorMsg },
              });
            }
          }

          // v5.78: Consecutive-failure loop guard (upgraded from v5.75)
          // Tracks failures by (toolName + pathArg) key so a successful read_file on a different
          // path doesn't reset the guard for a failing path. Threshold: 3 (was 5).
          const allFailed = results.every(r => r.status === "fulfilled" && !r.value.result.success);
          const firstTool = parallelCalls[0]?.function.name ?? "";
          const allSameTool = parallelCalls.every(tc => tc.function.name === firstTool);
          const firstError = results[0]?.status === "fulfilled" ? (results[0].value.result.error ?? "") : "";
          const isNotFoundError = firstError.includes("not found") || firstError.includes("ENOENT") || firstError.includes("no such file");

          // Extract path argument from the first call for per-path tracking
          const firstArgs = parallelCalls[0]?.function.arguments ?? "{}";
          let firstPathArg = "";
          try {
            const parsed = JSON.parse(firstArgs);
            firstPathArg = String(parsed.path ?? parsed.file_path ?? parsed.filePath ?? "");
          } catch (err) { log.caught("ignore", err); }
          const streakKey = `${firstTool}::${firstPathArg}`;

          if (allFailed && allSameTool && isNotFoundError) {
            // Per-path permanent block: if a path has failed 3+ times, block it immediately
            if (firstPathArg) {
              const pathCount = (this.pathFailureMap.get(firstPathArg) ?? 0) + parallelCalls.length;
              this.pathFailureMap.set(firstPathArg, pathCount);
              if (pathCount >= 3) {
                this.emit({ type: "thinking", step: this.currentStep, content: `Path guard: '${firstPathArg}' has failed ${pathCount} times. Injecting hard correction.` });
                this.messages.push({
                  role: "user",
                  content: [
                    `PATH GUARD (v5.78): The path '${firstPathArg}' has failed ${pathCount} times with 'not found'.`,
                    `This path DOES NOT EXIST. Do NOT try it again.`,
                    `Your source files are in server/, not src/. Use self_read_server_file with just the filename (e.g. 'llmProvider.ts') or call bash_execute with 'find server/ -name "*.ts" | sort' to see all real files.`,
                    `ANDROMEDA.md in your workspace has the complete path translation table and correct tool names.`,
                  ].join(" "),
                });
              }
            }
            // Streak guard: same key 3+ times in a row
            if (this.notFoundStreak.key === streakKey) {
              this.notFoundStreak.count += parallelCalls.length;
            } else {
              this.notFoundStreak = { key: streakKey, count: parallelCalls.length, lastHint: firstError };
            }
            if (this.notFoundStreak.count >= 3) {
              const streakCount = this.notFoundStreak.count;
              const hint = this.notFoundStreak.lastHint;
              this.notFoundStreak = { key: "", count: 0, lastHint: "" };
              this.emit({ type: "thinking", step: this.currentStep, content: `Loop guard triggered: ${streakCount} consecutive '${firstTool}' failures on '${firstPathArg}'. Injecting correction.` });
              this.messages.push({
                role: "user",
                content: [
                  `LOOP GUARD (v5.78): You have called '${firstTool}' with path '${firstPathArg}' ${streakCount}+ times and it always fails.`,
                  `STOP. This file does not exist at that path.`,
                  hint.includes("server/") ? hint : `Your source files are in server/, not src/. Use self_read_server_file('llmProvider.ts') or bash_execute('find server/ -name "*.ts" | sort') to find real paths.`,
                  `Read ANDROMEDA.md in your workspace for the complete path translation table.`,
                ].join(" "),
              });
            }
          } else if (!allFailed) {
            // Reset streak on any success (but keep per-path failure map)
            this.notFoundStreak = { key: "", count: 0, lastHint: "" };
            this.consecutiveToolFailures = 0;  // v6.22: Reset re-plan trigger on success
            // v6.23: Advance the active plan step on success
            if (this.activePlan) {
              try {
                const { getNextExecutableStep, completeStep, getPlanSummary } = await import("./taskPlanner.js");
                const currentStep = getNextExecutableStep(this.activePlan);
                if (currentStep && currentStep.status === "running") {
                  const successResult = results.filter(r => r.status === "fulfilled").map(r => (r as PromiseFulfilledResult<{ tc: ToolCall; args: Record<string, unknown>; result: ToolResult; cached: boolean }>).value.result.output).join("; ").slice(0, 200);
                  completeStep(this.activePlan, currentStep.id, successResult);
                  this.emit({ type: "thinking", step: this.currentStep, content: `[Plan v6.23] Step "${currentStep.description}" completed. ${getPlanSummary(this.activePlan)}` });
                }
              } catch (planErr) { log.caught("non-fatal plan step advance", planErr); }
            }
          }
          // v6.22: LLM-based re-planning — if N consecutive steps all fail, ask the LLM for a new approach
          if (allFailed) {
            this.consecutiveToolFailures++;
            if (
              this.consecutiveToolFailures >= ReactEngine.REPLAN_THRESHOLD &&
              this.replanCount < ReactEngine.MAX_REPLANS
            ) {
              this.consecutiveToolFailures = 0;
              this.replanCount++;
              this.stateMachine.transition("GUARD_BLOCKED", `re-planning (attempt ${this.replanCount}/${ReactEngine.MAX_REPLANS})`);
              this.emit({ type: "thinking", step: this.currentStep, content: `[v6.22] Re-planning triggered (attempt ${this.replanCount}/${ReactEngine.MAX_REPLANS}): consecutive tool failures. Asking LLM for a new approach.` });
              try {
                const { backgroundSimpleCompletion } = await import("./llmProvider.js");
                const recentFailures = results
                  .filter(r => r.status === "fulfilled" && !(r as PromiseFulfilledResult<{ tc: ToolCall; args: Record<string, unknown>; result: ToolResult; cached: boolean }>).value.result.success)
                  .map(r => r.status === "fulfilled" ? ((r as PromiseFulfilledResult<{ tc: ToolCall; args: Record<string, unknown>; result: ToolResult; cached: boolean }>).value.result.error ?? "unknown error") : "")
                  .join("; ");
                const userMsg = this.messages.find(m => m.role === "user");
                const originalTask = typeof userMsg?.content === "string" ? userMsg.content : "unknown task";
                const replanPrompt = `You are an AI agent that has been trying to complete a task but keeps failing.\n\nOriginal task: ${originalTask}\n\nRecent failures: ${recentFailures}\n\nThe current approach is not working. Generate a COMPLETELY DIFFERENT approach.\nBe specific about which tools to use and in what order. Avoid the same tools/paths that have been failing.\nReply with a concise action plan (3-5 steps).`;
                const newApproach = await backgroundSimpleCompletion(
                  "You are a task re-planning expert. When an agent is stuck, you generate a new approach.",
                  replanPrompt
                );
                this.messages.push({
                  role: "user",
                  content: `[RE-PLAN v6.22]: Your current approach has failed ${ReactEngine.REPLAN_THRESHOLD} times in a row. Here is a new approach to try:\n\n${newApproach}\n\nPlease follow this new plan exactly. Use the real tool calling API — do NOT write tool calls as text.`,
                });
                this.stateMachine.transition("THINKING", "re-plan injected, resuming");
              } catch (replanErr) {
                this.emit({ type: "thinking", step: this.currentStep, content: `[v6.22] Re-plan generation failed: ${replanErr}. Continuing with original approach.` });
              }
            }
          }

          // v5.41: Emit performance metrics
          if (parallelCalls.length > 1 || cachedCount > 0) {
            this.emit({
              type: "step_end",
              step: this.currentStep,
              parallelCount: parallelCalls.length,
              cachedCount,
              stepDurationMs: Date.now() - stepStart,
            });
          } else {
            this.emit({ type: "step_end", step: this.currentStep, stepDurationMs: Date.now() - stepStart });
          }
        } else {
          this.emit({ type: "step_end", step: this.currentStep, stepDurationMs: Date.now() - stepStart });
        }
      }

      // Max steps reached
      if (this.currentStep >= this.config.maxSteps) {
        this.stateMachine.transition("DONE", "max steps reached");
        this.emit({
          type: "done",
          step: this.currentStep,
          summary: `Agent reached maximum steps (${this.config.maxSteps}). The task may be incomplete.`,
          totalSteps: this.currentStep,
          tokenUsage: this.totalTokens,
          filesModified: Array.from(this.filesModified),
          workingDir: this.detectWorkingDir(),
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.stateMachine.transition("ERROR", msg);
      this.emit({ type: "error", error: `Agent error: ${msg}` });
    } finally {
      this.isRunning = false;
      if (this.agentState === "running") this.agentState = "completed";  // v5.39
      if (this.stateMachine.isAny("THINKING", "TOOL_CALL", "TOOL_RESULT", "RESPONDING")) {
        this.stateMachine.transition("DONE", "run() finally block");
      }
    }
  }

  // v5.41: Parse tool arguments with robust error handling
  private parseToolArgs(tc: ToolCall): Record<string, unknown> {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(tc.function.arguments);
    } catch {
      const raw = tc.function.arguments;
      try {
        const cleaned = raw.replace(/^["']|["']$/g, "").replace(/\\n/g, "\n").replace(/\\"/g, '"');
        args = JSON.parse(cleaned);
      } catch {
        args = { _raw: raw };
      }
    }
    // If args still has _raw, try to parse it as the actual arguments
    if (args._raw && typeof args._raw === "string") {
      try {
        const parsed = JSON.parse(args._raw as string);
        if (typeof parsed === "object" && parsed !== null) {
          args = parsed;
        }
      } catch (err) { log.caught("keep _raw as-is", err); }
    }
    return args;
  }

  // ─── Human-in-the-Loop ─────────────────────────────────────────────────

  private waitForHumanResponse(question: string): Promise<string> {
    return new Promise<string>((resolve) => {
      this.pendingHuman = { question, resolve };
    });
  }

  provideHumanResponse(answer: string): boolean {
    if (this.pendingHuman) {
      this.pendingHuman.resolve(answer);
      this.pendingHuman = null;
      return true;
    }
    return false;
  }

  hasPendingQuestion(): boolean {
    return this.pendingHuman !== null;
  }

  getPendingQuestion(): string | null {
    return this.pendingHuman?.question ?? null;
  }

  // ─── v5.39: Interrupt / Steer / Pause / Resume ────────────────────────

  /**
   * Interrupt the agent — stops after the current step completes.
   * The agent emits an 'interrupted' event and terminates gracefully.
   */
  interrupt(reason?: string): boolean {
    if (!this.isRunning) return false;
    this.agentState = "interrupted";
    this.emit({
      type: "interrupted",
      step: this.currentStep,
      content: reason || "Agent interrupted by user.",
      filesModified: Array.from(this.filesModified),
      workingDir: this.detectWorkingDir(),
    });
    return true;
  }

  /**
   * Redirect the agent — injects new instructions into the conversation.
   * The agent will process the new instructions on its next loop iteration.
   */
  steer(newInstructions: string): boolean {
    if (!this.isRunning) return false;
    // Inject a user message with the redirect
    this.messages.push({
      role: "user",
      content: `[REDIRECT FROM USER]: The user has updated their instructions mid-task. Please adjust your approach accordingly:\n\n${newInstructions}\n\nContinue from where you left off, incorporating these new instructions.`,


    });
    this.emit({
      type: "redirected",
      step: this.currentStep,
      content: newInstructions,
    });
    // If paused, resume automatically
    if (this.isPaused && this.pauseResolve) {
      this.isPaused = false;
      this.pauseResolve();
      this.pauseResolve = null;
    }
    return true;
  }

  /**
   * Pause the agent — it will wait after the current step completes.
   */
  pause(): boolean {
    if (!this.isRunning || this.isPaused) return false;
    this.isPaused = true;
    this.agentState = "paused";
    this.emit({ type: "paused", step: this.currentStep, content: "Agent paused by user." });
    return true;
  }

  /**
   * Resume a paused agent.
   */
  resume(): boolean {
    if (!this.isPaused || !this.pauseResolve) return false;
    this.isPaused = false;
    this.agentState = "running";
    this.emit({ type: "resumed", step: this.currentStep, content: "Agent resumed by user." });
    this.pauseResolve();
    this.pauseResolve = null;
    return true;
  }

  /**
   * Wait if the agent is paused. Called at the top of each loop iteration.
   */
  private async waitIfPaused(): Promise<void> {
    if (!this.isPaused) return;
    return new Promise<void>((resolve) => {
      this.pauseResolve = resolve;
    });
  }

  getState(): AgentState {
    return this.agentState;
  }

  isInterrupted(): boolean {
    return this.agentState === "interrupted";
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  private emit(event: AgentEvent): void {
    try {
      this.config.onEvent(event);
    } catch {
      // Don't let event handler errors crash the engine
    }
  }

  getMessages(): ChatMessage[] {
    return [...this.messages];
  }

  getTokenUsage(): { prompt: number; completion: number; total: number } {
    return { ...this.totalTokens };
  }
}

// ─── SSE Stream Helper ──────────────────────────────────────────────────────

export function streamAgentToSSE(
  res: Response,
  userMessage: string,
  workspaceDir: string,
  options?: {
    maxSteps?: number;
    temperature?: number;
    systemPrompt?: string;
    signal?: AbortSignal;
    sessionId?: string;  // v5.75: Per-conversation session ID
  },
): ReactEngine {
  const engine = new ReactEngine({
    maxSteps: options?.maxSteps ?? 200,
    maxTokens: 0, // Will be set by constructor dynamically
    temperature: options?.temperature ?? 0.7,
    systemPrompt: options?.systemPrompt,
    workspaceDir,
    signal: options?.signal,
    sessionId: options?.sessionId,  // v5.75: Pass through for token budget isolation
    onEvent: (event) => {
      try {
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        }
      } catch {
        // Connection closed
      }
    },
  });

  // Run the agent (don't await — it streams)
  engine.run(userMessage).finally(() => {
    try {
      if (!res.writableEnded) {
        res.write(`data: [DONE]\n\n`);
        res.end();
      }
    } catch {
      // Already closed
    }
  });

  return engine;
}
