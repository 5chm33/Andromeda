/**
 * aiPlanning.ts — v6.25
 * Non-streaming helpers, agent planning engine, Claude Code capabilities, and todo system.
 * Extracted from ai.ts (god-module split).
 */
import { streamToResponse } from "./aiStreaming.js";
import * as path from "path";
import * as fs from "fs";
import type { Response } from "express";
import JSZip from "jszip";
import { getActiveProvider } from "./llmProvider.js";
import { createLogger } from "./logger.js";
import { getActiveModel, getApiKey, getApiUrl, getProviderHeaders } from "./aiTokens.js";
import { buildSystemPrompt } from "./aiPrompts.js";
import { getContextWindow } from "./modelRegistry.js";
const log = createLogger("aiPlanning");

// ─── Non-streaming helpers ────────────────────────────────────────────────────

export async function generateSubQueries(mainQuery: string): Promise<string[]> {
  const apiKey = getApiKey();
  if (!apiKey) return [];

  try {
    const SUB_QUERY_COUNT = 4;
    const MAX_TOKENS_SUB_QUERY = 200;
    const TEMPERATURE_SUB_QUERY = 0.7;

    const response = await fetch(getApiUrl(), {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...getProviderHeaders() },
      body: JSON.stringify({
        model: getActiveModel(),
        messages: [
          {
            role: "system",
            content:
              `You generate search sub-queries for deep research. Return exactly ${SUB_QUERY_COUNT} specific, diverse sub-queries as JSON: {"queries": ["...", "...", "...", "..."]}. No explanation.`,
          },
          {
            role: "user",
            content: `Generate ${SUB_QUERY_COUNT} parallel search sub-queries to deeply research: "${mainQuery}"`,
          },
        ],
        max_tokens: MAX_TOKENS_SUB_QUERY,
        temperature: TEMPERATURE_SUB_QUERY,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) return [mainQuery];
    const data = (await response.json()) as any;
    const content = data.choices?.[0]?.message?.content;
    if (!content) return [mainQuery];
    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      log.warn("Failed to parse sub-queries JSON, falling back to main query");
      return [mainQuery];
    }
    const arr = parsed.queries || parsed.sub_queries || parsed.results || Object.values(parsed)[0];
    return Array.isArray(arr) ? [mainQuery, ...arr.slice(0, 3)] : [mainQuery];
  } catch (err) {
    log.warn("generateSubQueries fetch failed", err);
    return [mainQuery];
  }
}

export async function generateSuggestions(query: string): Promise<string[]> {
  const apiKey = getApiKey();
  if (!apiKey) return [];

  try {
    const response = await fetch(getApiUrl(), {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...getProviderHeaders() },
      body: JSON.stringify({
        model: getActiveModel(),
        messages: [
          {
            role: "system",
            content:
              'You generate search query suggestions. Return exactly 4 related queries as JSON: {"suggestions": ["...", "...", "...", "..."]}. No explanation.',
          },
          { role: "user", content: `Generate 4 related search queries for: "${query}"` },
        ],
        max_tokens: 150,
        temperature: 0.7,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) return [];
    const data = (await response.json()) as any;
    const content = data.choices?.[0]?.message?.content;
    if (!content) return [];
    const parsed = JSON.parse(content);
    const arr = parsed.suggestions || parsed.queries || Object.values(parsed)[0];
    return Array.isArray(arr) ? arr.slice(0, 4) : [];
  } catch {
    return [];
  }
}

// ─── File editing capability ──────────────────────────────────────────────────

interface EditInstruction {
  file: string;
  find: string;
  replace: string;
  reason: string;
}

interface EditPlan {
  summary: string;
  edits: EditInstruction[];
  newFiles?: { file: string; content: string; reason: string }[];
}

export async function editFilesInZip(
  base64Zip: string,
  fileName: string,
  instructions: string,
  model: string = "deepseek/deepseek-chat"
): Promise<{ editedZip: string; summary: string; editsApplied: number; log: string[] }> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY or LLM_API_KEY not configured");

  // Decode the base64 ZIP bytes and parse with JSZip
  const zipBuffer = Buffer.from(base64Zip, "base64");
  const zip = await JSZip.loadAsync(zipBuffer);

  // ZIP bomb protection
  const MAX_FILE_COUNT = 1000;
  const MAX_TOTAL_UNCOMPRESSED = 50 * 1024 * 1024; // 50 MB
  let fileCount = 0;
  let totalUncompressed = 0;
  for (const [path, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    // Block path traversal attacks
    if (path.includes("..") || path.startsWith("/")) {
      throw new Error(`Unsafe file path in ZIP: ${path}`);
    }
    fileCount++;
    if (fileCount > MAX_FILE_COUNT) {
      throw new Error(`ZIP contains too many files (>${MAX_FILE_COUNT})`);
    }
    // @ts-ignore — JSZip internal property
    const uncompressedSize = (file as any)._data?.uncompressedSize ?? 0;
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED) {
      throw new Error(`ZIP uncompressed size exceeds 50 MB limit`);
    }
  }

  // Extract all text files into a map
  const TEXT_EXTS = /\.(ts|tsx|js|jsx|json|md|txt|css|html|env|ps1|bat|vbs|sh|py|yaml|yml|toml|sql)$/i;
  const fileMap: Record<string, string> = {};
  const binaryFiles: Record<string, Uint8Array> = {};
  await Promise.all(
    Object.entries(zip.files).map(async ([path, file]) => {
      if (file.dir) return;
      if (TEXT_EXTS.test(path)) {
        try {
          fileMap[path] = await file.async("string");
        } catch (readErr) {
          console.debug(`[ai.ts] Skipping unreadable text file: ${path}`, (readErr as Error).message);
        }
      } else {
        try {
          binaryFiles[path] = await file.async("uint8array");
        } catch (readErr) {
          console.debug(`[ai.ts] Skipping unreadable binary file: ${path}`, (readErr as Error).message);
        }
      }
    })
  );

  // Build a compact text summary for the AI (same format as file analysis)
  const PRIORITY = ["package.json", "server/ai.ts", "server/routers.ts", "server/streamRouter.ts", "client/src/pages/Search.tsx", "client/src/pages/Home.tsx", "drizzle/schema.ts"];
  const sortedPaths = Object.keys(fileMap).sort((a, b) => {
    const ai = PRIORITY.findIndex((p) => a.includes(p));
    const bi = PRIORITY.findIndex((p) => b.includes(p));
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });

  // v5.31: Dynamic model-aware budget replaces hardcoded 80000/20000
  const contextWindow = getContextWindow(model);
const CHARS_PER_TOKEN = 3.5;
const CONTEXT_USAGE_RATIO = 0.6; // 60% of context for file content
const MAX_CHARS = Math.floor(contextWindow * CHARS_PER_TOKEN * CONTEXT_USAGE_RATIO);
const PER_FILE_LIMIT = 60000; // cap per file to avoid excessive token usage
const perFileLimit = Math.min(Math.floor(MAX_CHARS / Math.max(sortedPaths.length, 1)), PER_FILE_LIMIT);
  const parts: string[] = [];
  let totalChars = 0;
  for (const path of sortedPaths) {
    const content = fileMap[path];
    const chunk = `===\nFILE: ${path}\n===\n${content.slice(0, perFileLimit)}`;
    if (totalChars + chunk.length > MAX_CHARS) break;
    parts.push(chunk);
    totalChars += chunk.length;
  }
  const fileContext = parts.join("\n\n");

  // Step 1: Ask DeepSeek to produce a structured edit plan
  const planResponse = await fetch(getApiUrl(), {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...getProviderHeaders() },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: `You are an expert code editor. The user has uploaded a ZIP archive. Your job is to produce a precise JSON edit plan.

Return ONLY valid JSON in this exact format:
{
  "summary": "Brief description of all changes",
  "edits": [
    {
      "file": "path/to/file.ts",
      "find": "exact string to find (must exist verbatim in the file)",
      "replace": "replacement string",
      "reason": "why this change"
    }
  ],
  "newFiles": [
    {
      "file": "path/to/new-file.ts",
      "content": "full file content",
      "reason": "why this file is needed"
    }
  ]
}

Rules:
- "find" must be an EXACT verbatim substring from the file content shown below
- Do not invent code that isn't there — only edit what you can see
- Keep edits minimal and surgical — do not rewrite entire files unless asked
- newFiles is optional, only include if genuinely needed
- Only include edits for files you can actually see in the archive below`,
        },
        {
          role: "user",
          content: `Here is the ZIP archive content:\n\n${fileContext}\n\n---\n\nInstructions: ${instructions}`,
        },
      ],
      max_tokens: 8000,
      temperature: 0.2,
      response_format: { type: "json_object" },
    }),
  });

  if (!planResponse.ok) {
    const err = await planResponse.text();
    throw new Error(`DeepSeek API error ${planResponse.status}: ${err}`);
  }

  const planData = (await planResponse.json()) as any;
  const planContent = planData.choices?.[0]?.message?.content;
  if (!planContent) throw new Error("No edit plan returned from AI");

  let plan: EditPlan;
  try {
    plan = JSON.parse(planContent);
  } catch (jsonErr) {
    console.warn("[ai.ts] JSON parse failed for edit plan:", (jsonErr as Error).message);
    throw new Error("AI returned invalid JSON edit plan");
  }

  const log: string[] = [];
  let editsApplied = 0;

  // Step 2: Apply text edits to the file map
  for (const edit of plan.edits || []) {
    const content = fileMap[edit.file];
    if (content === undefined) {
      log.push(`SKIP: ${edit.file} — file not found in archive`);
      continue;
    }
    if (!content.includes(edit.find)) {
      log.push(`SKIP: ${edit.file} — find string not found verbatim`);
      continue;
    }
    fileMap[edit.file] = content.replace(edit.find, edit.replace);
    log.push(`EDIT: ${edit.file} — ${edit.reason}`);
    editsApplied++;
  }

  // Add new files
  for (const newFile of plan.newFiles || []) {
    fileMap[newFile.file] = newFile.content;
    log.push(`NEW: ${newFile.file} — ${newFile.reason}`);
    editsApplied++;
  }

  // Step 3: Rebuild a real ZIP with JSZip
  const outputZip = new JSZip();
  // Add all text files (edited or original)
  for (const [path, content] of Object.entries(fileMap)) {
    outputZip.file(path, content);
  }
  // Add all binary files unchanged
  for (const [path, data] of Object.entries(binaryFiles)) {
    outputZip.file(path, data);
  }

  const zipBytes = await outputZip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  const editedZipBase64 = zipBytes.toString("base64");

  return {
    editedZip: editedZipBase64,
    summary: plan.summary || "Changes applied",
    editsApplied,
    log,
  };
}

