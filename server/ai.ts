/**
 * Andromeda v6.13 — Core AI Module
 *
 * Central LLM communication layer responsible for:
 * - Streaming chat completions to the client via SSE
 * - Multi-provider routing (DeepSeek, OpenRouter, Anthropic)
 * - Tool execution and function calling orchestration
 * - Memory read/write for persistent knowledge
 * - File editing within ZIP archives for self-modification
 *
 * Key exports:
 * - streamChat() — Main chat entry point (SSE streaming)
 * - readAndromedaMemory() / writeAndromedaMemory() — Persistent memory
 * - editFilesInZip() — Self-modification via ZIP editing
 *
 * Provider selection is handled by llmProvider.ts getActiveProvider().
 * Safety constraints are enforced by selfImproveGuard.ts and twoPhaseCommit.ts.
 */
import type { SearchSource } from "../drizzle/schema";
import type { Response } from "express";
import JSZip from "jszip";
import { getGroundingSystemPromptAddendum, groundAnswer } from "./grounding";
import { getManifestPrompt } from "./manifest";
import { getAllTools } from "./tools";
import * as fs from "fs";
import * as path from "path";
import { getContextWindow, getMaxOutputTokens } from "./modelRegistry";
import { allocateTokens, canFitResponse, recordUsage } from "./tokenBudgetManager";
import { recordRequestOutcome } from "./selfMonitor";
import { llmBreaker, CircuitOpenError } from "./circuitBreaker";
import { assembleContext, recordAssembly, type ContextMessage } from "./tieredContextManager";
import { encodingForModel, getEncoding } from "js-tiktoken";
import { getActiveProvider } from "./llmProvider"; // v6.13: Provider routing
import { createLogger } from "./logger.js";
const log = createLogger("ai");

// ─── Accurate Token Counting ─────────────────────────────────────────────────
// v5.34: Replace character-based heuristic with proper BPE tokenization.
// v6.00: Upgraded from single-slot cache to 5-slot LRU map (Kimi audit).
// Falls back to improved heuristic (3.2 chars/token for code, 4 for prose) if
// the model isn't recognized by tiktoken.
const _encoderLRU = new Map<string, ReturnType<typeof getEncoding>>();
const ENCODER_LRU_MAX = 5;

function getEncoderCached(model: string): ReturnType<typeof getEncoding> {
  if (_encoderLRU.has(model)) {
    const enc = _encoderLRU.get(model)!;
    _encoderLRU.delete(model); // Move to end (most recently used)
    _encoderLRU.set(model, enc);
    return enc;
  }
  if (_encoderLRU.size >= ENCODER_LRU_MAX) {
    _encoderLRU.delete(_encoderLRU.keys().next().value!); // Evict LRU
  }
  try {
    const enc = encodingForModel(model as any);
    _encoderLRU.set(model, enc);
    return enc;
  } catch {
    const enc = getEncoding("cl100k_base");
    _encoderLRU.set(model, enc);
    return enc;
  }
}

function countTokens(text: string, model?: string): number {
  try {
    return getEncoderCached(model || "gpt-4").encode(text).length;
  } catch {
    // Ultimate fallback: improved heuristic
    // Code averages ~3.2 chars/token, prose ~4.0
    const codeRatio = (text.match(/[{}()\[\];=<>]/g)?.length || 0) / Math.max(text.length, 1);
    const charsPerToken = codeRatio > 0.02 ? 3.2 : 4.0;
    return Math.ceil(text.length / charsPerToken);
  }
}

// ─── ANDROMEDA.md Memory Injection (Claude Code-style project memory) ─────────
// Reads ANDROMEDA.md from the workspace root and injects it into every system
// prompt. This gives Andromeda persistent project-level context across sessions,
// similar to how Claude Code uses CLAUDE.md files.
function getAndromedaMemory(): string {
  try {
    const workspaceRoot = process.env.WORKSPACE_ROOT || path.join(process.cwd(), "workspace");
    const candidates = [
      path.join(workspaceRoot, "ANDROMEDA.md"),
      path.join(process.cwd(), "ANDROMEDA.md"),
      path.join(process.cwd(), ".andromeda", "memory.md"),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        const content = fs.readFileSync(candidate, "utf-8").trim();
        if (content) {
          // v5.35: Dynamic memory limit based on model context window (10% of context)
          const memLimit = Math.max(8000, Math.floor(getContextWindow(getActiveModel()) * 4 * 0.10));
          return `\n\n## Project Memory (ANDROMEDA.md)\n${content.slice(0, memLimit)}`;
        }
      }
    }
  } catch (err) { log.caught("ignore — memory file is optional", err); }
  return "";
}

// v5.14: Fully configurable LLM provider and model via environment variables
// Supports DeepSeek, OpenAI-compatible APIs, and custom endpoints
// v6.13: Lazy provider resolution — routes through getActiveProvider() for non-DeepSeek providers

