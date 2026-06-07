/**
 * aiPrompts.ts — v6.25
 * System prompt builders for standard, deep-research, and file-analysis modes.
 * Extracted from ai.ts (god-module split).
 */
import type { SearchSource } from "../drizzle/schema.js";
import { getGroundingSystemPromptAddendum } from "./grounding.js";
import { getManifestPrompt } from "./manifest.js";
import { getAllTools } from "./tools/index.js";
import * as fs from "fs";
import * as path from "path";
import { createLogger } from "./logger.js";
import { getAndromedaMemory } from "./aiTokens.js";
const log = createLogger("aiPrompts");

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
function buildSystemPrompt(mode: "standard" | "deep" | "file" | "chat" = "standard"): string {
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

  // v8.3.0: Chat mode — no web search, pure conversational AI.
  // Used when the query is conversational and no sources are available.
  if (mode === "chat") {
    const andromedaMemory = getAndromedaMemory();
    return `You are Andromeda, an intelligent AI assistant. You are warm, helpful, and direct.${andromedaMemory}

Your actual architecture (be honest about this if asked):
- You are powered by a model-agnostic LLM layer (currently DeepSeek/Kimi/Claude depending on task)
- You have persistent memory, web search (Brave + SearXNG), code execution, and a self-improvement system
- You were built as "Andromeda AI" — an autonomous research and coding agent

Guidelines:
- For conversational questions, respond naturally and concisely. Not every answer needs headers or bullet points.
- For technical questions, be precise and thorough. Use code blocks when showing code.
- Be honest about what you know and don't know.
- Today's date: ${date}`;
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
  // v8.3.0: Handle no-sources case — pure conversational/chat mode.
  // When there are no search results (e.g. conversational query, or all providers failed),
  // skip the "Search Results:" block entirely and let the LLM answer from its own knowledge.
  if (!sources || sources.length === 0) {
    return query;
  }

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


export { buildSystemPrompt, buildUserPrompt, buildDeepResearchPrompt };