// ─── Agent Planning Engine ────────────────────────────────────────────────────
//
// streamAgentPlan implements a two-phase "plan-then-execute" agent loop:
//
//   Phase 1 — Planning: Ask DeepSeek to decompose the user query into a JSON
//             array of steps, each with a type (search | browse | code | answer)
//             and the data needed to execute it.
//
//   Phase 2 — Execution: Execute each step sequentially, feeding results of
//             earlier steps into later ones. Stream SSE events to the client so
//             the UI can show live progress.
//
// SSE event types emitted:
//   { type: "plan",   steps: AgentStep[] }           — initial plan
//   { type: "step_start", stepIndex, step }           — step beginning
//   { type: "step_result", stepIndex, result }        — step completed
//   { type: "delta",  content: string }               — streaming final answer
//   { type: "done",   answer: string }                — all done
//   { type: "error",  message: string }               — fatal error

export interface AgentStep {
  type: "search" | "browse" | "code" | "answer";
  description: string;   // human-readable label shown in UI
  query?: string;        // for type === "search"
  url?: string;          // for type === "browse"
  code?: string;         // for type === "code"
  language?: string;     // for type === "code"
}

function sseEvent(res: Response, data: Record<string, unknown>): void {
  if (!res.writableEnded) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (typeof (res as any).flush === "function") (res as any).flush();
  }
}