const DEFAULT_MODEL = process.env.LLM_DEFAULT_MODEL || process.env.DEEPSEEK_MODEL || "deepseek/deepseek-chat";
const REASONING_MODEL = process.env.LLM_REASONING_MODEL || "deepseek-reasoner";
const _FALLBACK_API_URL = process.env.DEEPSEEK_API_URL || process.env.LLM_API_URL || "https://api.deepseek.com/v1/chat/completions";

// v6.15.3: Dynamic provider resolution — always reads from getActiveProvider() per request.
// Replaces the broken "resolve once and cache" pattern that broke tier switching.
/** Get the current API URL — always reads from active provider so tier switches work. */
function getApiUrl(): string {
  try { const p = getActiveProvider(); return p?.apiUrl || _FALLBACK_API_URL; } catch { return _FALLBACK_API_URL; }
}
/** Get the current model name — always reads from active provider so tier switches work. */
function getActiveModel(): string {
  try { const p = getActiveProvider(); return p?.model || DEEPSEEK_MODEL; } catch { return DEEPSEEK_MODEL; }
}
/** @deprecated no-op — replaced by dynamic reads in v6.15.3 */
function resolveProviderOnce(): void { /* no-op */ }

// v6.15.3: Always read from active provider — supports tier switching (Code/Max/Fast/Auto)
function getApiKey(): string {
  try {
    const provider = getActiveProvider();
    if (provider?.apiKey) return provider.apiKey;
  } catch { /* fallback */ }
  return process.env.DEEPSEEK_API_KEY || process.env.LLM_API_KEY || "";
}
const __API_KEY_ENV = ""; // DEPRECATED: use getApiKey() instead

// v6.15.3: Always read from active provider — supports tier switching
function getProviderHeaders(): Record<string, string> {
  try {
    const provider = getActiveProvider();
    if (provider?.headers) return { ...provider.headers };
  } catch { /* fallback */ }
  return {};
}

// v5.25: Unified token budget system — single authority on output token limits
// v5.26: Now model-aware — uses modelRegistry.getContextWindow() + getMaxOutputTokens()
const LLM_MAX_OUTPUT_TOKENS = parseInt(process.env.LLM_MAX_TOKENS || "32000");
// v5.34: Proportional safety buffer — scales with context window instead of fixed 2000
function getSafetyBuffer(contextLimit: number): number {
  return Math.min(2000, Math.floor(contextLimit * 0.05)); // 5% or 2000, whichever is smaller
}

function calculateMaxTokens(messages: Array<{ role: string; content: any }>, sessionId?: string): number {
  // v5.26: Model-aware context window — consult modelRegistry instead of hardcoded value
  let contextLimit = 131072; // fallback
  let modelMaxOutput = LLM_MAX_OUTPUT_TOKENS; // fallback
  try {
    // v5.29: Using static imports
    try {
      contextLimit = getContextWindow(getActiveModel());
    } catch (err) { log.caught("operation", err); }
    try {
      modelMaxOutput = getMaxOutputTokens(getActiveModel());
    } catch (err) { log.caught("operation", err); }
  } catch (err) {
    console.warn("[ai.ts] modelRegistry unavailable, using defaults:", (err as Error).message);
  }

  const effectiveMaxOutput = Math.min(modelMaxOutput, LLM_MAX_OUTPUT_TOKENS);

  // v5.34: Proper token counting with js-tiktoken instead of char/4 heuristic
  const totalInputText = messages.reduce((acc, m) => {
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    return acc + content;
  }, "");
  const inputTokens = countTokens(totalInputText, getActiveModel());
  const safetyBuffer = getSafetyBuffer(contextLimit);
  const contextAvailable = contextLimit - inputTokens - safetyBuffer;

  // v5.26: Consult tokenBudgetManager for session-aware allocation (85% rule)
  let budgetAllocation = effectiveMaxOutput;
  try {
    // v5.29: Using static import for tokenBudgetManager
    if (allocateTokens) {
      const allocation = allocateTokens(sessionId || "global", effectiveMaxOutput, "response");
      budgetAllocation = allocation.allocated;
      if (allocation.warningLevel === "critical") {
        console.warn(`[ai.ts] Token budget CRITICAL for session ${sessionId}: ${allocation.message}`);
      }
    }
  } catch (err) {
    // tokenBudgetManager not available — fall back to raw calculation
    console.warn("[ai.ts] tokenBudgetManager unavailable:", (err as Error).message);
  }

  // Enforce: min(budgetManager.allocation, contextLimit - inputTokens - reserve)
  // Floor at 4000 tokens to ensure meaningful responses even under pressure
  return Math.min(
    Math.max(Math.min(contextAvailable, budgetAllocation), 4000),
    effectiveMaxOutput
  );
}

