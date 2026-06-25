/**
 * aiStreaming.ts — v6.25
 * Core SSE streaming engine and public streaming API.
 * Extracted from ai.ts (god-module split).
 */
// v8.5.0: recordUsage must come from tokenBudgetManager (takes sessionId string), not fileEngineUtils (takes CostBudget object)
import { recordUsage } from "./tokenBudgetManager.js";
import type { SearchSource } from "../drizzle/schema.js";
import type { Response } from "express";
import { getActiveProvider } from "./llmProvider.js";
import { recordRequestOutcome } from "./selfMonitor.js";
import { llmBreaker, CircuitOpenError } from "./circuitBreaker.js";
import { groundAnswer } from "./grounding.js";
import { createLogger } from "./logger.js";
import { getActiveModel, getApiKey, getApiUrl, getProviderHeaders, resolveProviderOnce, calculateMaxTokens } from "./aiTokens.js";
import { buildSystemPrompt, buildUserPrompt, buildDeepResearchPrompt } from "./aiPrompts.js";
import { canFitResponse } from "./tokenBudgetManager.js";  // v8.5.0: fix missing import
import { assembleContext, recordAssembly, type ContextMessage } from "./tieredContextManager.js";  // v8.7.0: fix 'assembleContext is not defined' on follow-up queries
const log = createLogger("aiStreaming");

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

export async function streamToResponse(
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

  const LARGE_ANALYSIS_TIMEOUT_MS = 180_000;
  const STANDARD_QUERY_TIMEOUT_MS = 90_000;

  // Timeout: 180s for file/deep analysis, 90s for standard queries
  const isLargeAnalysis = messages.some(m =>
    typeof m.content === "string" && (m.content.includes("ZIP Archive:") || m.content.includes("Parallel Search Results"))
  );
  const timeoutMs = isLargeAnalysis ? LARGE_ANALYSIS_TIMEOUT_MS : STANDARD_QUERY_TIMEOUT_MS;
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
          // v8.2.0 FIX: deepseek-reasoner and kimi-k2.6 only accept temperature=1
          temperature: ["deepseek-reasoner", "kimi-k2.6"].includes(getActiveModel()) ? 1 : (options.temperature ?? 0.5),
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

  // v9.18: Non-streaming fallback — some proxies (e.g. Manus sandbox) return
  // {"error":"Streaming is not supported"} with HTTP 200 + application/json instead of SSE.
  // Detect this by peeking at the first chunk; if it looks like JSON, parse as batch.
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    clearTimeout(timeoutId);
    const batchBody = await response.json() as Record<string, unknown>;
    const streamingNotSupported =
      batchBody.error && typeof batchBody.error === "string" &&
      (batchBody.error as string).toLowerCase().includes("streaming");
    if (streamingNotSupported) {
      // Retry as non-streaming batch request
      const batchResp = await fetch(getApiUrl(), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...getProviderHeaders(),
        },
        body: JSON.stringify({
          model: getActiveModel(),
          messages,
          stream: false,
          max_tokens: Math.min(32768, Math.max(1000, options.maxTokens ?? calculateMaxTokens(messages))),
          temperature: ["deepseek-reasoner", "kimi-k2.6"].includes(getActiveModel()) ? 1 : (options.temperature ?? 0.5),
        }),
      });
      if (!batchResp.ok) {
        const errText = await batchResp.text();
        throw new Error(`LLM batch fallback error ${batchResp.status}: ${errText}`);
      }
      const batchData = await batchResp.json() as Record<string, unknown>;
      const batchChoices = batchData.choices as Array<{ message?: { content?: string }; finish_reason?: string }> | undefined;
      const batchContent = batchChoices?.[0]?.message?.content ?? "";
      const batchTruncated = batchChoices?.[0]?.finish_reason === "length";
      if (batchContent && !res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type: "delta", content: batchContent })}\n\n`);
        if (typeof (res as any).flush === "function") (res as any).flush();
      }
      // Reset any previous failures since we got a successful response
      if (llmBreaker.getStats().consecutiveFailures > 0) llmBreaker.reset();
      return { content: batchContent, truncated: batchTruncated };
    }
    // Proxy returned a valid batch response directly (stream: true was ignored)
    const directChoices = (batchBody.choices as Array<{ message?: { content?: string }; finish_reason?: string }> | undefined);
    const directContent = directChoices?.[0]?.message?.content ?? "";
    if (directContent && !res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: "delta", content: directContent })}\n\n`);
      if (typeof (res as any).flush === "function") (res as any).flush();
    }
    if (llmBreaker.getStats().consecutiveFailures > 0) llmBreaker.reset();
    return { content: directContent, truncated: false };
  }

  if (!response.body) {
    clearTimeout(timeoutId);
    throw new Error("Response body is null — streaming not supported by provider");
  }
  const reader = response.body.getReader();

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
  // v8.3.0: Use a lighter conversational system prompt when there are no search sources.
  // The standard prompt instructs the LLM to cite [1][2][3] which is confusing with 0 sources.
  const systemPrompt = sources.length === 0
    ? buildSystemPrompt("chat") + (honestyAddendum ? `\n\n${honestyAddendum}` : "")
    : buildSystemPrompt("standard") + (honestyAddendum ? `\n\n${honestyAddendum}` : "");
  const rawAnswer = await streamToResponse(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: buildUserPrompt(query, sources) },
    ],
    res,
    { temperature: 0.7 }  // v8.3.0: slightly higher temp for conversational warmth
  );

  // Post-process: run grounding check and emit confidence metadata
  const grounding = groundAnswer(rawAnswer, sources);
  if (!res.writableEnded) {
    const chunk = `data: ${JSON.stringify({ type: "grounding", confidence: grounding.confidence > 1 ? grounding.confidence / 100 : grounding.confidence, warnings: grounding.warnings, unverifiedCount: grounding.unverifiedClaimCount })}

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
    res.write(`data: ${JSON.stringify({ type: "grounding", confidence: grounding.confidence > 1 ? grounding.confidence / 100 : grounding.confidence, warnings: grounding.warnings, unverifiedCount: grounding.unverifiedClaimCount })}

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