async function generateAgentPlan(query: string): Promise<AgentStep[]> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY or LLM_API_KEY not configured");

  const response = await fetch(getApiUrl(), {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...getProviderHeaders() },
    body: JSON.stringify({
      model: getActiveModel(),
      messages: [
        {
          role: "system",
          content: `You are an AI planning assistant. Given a user query, produce a JSON array of steps to answer it.

Each step must have:
  "type": one of "search" | "browse" | "code" | "answer"
  "description": short human-readable label (max 60 chars)

Additional fields by type:
  search: "query" (the search query string)
  browse: "url" (the FULL real URL, e.g. "https://nodejs.org/en/blog/release/v22.0.0" — NEVER use placeholders)
  code:   "code" (Python code to run), "language" ("python")
  answer: (no extra fields — this is always the LAST step, synthesising all prior results)

Rules:
- Return ONLY valid JSON: an array of step objects, nothing else.
- The last step MUST be type "answer".
- Use 2-5 steps total. Do not over-plan.
- For factual / research queries: search → answer
- For web page summaries: browse → answer
- For data/calculation tasks: code → answer
- For multi-source research: search → search → answer
- For tasks needing live data then computation: search → code → answer
- CRITICAL: browse steps MUST have a complete https:// URL. If unsure of the exact URL, use search first then browse a URL from those results. NEVER use placeholder text.`,
        },
        {
          role: "user",
          content: `User query: "${query}"\n\nGenerate a step-by-step plan as a JSON array.`,
        },
      ],
      max_tokens: 800,
      temperature: 0.2,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`DeepSeek plan error ${response.status}: ${err}`);
  }

  const data = (await response.json()) as any;
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("No plan returned from AI");

  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch (jsonErr) {
    console.warn("[ai.ts] JSON parse failed for plan:", (jsonErr as Error).message);
    throw new Error("AI returned invalid JSON plan");
  }

  // Accept both { steps: [...] } and a bare array
  const steps: AgentStep[] = Array.isArray(parsed)
    ? parsed
    : parsed.steps ?? parsed.plan ?? Object.values(parsed).find(Array.isArray) ?? [];

  if (!steps.length) throw new Error("AI returned empty plan");

  // Ensure last step is always "answer"
  if (steps[steps.length - 1].type !== "answer") {
    steps.push({ type: "answer", description: "Synthesise findings and answer the user" });
  }

  return steps;
}