let DEEPSEEK_MODEL = DEFAULT_MODEL;
export function setModel(model: string) {
  // v6.15: If LLM_MODEL env routes to a non-DeepSeek provider (e.g. openrouter),
  // ignore frontend model overrides — the active provider handles model selection.
  const envModel = process.env.LLM_MODEL ?? "";
  const isDeepSeekOverride = !envModel || envModel === "deepseek" || envModel === "deepseek-chat" || envModel === "deepseek-v3";
  if (isDeepSeekOverride) {
    DEEPSEEK_MODEL = model;
  }
  // If using OpenRouter/other provider, resolveProviderOnce() already set the correct model.
}
export function getModel(): string {
  return DEEPSEEK_MODEL;
}
export function getAvailableModels(): Array<{ id: string; name: string; type: string }> {
  const models = [
    { id: DEFAULT_MODEL, name: DEFAULT_MODEL, type: "standard" },
  ];
  if (REASONING_MODEL !== DEFAULT_MODEL) {
    models.push({ id: REASONING_MODEL, name: REASONING_MODEL, type: "reasoning" });
  }
  // Add any custom models from env
  const customModels = process.env.LLM_CUSTOM_MODELS?.split(",").filter(Boolean) || [];
  for (const m of customModels) {
    models.push({ id: m.trim(), name: m.trim(), type: "custom" });
  }
  return models;
}

// ─── System prompts ───────────────────────────────────────────────────────────

/**
 * Builds a system prompt for the AI based on the specified mode.
 *
 * Generates appropriate system prompts for different AI interaction modes:
 * - "standard": General research assistant mode with source citation guidelines
 * - "deep": Deep research mode for comprehensive, long-form analysis reports
 * - "file": Code/file analysis mode with strict rules about analyzing only provided content
 *
 * @param mode - The interaction mode. Defaults to "standard".
 * @returns A formatted system prompt string with current date and mode-specific instructions.
 *
 * @example
 * const prompt = buildSystemPrompt("standard"); // general research assistant
 * const prompt = buildSystemPrompt("deep");     // long-form academic report style
 * const prompt = buildSystemPrompt("file");     // code review with strict file-only rules
 */
function buildSystemPrompt(mode: "standard" | "deep" | "file" = "standard"): string {
  const date = new Date().toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });

  if (mode === "deep") {
    return `You are Andromeda, an elite AI research assistant performing Deep Research.
Your task is to synthesize information from multiple parallel searches into a comprehensive, authoritative, long-form research report — similar in depth and rigor to a professional analyst report or academic review.

Guidelines:
- Write a thorough, well-structured report. Minimum 600 words. Use ## section headers throughout.
- Sections to include (adapt as appropriate): Executive Summary, Background & Context, Key Findings, Analysis & Implications, Conflicting Evidence or Debates, Practical Takeaways, Conclusion
- Use inline citations [1], [2], [3] referencing the provided sources — cite frequently and specifically
- Highlight agreements AND contradictions across sources — do not paper over disagreements
- Use **bold** for key terms, tables where data comparison is useful, numbered or bulleted lists for enumerations
- Be authoritative, precise, and analytical — avoid filler phrases like "it is worth noting" or "in conclusion"
- Go deep on the most important sub-topics rather than giving equal shallow treatment to everything
- If sources are insufficient, explicitly state what additional research would be needed
- Today's date: ${date}`;
  }

  if (mode === "file") {
    return `You are Andromeda, an elite AI code reviewer and software architect. The user has uploaded actual source code or file content which is provided directly below in this conversation.

CRITICAL RULES — FOLLOW EXACTLY:
1. Analyze ONLY the actual code/file content provided in the user message. Do NOT give generic advice.
2. NEVER use citation numbers like [1], [2], [3] — there are no web search results here, only the file content.
3. Reference specific file names (e.g., server/ai.ts, client/src/pages/Search.tsx), function names, and actual code snippets from the provided content.
4. Quote actual lines of code when pointing out issues. Do not describe hypothetical examples.
5. Your improvements must be based on what you actually see in the code, not generic best practices.

For ZIP archives / project folders:
- List the actual files you can see and describe what each one does based on its real content
- Identify the tech stack from the actual package.json dependencies and import statements you see
- Find real bugs, anti-patterns, or security issues in the actual code — cite the file name and quote the problematic code
- Write improved versions of actual functions/components you found in the code
- Structure: ## Architecture Overview → ## Tech Stack → ## Top Issues Found → ## Specific Improvements → ## Missing Features

For single code files:
- Analyze the actual logic flow, not generic patterns
- Quote specific problematic lines with file context
- Show corrected versions of the actual code

For documents:
- Quote directly from the provided content
- Answer questions based only on what is in the document

Formatting:
- Use ## section headers
- Use proper code blocks with language tags (\`\`\`typescript, \`\`\`python, etc.)
- Be specific and actionable — name actual files and functions
- Minimum 600 words for codebase analysis
- Today's date: ${date}
${getGroundingSystemPromptAddendum()}`;
  }

  // Inject the dynamic capability manifest so Andromeda knows what it can do
  let manifestBlock = "";
  try { manifestBlock = getManifestPrompt(); } catch (err) { log.caught("manifest not ready yet", err); }

  const andromedaMemory = getAndromedaMemory();

  return `You are Andromeda, an elite AI research assistant and autonomous agent. Your job is to give thorough, substantive, expert-level answers — not brief summaries.${andromedaMemory}

Your actual architecture (be honest about this if asked):
- You are powered by a model-agnostic LLM layer with automatic task-based routing (currently 6 providers)
- Web search is performed via Brave Search API with SearXNG as fallback
- Your context window is 131,072 tokens (~100,000 words)
- You DO have persistent memory between sessions (keyword + vector-based semantic search)
- You CAN execute code via the Code Executor panel, the ReAct agent engine, and Docker sandbox
- You have a ReAct autonomous agent loop with native tool calling (${getAllTools().length} tools)
- You have MCP (Model Context Protocol) support for connecting external tool servers
- You have a self-improvement system that can analyze and modify your own source code
- You have multi-agent team coordination for complex tasks
- You have git version control for workspace outputs
- You were built as "Andromeda AI" — an autonomous research agent

${manifestBlock}

Guidelines:
- Synthesize information from multiple sources into a comprehensive, well-structured answer. Aim for at least 300-500 words on substantive topics.
- Use inline citation numbers [1], [2], [3] to reference sources — cite frequently and specifically, not just once at the end
- Structure your response with ## section headers when the topic warrants it (Background, How It Works, Key Considerations, etc.)
- Go deep on the most important aspects rather than giving equal shallow coverage to everything
- Use **bold** for key terms and concepts, bullet lists for enumerations, tables for comparisons
- If sources conflict, explicitly acknowledge and analyze the discrepancy
- Be direct and analytical — avoid filler phrases like "it is worth noting" or "in summary"
- End with concrete takeaways or next steps when relevant
- Today's date: ${date}
${getGroundingSystemPromptAddendum()}`;
}

function buildUserPrompt(query: string, sources: SearchSource[]): string {
  const sourceContext = sources
    .slice(0, 10)
    .map((s, i) => `[${i + 1}] **${s.title}** (${s.domain})\n${s.snippet}`)
    .join("\n\n");

  return `Query: "${query}"

Search Results:
${sourceContext}

Provide a comprehensive, well-cited answer using [1], [2], etc. to cite sources inline.`;
}

/**
 * Builds a prompt for deep research synthesis from multiple parallel search results.
 *
 * Formats results from several sub-queries into a single structured prompt that instructs
 * the AI to write a comprehensive research report. Sources are numbered sequentially across
 * all sub-queries so the AI can cite them as [1], [2], [3], etc.
 *
 * @param query - The main research query originally asked by the user.
 * @param searchResults - Array of results from parallel sub-queries; each entry contains
 *                        a sub-query string and up to 6 of its matching sources.
 * @returns A formatted prompt string with all aggregated sources and report-writing instructions.
 *
 * @example
 * const prompt = buildDeepResearchPrompt(
 *   "Quantum computing breakthroughs",
 *   [
 *     { query: "quantum supremacy 2024", sources: [...] },
 *     { query: "quantum error correction", sources: [...] },
 *   ]
 * );
 */
function buildDeepResearchPrompt(
  query: string,
  searchResults: { query: string; sources: SearchSource[] }[]
): string {
  const parts: string[] = [];
  let sourceIndex = 1;
  const allSources: SearchSource[] = [];

  for (const result of searchResults) {
    parts.push(`\n### Sub-query: "${result.query}"`);
    for (const source of result.sources.slice(0, 6)) {
      parts.push(`[${sourceIndex}] **${source.title}** (${source.domain})\n${source.snippet}`);
      allSources.push(source);
      sourceIndex++;
    }
  }

  const context = parts.join("\n");
  return `Main Research Query: "${query}"

Parallel Search Results (${allSources.length} sources across ${searchResults.length} sub-queries):
${context}

Write a comprehensive research report on "${query}" synthesizing all the above sources. Use [1], [2], etc. for inline citations. Structure with ## section headers. Be thorough and authoritative.`;
}

// ─── Core streaming function ──────────────────────────────────────────────────