export async function streamAgentPlan(query: string, res: Response): Promise<void> {
  // ── Phase 1: Generate plan ─────────────────────────────────────────────────
  let steps: AgentStep[];
  try {
    steps = await generateAgentPlan(query);
  } catch (err) {
    sseEvent(res, { type: "error", message: (err as Error).message });
    return;
  }

  sseEvent(res, { type: "plan", steps });

  // ── Phase 2: Execute steps ─────────────────────────────────────────────────
  // Accumulate results from each step to pass as context to the final answer
  const stepResults: Array<{ step: AgentStep; result: string }> = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    sseEvent(res, { type: "step_start", stepIndex: i, step });

    try {
      let result = "";

      if (step.type === "search") {
        // Dynamic import to avoid circular deps — search module is in same dir
        const { aggregateSearch } = await import("./search");
        // v8.4.0: Agent plan search steps use SearXNG only (free). Brave is NOT used here.
        const sources = await aggregateSearch(step.query ?? query, "all", 8, { useBrave: false });
        const safeSources = sources ?? [];
        result = safeSources
          .slice(0, 6)
          .map((s, idx) => `[${idx + 1}] ${s.title} (${s.domain})\n${s.snippet}`)
          .join("\n\n");
        sseEvent(res, { type: "step_result", stepIndex: i, result: `Found ${safeSources.length} sources`, sources: safeSources.slice(0, 6) });
        sseEvent(res, { type: "step_result", stepIndex: i, result: `Found ${safeSources.length} sources`, sources: safeSources.slice(0, 6) });

      } else if (step.type === "browse") {
        const { browseUrl } = await import("./browser");
        let urlToBrowse = step.url ?? "";

        // Validate URL — if the model gave a placeholder or empty string, try to
        // extract a real URL from prior search step results
        let isValidUrl = false;
        try {
          const parsed = new URL(urlToBrowse);
          isValidUrl = parsed.protocol === "http:" || parsed.protocol === "https:";
        } catch { isValidUrl = false; }

        if (!isValidUrl) {
          // Attempt to recover: find first http/https URL from prior search results
          const searchResult = stepResults.find(sr => sr.step.type === "search");
          if (searchResult) {
            const urlMatch = searchResult.result.match(/https?:\/\/[^\s)\]"]+/);
            if (urlMatch) {
              urlToBrowse = urlMatch[0];
              isValidUrl = true;
              sseEvent(res, { type: "step_info", stepIndex: i, message: `Recovered URL from search results: ${urlToBrowse}` });
            }
          }
        }

        if (!isValidUrl) {
          result = `Browse skipped: no valid URL was provided or recoverable from prior steps.`;
          sseEvent(res, { type: "step_result", stepIndex: i, result: "Skipped: no valid URL" });
        } else {
          const browsed = await browseUrl(urlToBrowse);
          if (browsed.error) {
            result = `Browse failed: ${browsed.error}`;
          } else {
            // v5.35: Dynamic browse limit based on model context (5% of context)
            const browseLimit = Math.max(4000, Math.floor(getContextWindow(getActiveModel()) * 4 * 0.05));
            result = `Title: ${browsed.title}\n\n${(browsed.content ?? "").slice(0, browseLimit)}`;
          }
          sseEvent(res, { type: "step_result", stepIndex: i, result: browsed.error ? `Error: ${browsed.error}` : `Browsed: ${browsed.title}` });
        }

      } else if (step.type === "code") {
        const { executeCodeWithWorkspace } = await import("./workspace");
        const runResult = await executeCodeWithWorkspace(step.code ?? "", step.language);
        result = runResult.stdout || runResult.stderr || "(no output)";
        sseEvent(res, { type: "step_result", stepIndex: i, result: result.slice(0, 500), exitCode: runResult.exitCode });

      } else if (step.type === "answer") {
        // Build context from all prior step results


        const contextParts = stepResults.map(
          (sr, idx) => `## Step ${idx + 1}: ${sr.step.description}\n${sr.result}`
        );
        const context = contextParts.join("\n\n---\n\n");

        const systemPrompt = buildSystemPrompt("standard");
        const userMessage = `User query: "${query}"

Research gathered in prior steps:
${context}

Based on the above gathered information, provide a comprehensive, well-structured answer to the user's query. Use inline citations where appropriate.`;

        // Stream the final answer using the existing streamToResponse helper
        await streamToResponse(
          [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
          ],
          res,
          { maxTokens: 4000, temperature: 0.5 }
        );

        sseEvent(res, { type: "done" });
        return; // answer step ends the loop
      }

      stepResults.push({ step, result });

    } catch (err) {
      const message = (err as Error).message;
      sseEvent(res, { type: "step_error", stepIndex: i, message });
      stepResults.push({ step, result: `Error: ${message}` });
      // Continue to next step — don't abort the whole plan on one step failure
    }
  }

  // Fallback if no "answer" step was reached (shouldn't happen)
  sseEvent(res, { type: "done" });
}