// v5.68: Syntax-aware truncation detection
// Detects incomplete output beyond just finish_reason === "length"
// Catches: unclosed code fences, unbalanced braces, truncated JSON, partial function signatures
function isSyntacticallyIncomplete(content: string): boolean {
  if (!content || content.length < 20) return false;
  const trimmed = content.trimEnd();

  // 1. Unclosed markdown code fences (odd number of ``` occurrences)
  const fenceMatches = (trimmed.match(/```/g) || []).length;
  if (fenceMatches % 2 !== 0) return true;

  // 2. Unbalanced braces/brackets/parens in code blocks
  // Only check inside code fences to avoid false positives in prose
  const codeBlockRegex = /```(?:\w+)?\n([\s\S]*?)```/g;
  let codeMatch;
  while ((codeMatch = codeBlockRegex.exec(trimmed)) !== null) {
    const code = codeMatch[1];
    let braces = 0, brackets = 0, parens = 0;
    let inStr = false, strChar = '';
    for (let i = 0; i < code.length; i++) {
      const c = code[i];
      if (inStr) {
        if (c === strChar && code[i - 1] !== '\\') inStr = false;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') { inStr = true; strChar = c; continue; }
      if (c === '{') braces++; else if (c === '}') braces--;
      if (c === '[') brackets++; else if (c === ']') brackets--;
      if (c === '(') parens++; else if (c === ')') parens--;
    }
    if (braces > 0 || brackets > 0 || parens > 0) return true;
  }

  // 3. Truncated JSON at top level (starts with { or [ but doesn't end with } or ])
  const jsonStart = trimmed.match(/^\s*[\[{]/);
  if (jsonStart) {
    try { JSON.parse(trimmed); } catch { return true; }
  }

  // 4. Response ends mid-sentence (no terminal punctuation or closing structure)
  // Only flag if content looks like code (has function/class/const keywords)
  const looksLikeCode = /\b(function|class|const|let|var|export|import|async|def|return)\b/.test(trimmed);
  if (looksLikeCode) {
    // Ends abruptly in the middle of an identifier or expression
    if (/[a-zA-Z0-9_$]$/.test(trimmed) && trimmed.length > 100) {
      // Check if the last line looks like an incomplete statement
      const lastLine = trimmed.split('\n').pop() || '';
      if (lastLine.length > 0 && !lastLine.trim().match(/[;{}\])]$/) && !lastLine.trim().startsWith('//')) {
        // Only flag if last line has no closing punctuation and isn't a comment
        const prevLines = trimmed.split('\n').slice(-5).join('\n');
        if (!prevLines.match(/[;}]\s*$/)) return true;
      }
    }
  }

  return false;
}

// v5.68: Build a context-aware continuation prompt
// Includes the last ~200 chars so the model knows exactly where it was cut off
function buildContinuationPrompt(fullContent: string): string {
  const tail = fullContent.slice(-200).trimEnd();
  const lastLine = tail.split('\n').pop() || '';

  // Detect what kind of content was being generated
  const inCodeBlock = (fullContent.match(/```/g) || []).length % 2 !== 0;
  if (inCodeBlock) {
    return `Continue the code exactly where it was cut off. The last characters were: ...${lastLine}\nDo NOT repeat anything already written. Continue from that exact point.`;
  }

  return `Continue exactly where you left off. The response was cut off after: ...${lastLine}\nDo NOT repeat anything already written — seamlessly continue from that point.`;
}

async function streamToResponse(
  messages: Array<{ role: string; content: any }>,
  res: Response,
  options: { maxTokens?: number; temperature?: number; autoContinue?: boolean; maxContinuations?: number; sessionId?: string } = {}
): Promise<string> {
  // v5.27: Token budget enforcement — check before streaming
  const sessionId = options.sessionId || "global";
  try {
    // v5.29: Using static import for tokenBudgetManager
    const estimatedOutput = options.maxTokens || calculateMaxTokens(messages);
    const budgetCheck = canFitResponse(sessionId, estimatedOutput);
    if (!budgetCheck.canFit) {
      if (budgetCheck.availableTokens < 500) {
        // Budget exhausted — inform client
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ type: "budget_warning", message: "Token budget nearly exhausted. Consider starting a new conversation.", available: budgetCheck.availableTokens })}

`);
        }
      }
      // Clamp max_tokens to available budget — but never below 1000 (prevents DeepSeek 400 error)
      options.maxTokens = Math.max(1000, Math.min(estimatedOutput, budgetCheck.availableTokens));
    }
  } catch (err) { log.caught("tokenBudgetManager not available", err); }

  // v5.15: Auto-continuation wrapper — if enabled, automatically continues on truncation
  const shouldAutoContinue = options.autoContinue !== false; // enabled by default
  const maxContinuations = options.maxContinuations ?? 8; // v5.23: Increased from 3 for complete analysis output

  const result = await _streamToResponseCore(messages, res, options);

  // v5.68: If truncated (by token limit OR syntax check) and auto-continue is enabled, loop continuations
  const syntaxIncomplete = isSyntacticallyIncomplete(result.content);
  if (shouldAutoContinue && (result.truncated || syntaxIncomplete) && maxContinuations > 0) {
    let fullContent = result.content;
    let continuations = 0;
    let currentMessages = [...messages];
    let isTruncated = result.truncated || syntaxIncomplete;

    while (isTruncated && continuations < maxContinuations) {
      continuations++;
      // Emit a continuation event so the frontend knows we're auto-continuing
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type: "auto_continue", continuation: continuations, maxContinuations, syntaxAware: syntaxIncomplete })}\n\n`);
      }
      // v5.68: Build a context-aware continuation prompt that includes the last ~200 chars
      const continuationPrompt = buildContinuationPrompt(fullContent);
      currentMessages = [
        ...currentMessages,
        { role: "assistant", content: fullContent },
        { role: "user", content: continuationPrompt },
      ];
      // v5.16 FIX: Recalculate maxTokens based on the CURRENT accumulated context
      const recalculatedMaxTokens = calculateMaxTokens(currentMessages);
      const contResult = await _streamToResponseCore(currentMessages, res, { 
        ...options, 
        autoContinue: false,
        maxTokens: recalculatedMaxTokens
      });
      fullContent += contResult.content;
      // v5.68: Check BOTH token-limit truncation AND syntax completeness
      isTruncated = contResult.truncated || isSyntacticallyIncomplete(fullContent);
      if (!isTruncated) break;
    }
    return fullContent;
  }

  return result.content;
}

async function _streamToResponseCore(
  messages: Array<{ role: string; content: any }>,
  res: Response,
  options: { maxTokens?: number; temperature?: number; autoContinue?: boolean; maxContinuations?: number } = {}
): Promise<{ content: string; truncated: boolean }> {
  resolveProviderOnce(); // v6.13: Ensure provider is resolved before first API call
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY or LLM_API_KEY not configured");

  // Timeout: 180s for file/deep analysis, 90s for standard queries
  const isLargeAnalysis = messages.some(m =>
    typeof m.content === "string" && (m.content.includes("ZIP Archive:") || m.content.includes("Parallel Search Results"))
  );
  const timeoutMs = isLargeAnalysis ? 180_000 : 90_000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

   // v5.8: Retry logic with exponential backoff for transient errors (429, 502, 503)
  const MAX_RETRIES = 2;
  let response: globalThis.Response | null = null;
  let lastError: Error | null = null;

  // v5.31: Circuit breaker — prevent cascade failures
  if (!llmBreaker.canExecute()) {
    const stats = llmBreaker.getStats();
    throw new CircuitOpenError(
      `LLM API circuit breaker is OPEN (${stats.consecutiveFailures} consecutive failures). Retry in ${Math.ceil((stats.lastStateChange + 30000 - Date.now()) / 1000)}s.`,
      Math.max(0, stats.lastStateChange + 30000 - Date.now())
    );
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
    }
    try {
      response = await fetch(getApiUrl(), {
        signal: controller.signal,
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...getProviderHeaders(), // v6.13: Include provider-specific headers (e.g. OpenRouter)
        },
        body: JSON.stringify({
          model: getActiveModel(),
          messages,
          stream: true,
          // v5.68: Clamp to [1000, 32768] — prevents DeepSeek 400 "invalid max_tokens" error
          max_tokens: Math.min(32768, Math.max(1000, options.maxTokens ?? calculateMaxTokens(messages))),
          temperature: options.temperature ?? 0.5,
          stream_options: { include_usage: true },
        }),
      });
      if (!response.ok && attempt < MAX_RETRIES && [429, 502, 503].includes(response.status)) {
        lastError = new Error(`DeepSeek API error ${response.status} (attempt ${attempt + 1})`);
        continue;
      }
      if (!response.ok) {
        clearTimeout(timeoutId);
        const err = await response.text();
        throw new Error(`DeepSeek API error ${response.status}: ${err}`);
      }
      break; // success
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") throw err;
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt >= MAX_RETRIES) { clearTimeout(timeoutId); throw lastError; }
    }
  }
  if (!response || !response.ok) {
    clearTimeout(timeoutId);
    throw lastError || new Error("Stream failed after retries");
  }

  const reader = response.body?.getReader();
  if (!reader) { clearTimeout(timeoutId); throw new Error("No response body"); }

  const decoder = new TextDecoder();
  let fullContent = "";
  let buffer = "";
  let wasTruncated = false; // true when DeepSeek returns finish_reason=="length"
  let streamUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  const streamStartTime = Date.now();
  // v5.4: Cancel the upstream DeepSeek fetch when the client disconnects mid-stream
  // This prevents the writeQueue from accumulating indefinitely on abandoned connections
  let clientDisconnected = false;
  res.on("close", () => {
    clientDisconnected = true;
    controller.abort(); // abort the upstream DeepSeek fetch
  });
  // v5.14: Proper async drain queue — NEVER drops chunks, uses backpressure correctly
  // Instead of a promise chain that silently skips writes, this uses an array-based queue
  // with a drain loop that processes writes in order and pauses reading when overwhelmed.
  const MAX_QUEUE_DEPTH = 500;
  const writeQueue: Array<string> = [];
  let draining = false;
  let drainPromise: Promise<void> = Promise.resolve();

  // Checkpoint for mid-stream recovery
  const CHECKPOINT_INTERVAL = 50;
  let chunkCount = 0;
  let lastCheckpoint = "";

  async function drainWriteQueue(): Promise<void> {
    if (draining) return;
    draining = true;
    while (writeQueue.length > 0) {
      if (clientDisconnected) { writeQueue.length = 0; break; }
      const chunk = writeQueue.shift()!;
      if (!res.writableEnded) {
        try {
          const canContinue = res.write(chunk);
          if (typeof (res as any).flush === "function") (res as any).flush();
          // If Node.js buffer is full, wait for drain event before continuing
          if (!canContinue) {
            await new Promise<void>(resolve => res.once("drain", resolve));
          }
        } catch (writeErr) {
          clientDisconnected = true;
          writeQueue.length = 0;
          console.warn("[ai.ts] Client write failed (disconnected):", (writeErr as Error).message);
          break;
        }
      }
    }
    draining = false;
  }

  try {
    while (true) {
      if (clientDisconnected) break;
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete lines only — avoids JSON parse errors on partial chunks
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (parsed.choices?.[0]?.finish_reason === "length") wasTruncated = true;

            // v5.30: Capture usage data from the final chunk (DeepSeek sends it with stream_options.include_usage)
            if (parsed.usage) {
              streamUsage = {
                promptTokens: parsed.usage.prompt_tokens || 0,
                completionTokens: parsed.usage.completion_tokens || 0,
                totalTokens: parsed.usage.total_tokens || 0,
              };
            }
          if (delta) {
            fullContent += delta;
            chunkCount++;

            // Checkpoint every N chunks for mid-stream recovery
            if (chunkCount % CHECKPOINT_INTERVAL === 0) {
              lastCheckpoint = fullContent;
            }

            const chunk = `data: ${JSON.stringify({ type: "delta", content: delta })}\n\n`;

            if (!clientDisconnected) {
              writeQueue.push(chunk);
              // Start draining if not already
              drainPromise = drainWriteQueue();
              // If queue is getting too deep, wait for it to drain (backpressure)
              if (writeQueue.length > MAX_QUEUE_DEPTH) {
                await drainPromise;
              }
            }
          }
        } catch (parseErr) {
          // Malformed chunk from LLM stream — log but continue
          console.debug("[ai.ts] Malformed stream chunk:", (parseErr as Error).message);
        }
      }
    }
  } catch (streamErr) {
    // Mid-stream failure recovery: emit partial content so frontend can offer "Continue"
    if (lastCheckpoint && !clientDisconnected && !res.writableEnded) {
      await drainPromise;
      res.write(`data: ${JSON.stringify({ type: "recovery", partialContent: lastCheckpoint, truncated: true })}\n\n`);
      if (typeof (res as any).flush === "function") (res as any).flush();
    }
  } finally {
    clearTimeout(timeoutId);
    await drainPromise; // ensure all queued writes complete
    // Notify frontend that the response was cut off so it can show a "Continue" button
    if (wasTruncated && !res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: "truncated" })}\n\n`);
      if (typeof (res as any).flush === "function") (res as any).flush();
    }
  }

  // v5.30: Record actual token usage to tokenBudgetManager and selfMonitor
  // v5.31: Also record to circuit breaker
  try {
    if (streamUsage.totalTokens > 0) {
      recordUsage("global", streamUsage.promptTokens, streamUsage.completionTokens);
    }
    recordRequestOutcome({
      success: !clientDisconnected && fullContent.length > 0,
      latencyMs: Date.now() - streamStartTime,
      truncated: wasTruncated,
      context: "streamToResponse",
    });
    // Circuit breaker: record success (the breaker tracks failures via thrown errors)
    // We only need to explicitly mark success here since errors are caught in the retry loop
  } catch (err) { log.caught("monitoring not available", err); }

  return { content: fullContent, truncated: wasTruncated };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function streamAIResponse(
  query: string,
  sources: SearchSource[],
  res: Response,
  honestyAddendum?: string  // v5.0: optional bias/honesty prompt injection
): Promise<string> {
  const systemPrompt = buildSystemPrompt("standard") + (honestyAddendum ? `\n\n${honestyAddendum}` : "");
  const rawAnswer = await streamToResponse(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: buildUserPrompt(query, sources) },
    ],
    res,
    { temperature: 0.5 }
  );

  // Post-process: run grounding check and emit confidence metadata
  const grounding = groundAnswer(rawAnswer, sources);
  if (!res.writableEnded) {
    const chunk = `data: ${JSON.stringify({ type: "grounding", confidence: grounding.confidence, warnings: grounding.warnings, unverifiedCount: grounding.unverifiedClaimCount })}