// ─── Claude Code-inspired capabilities ───────────────────────────────────────

// ── 1. Plan Mode (EnterPlanMode / ExitPlanMode) ───────────────────────────────
// Generates a structured plan BEFORE execution. The UI shows this plan and
// waits for user approval before proceeding — inspired by Claude Code's
// plan mode which prevents unintended side effects.
export interface ExecutionPlan {
  title: string;
  steps: Array<{
    id: number;
    action: string;
    description: string;
    risk: "low" | "medium" | "high";
    reversible: boolean;
  }>;
  estimatedDuration: string;
  warnings: string[];
}

export async function generateExecutionPlan(goal: string): Promise<ExecutionPlan> {
  // v11.24.0 Audit 16 Fix C: Wire getActivePlan and failStep from taskPlanner
  try {
    const { getActivePlan, failStep } = await import("./taskPlanner.js");
    const activePlans = getActivePlan("system-default"); // Example plan ID
    if (activePlans && activePlans.status === "executing") {
      // We already have a plan running, log it
      console.log(`[aiPlanning] Note: generateExecutionPlan called while system-default is active`);
    }
  } catch { /* non-fatal */ }

  const apiKey = getApiKey();
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY or LLM_API_KEY not configured");

  const response = await fetch(getApiUrl(), {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...getProviderHeaders() },
    body: JSON.stringify({
      model: getActiveModel(),
      messages: [
        {
          role: "system",
          content: `You are an AI planning assistant. Given a goal, produce a structured execution plan as JSON.

Return ONLY valid JSON in this exact format:
{
  "title": "Brief plan title",
  "steps": [
    {
      "id": 1,
      "action": "action_type (search|browse|code|edit|analyze|create)",
      "description": "What this step does (max 80 chars)",
      "risk": "low|medium|high",
      "reversible": true|false
    }
  ],
  "estimatedDuration": "e.g. 30 seconds",
  "warnings": ["Any important warnings or caveats"]
}

Rules:
- Keep steps to 3-7 maximum
- Mark file modifications as risk: "medium" and reversible: false
- Mark web searches as risk: "low" and reversible: true
- Mark code execution as risk: "medium" and reversible: false
- Only include warnings if genuinely important`,
        },
        {
          role: "user",
          content: `Goal: ${goal}\n\nGenerate an execution plan.`,
        },
      ],
      max_tokens: 1500,
      temperature: 0.2,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) throw new Error(`Plan generation failed: ${response.status}`);
  const data = (await response.json()) as any;
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("No plan returned");
  return JSON.parse(content) as ExecutionPlan;
}

// ── 2. Context Compression (/compact command) ─────────────────────────────────
// Summarizes a conversation thread to free context window space.
// Inspired by Claude Code's /compact command which summarizes the conversation
// to allow longer sessions without hitting context limits.
export async function compactThread(
  thread: Array<{ query: string; answer: string }>
): Promise<{ summary: string; turnCount: number; originalChars: number; compressedChars: number }> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY or LLM_API_KEY not configured");

  const threadText = thread
    .map((t, i) => `Turn ${i + 1}:\nUser: ${t.query}\nAssistant: ${t.answer.slice(0, 2000)}`)
    .join("\n\n---\n\n");

  const originalChars = threadText.length;

  const response = await fetch(getApiUrl(), {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...getProviderHeaders() },
    body: JSON.stringify({
      model: getActiveModel(),
      messages: [
        {
          role: "system",
          content: `You are a conversation summarizer. Compress the following conversation thread into a dense, information-rich summary that preserves all key facts, decisions, code snippets, and conclusions. The summary will be used as context for future turns in the same conversation.

Format: Write a single flowing summary paragraph followed by a ## Key Points section with bullet points for the most important facts, decisions, or code. Maximum 600 words total.`,
        },
        {
          role: "user",
          content: `Compress this conversation:\n\n${threadText}`,
        },
      ],
      max_tokens: 1000,
      temperature: 0.3,
    }),
  });

  if (!response.ok) throw new Error(`Compact failed: ${response.status}`);
  const data = (await response.json()) as any;
  const summary = data.choices?.[0]?.message?.content || "Conversation summary unavailable.";

  return {
    summary,
    turnCount: thread.length,
    originalChars,
    compressedChars: summary.length,
  };
}