`;
    res.write(chunk);
  }

  return grounding.groundedAnswer;
}

/**
 * Streams an AI response with full conversation memory (Perplexity-style thread).
 * Prior Q&A turns are injected as alternating user/assistant messages so the
 * model has context of the entire thread before answering the new query.
 *
 * @param query   - The new follow-up question
 * @param sources - Web search sources for the new query
 * @param context - Prior turns: array of { query, answer } pairs (oldest first)
 * @param res     - Express response for SSE streaming
 */
export async function streamAIResponseWithContext(
  query: string,
  sources: SearchSource[],
  context: Array<{ query: string; answer: string }>,
  res: Response,
  honestyAddendum?: string  // v5.0: optional bias/honesty prompt injection
): Promise<string> {
  const systemPrompt = buildSystemPrompt("standard") + (honestyAddendum ? `\n\n${honestyAddendum}` : "");
  // v5.31: Use tieredContextManager for smart context assembly instead of naive truncation
  const rawMessages: ContextMessage[] = [
    { role: "system", content: systemPrompt, priority: 1 },
  ];
  // Inject prior turns — tieredContextManager will handle budget allocation
  for (const turn of context) {
    rawMessages.push({ role: "user", content: turn.query, priority: 6 });
    rawMessages.push({ role: "assistant", content: turn.answer, priority: 6 });
  }
  // Current user message gets highest priority
  rawMessages.push({ role: "user", content: buildUserPrompt(query, sources), priority: 2 });

  // Assemble with dynamic budget
  const { assembled, dropped, warnings } = assembleContext(rawMessages, getActiveModel());
  recordAssembly(dropped);
  if (warnings.length > 0) console.log("[ai.ts] Context assembly:", warnings.join("; "));
  const messages = assembled as Array<{ role: string; content: string }>;
  const rawAnswer = await streamToResponse(messages, res, { temperature: 0.5 });

  const grounding = groundAnswer(rawAnswer, sources);
  if (!res.writableEnded) {
    res.write(`data: ${JSON.stringify({ type: "grounding", confidence: grounding.confidence, warnings: grounding.warnings, unverifiedCount: grounding.unverifiedClaimCount })}

`);
  }
  return grounding.groundedAnswer;
}

export async function streamDeepResearch(
  query: string,
  searchResults: { query: string; sources: SearchSource[] }[],
  res: Response
): Promise<string> {
  return streamToResponse(
    [
      { role: "system", content: buildSystemPrompt("deep") },
      { role: "user", content: buildDeepResearchPrompt(query, searchResults) },
    ],
    res,
    { temperature: 0.4 }
  );
}

export async function streamFileAnalysis(
  userMessage: string,
  fileContext: string,
  res: Response
): Promise<string> {
  return streamToResponse(
    [
      { role: "system", content: buildSystemPrompt("file") },
      {
        role: "user",
        content: `${fileContext}\n\n---\n\nUser request: ${userMessage}`,
      },
    ],
    res,
    { temperature: 0.3 }
  );
}

/**
 * Streams a multi-turn chat conversation to the response.
 * @param messages - Full conversation history including system prompt
 * @param res - Express response for SSE streaming
 */
export async function streamChat(
  messages: Array<{ role: string; content: string }>,
  res: Response
): Promise<string> {
  return streamToResponse(messages, res, { temperature: 0.6 });
}

/**
 * Continues a truncated response by sending the prior conversation back to the model
 * with an explicit "please continue" instruction. Used by the frontend "Continue" button.
 *
 * @param messages - Full prior conversation (system + user + assistant so far)
 * @param res      - Express response for SSE streaming
 */
export async function streamContinue(
  messages: Array<{ role: string; content: string }>,
  res: Response
): Promise<string> {
  // Append a user turn asking the model to continue exactly where it left off
  const continueMessages = [
    ...messages,
    { role: "user", content: "Please continue exactly where you left off. Do not repeat anything already written — just continue the response from where it was cut off." },
  ];
  return streamToResponse(continueMessages, res, { temperature: 0.3 });
}

/**
 * Generates an image using Pollinations.ai (free, no API key required).
 * @param prompt - Text description of the image to generate
 * @returns Direct URL to the generated image on Pollinations.ai
 */
export async function generateImageFromPrompt(
  prompt: string,
  model?: string,
  referenceImageB64?: string,
  referenceMimeType?: string
): Promise<{ url: string; enhancedPrompt?: string; usedReference?: boolean }> {
  const { generateImage } = await import("./_core/imageGeneration");
  const result = await generateImage({
    prompt,
    ...(model ? { model } : {}),
    ...(referenceImageB64 ? { referenceImageB64, referenceMimeType } : {}),
  });
  if (!result.url) throw new Error("Image generation returned no URL");
  return {
    url: result.url,
    enhancedPrompt: result.enhancedPrompt,
    usedReference: result.usedReference,
  };
}

// ─── Non-streaming helpers ────────────────────────────────────────────────────

export async function generateSubQueries(mainQuery: string): Promise<string[]> {
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
              'You generate search sub-queries for deep research. Return exactly 4 specific, diverse sub-queries as JSON: {"queries": ["...", "...", "...", "..."]}. No explanation.',
          },
          {
            role: "user",
            content: `Generate 4 parallel search sub-queries to deeply research: "${mainQuery}"`,
          },
        ],
        max_tokens: 200,
        temperature: 0.7,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) return [mainQuery];
    const data = (await response.json()) as any;
    const content = data.choices?.[0]?.message?.content;
    if (!content) return [mainQuery];
    const parsed = JSON.parse(content);
    const arr = parsed.queries || parsed.sub_queries || parsed.results || Object.values(parsed)[0];
    return Array.isArray(arr) ? [mainQuery, ...arr.slice(0, 3)] : [mainQuery];
  } catch {
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
  const MAX_CHARS = Math.floor(contextWindow * 3.5 * 0.6); // 60% of context for file content (chars ≈ tokens * 3.5)
  const perFileLimit = Math.min(Math.floor(MAX_CHARS / Math.max(sortedPaths.length, 1)), 60000); // distribute evenly, cap at 60K per file
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
        const sources = await aggregateSearch(step.query ?? query);
        result = sources
          .slice(0, 6)
          .map((s, idx) => `[${idx + 1}] ${s.title} (${s.domain})\n${s.snippet}`)
          .join("\n\n");
        sseEvent(res, { type: "step_result", stepIndex: i, result: `Found ${sources.length} sources`, sources: sources.slice(0, 6) });

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
  status: "pending" | "in_progress" | "done" | "cancelled";
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