// ── 3. TodoTool (structured task tracking) ───────────────────────────────────
// In-memory todo list for the current session. Inspired by Claude Code's
// TodoWriteTool / TodoReadTool which give the agent a persistent task list
// it can update as it works through complex multi-step tasks.
interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "executing" | "done" | "cancelled";
  priority: "high" | "medium" | "low";
  createdAt: string;
  updatedAt: string;
}

const todoStore: Map<string, TodoItem> = new Map();

// v5.34: Periodic cleanup — evict completed/cancelled todos older than 1 hour,
// and all todos older than 24 hours to prevent unbounded memory growth
setInterval(() => {
  const now = Date.now();
  const ONE_HOUR = 3600_000;
  const ONE_DAY = 86400_000;
  for (const [id, item] of Array.from(todoStore.entries())) {
    const age = now - new Date(item.updatedAt).getTime();
    if ((item.status === "done" || item.status === "cancelled") && age > ONE_HOUR) {
      todoStore.delete(id);
    } else if (age > ONE_DAY) {
      todoStore.delete(id);
    }
  }
}, 300_000).unref(); // Check every 5 minutes

export function todoCreate(content: string, priority: "high" | "medium" | "low" = "medium"): TodoItem {
  const id = `todo_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const now = new Date().toISOString();
  const item: TodoItem = { id, content, status: "pending", priority, createdAt: now, updatedAt: now };
  todoStore.set(id, item);
  return item;
}

export function todoUpdate(id: string, updates: Partial<Pick<TodoItem, "status" | "content" | "priority">>): TodoItem | null {
  const item = todoStore.get(id);
  if (!item) return null;
  Object.assign(item, updates, { updatedAt: new Date().toISOString() });
  todoStore.set(id, item);
  return item;
}

export function todoList(): TodoItem[] {
  return Array.from(todoStore.values()).sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

export function todoDelete(id: string): boolean {
  return todoStore.delete(id);
}

export function todoClear(): void {
  todoStore.clear();
}

// ── 4. ANDROMEDA.md writer ─────────────────────────────────────────────────────
// Allows Andromeda to write/update its own ANDROMEDA.md memory file,
// similar to how Claude Code can update CLAUDE.md with project notes.
export async function writeAndromedaMemory(content: string): Promise<{ path: string; chars: number }> {
  const workspaceRoot = process.env.WORKSPACE_ROOT || path.join(process.cwd(), "workspace");
  const memPath = path.join(workspaceRoot, "ANDROMEDA.md");
  try {
    if (!fs.existsSync(workspaceRoot)) {
      fs.mkdirSync(workspaceRoot, { recursive: true });
    }
    fs.writeFileSync(memPath, content, "utf-8");
    return { path: memPath, chars: content.length };
  } catch (err) {
    throw new Error(`Failed to write ANDROMEDA.md: ${(err as Error).message}`);
  }
}

export function readAndromedaMemory(): string | null {
  try {
    const workspaceRoot = process.env.WORKSPACE_ROOT || path.join(process.cwd(), "workspace");
    const memPath = path.join(workspaceRoot, "ANDROMEDA.md");
    if (fs.existsSync(memPath)) {
      return fs.readFileSync(memPath, "utf-8");
    }
  } catch (err) { log.caught("ignore", err); }
  return null;
}

