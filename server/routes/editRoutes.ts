/**
 * editRoutes.ts — File editing and analysis endpoints (extracted from streamRouter.ts v9.12.0)
 *
 * Routes:
 *   POST /api/edit/zip         — Multi-pass ZIP edit (sync)
 *   POST /api/edit/zip/stream  — Multi-pass ZIP edit with SSE progress
 *   POST /api/analyze/stream   — File analysis stream (single file or ZIP)
 *   POST /api/code/execute     — Code execution (sandbox)
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { streamFileAnalysis, setModel } from "../ai.js";
import { executeCode } from "../codeRunner.js";
import { runMultiPassEdit, streamMultiPassAnalysis, runMultiPassEditWithAutosubmit, createBudget } from "../fileEngine.js";
import { getActiveProvider, getProviderApiKey } from "../llmProvider.js";

// ── Zod schemas ────────────────────────────────────────────────────────────────

const codeSchema = z.object({
  code: z.string().min(1).max(100_000),
  language: z.enum(["javascript", "typescript", "python", "bash", "shell"]).default("javascript"),
});

// ── Helper ─────────────────────────────────────────────────────────────────────

function getResolvedModelName(frontendModel?: string): string {
  const active = getActiveProvider();
  const providerIds = ["deepseek-chat", "deepseek-reasoner", "openrouter", "openrouter-fast", "kimi", "anthropic", "openai", "groq"];
  if (!frontendModel || providerIds.includes(frontendModel)) {
    return active.model || "deepseek/deepseek-chat";
  }
  return frontendModel;
}

/**
 * v10.2: Smart large-context provider selection.
 * When a large payload is detected (zip files, large codebases), automatically
 * switch to the best available large-context provider:
 *   1. OpenRouter Gemini 2.5 Flash (1M context, fast) — if OPENROUTER_API_KEY is set
 *   2. Kimi k2.6 (1M context, reasoning) — if KIMI_API_KEY is set
 *   3. Claude Sonnet (200K context) — if ANTHROPIC_API_KEY is set
 *   4. Gemini 2.5 Pro (1M context) — if GOOGLE_API_KEY is set
 *   5. Current provider — fallback (may truncate large inputs)
 *
 * @param payloadBase64 Base64-encoded payload (zip or file content)
 * @returns { apiKey, modelName } to use for this request
 */
function selectLargeContextProvider(payloadBase64: string): { apiKey: string; modelName: string } {
  // Estimate token count: base64 chars / 4 bytes * ~0.75 tokens/byte ≈ chars * 0.19
  const estimatedTokens = Math.round(payloadBase64.length * 0.19);
  const LARGE_THRESHOLD = 50_000; // 50K tokens — use large-context model

  if (estimatedTokens < LARGE_THRESHOLD) {
    // Small payload — use whatever is active
    const active = getActiveProvider();
    return { apiKey: active.apiKey || process.env.DEEPSEEK_API_KEY || "", modelName: active.model || "deepseek/deepseek-chat" };
  }

  // Large payload — find best available large-context provider
  // Prefer OpenRouter (Gemini Flash): 1M context + fast response time
  const openrouterKey = getProviderApiKey("openrouter") || getProviderApiKey("openrouter-fast") || process.env.OPENROUTER_API_KEY || "";
  if (openrouterKey) {
    const orModel = process.env.OPENROUTER_MODEL || "google/gemini-2.5-flash";
    return { apiKey: openrouterKey, modelName: orModel };
  }

  const kimiKey = getProviderApiKey("kimi");
  if (kimiKey) {
    return { apiKey: kimiKey, modelName: "kimi-k2.6" };
  }

  const anthropicKey = getProviderApiKey("anthropic-direct") || getProviderApiKey("anthropic");
  if (anthropicKey) {
    return { apiKey: anthropicKey, modelName: "claude-3-5-sonnet-20241022" };
  }

  const googleKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || "";
  if (googleKey) {
    return { apiKey: googleKey, modelName: "gemini-2.5-pro" };
  }

  // No large-context provider available — warn and use current provider
  console.warn(`[editRoutes] Large payload (~${Math.round(estimatedTokens / 1000)}K tokens) but no large-context provider configured. Set OPENROUTER_API_KEY, KIMI_API_KEY, or ANTHROPIC_API_KEY for best results.`);
  const active = getActiveProvider();
  return { apiKey: active.apiKey || process.env.DEEPSEEK_API_KEY || "", modelName: active.model || "deepseek/deepseek-chat" };
}

// ── Route registration ─────────────────────────────────────────────────────────

/**
 * Registers file editing, analysis, and code execution routes onto the Express app.
 * @param app Express application instance
 * @param streamLimiter Rate limiter for standard requests
 * @param heavyLimiter Rate limiter for expensive requests
 * @param setSseHeaders Helper to set SSE response headers
 * @param sseWrite Helper to write an SSE event
 */
export function registerEditRoutes(
  app: Express,
  streamLimiter: import("express").RequestHandler,
  heavyLimiter: import("express").RequestHandler,
  setSseHeaders: (res: Response) => void,
  sseWrite: (res: Response, data: object) => void,
): void {

  // ── POST /api/edit/zip ─────────────────────────────────────────────────────
  app.post("/api/edit/zip", heavyLimiter, async (req: Request, res: Response) => {
    const { fileContent, instructions, model } = req.body as {
      fileContent: string;
      fileName: string;
      instructions: string;
      model?: string;
    };
    if (!fileContent || !instructions?.trim()) {
      res.status(400).json({ error: "fileContent and instructions are required" });
      return;
    }
    if (model) setModel(model);
    // v10.2: Auto-select large-context provider for large zip payloads
    const { apiKey, modelName } = selectLargeContextProvider(fileContent);
    const resolvedModel = model ? getResolvedModelName(model) : modelName;
    try {
      const result = await runMultiPassEdit(fileContent, instructions, apiKey, resolvedModel);
      res.json({ success: true, editedContent: result.editedZip, summary: result.summary, editsApplied: result.editsApplied, log: result.log });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Edit failed";
      res.status(500).json({ error: message });
    }
  });

  // ── POST /api/edit/zip/stream ──────────────────────────────────────────────
  app.post("/api/edit/zip/stream", heavyLimiter, async (req: Request, res: Response) => {
    const { fileContent, instructions, model } = req.body as {
      fileContent: string;
      fileName: string;
      instructions: string;
      model?: string;
    };
    if (!fileContent || !instructions?.trim()) {
      res.status(400).json({ error: "fileContent and instructions are required" });
      return;
    }
    if (model) setModel(model);
    setSseHeaders(res);
    // v10.2: Auto-select large-context provider for large zip payloads
    const { apiKey: editApiKey, modelName: editModelName } = selectLargeContextProvider(fileContent);
    const resolvedEditModel = model ? getResolvedModelName(model) : editModelName;
    try {
      const result = await runMultiPassEditWithAutosubmit(fileContent, instructions, editApiKey, resolvedEditModel, (event) => {
        sseWrite(res, event);
      }, createBudget());
      sseWrite(res, {
        type: "done",
        success: result.success,
        partial: result.partial,
        editedContent: result.editedZip,
        summary: result.summary,
        editsApplied: result.editsApplied,
        editsAttempted: result.editsAttempted,
        log: result.log,
        exitReason: result.exitReason,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Edit failed";
      sseWrite(res, { type: "error", message });
    } finally {
      res.end();
    }
  });

  // ── POST /api/analyze/stream ───────────────────────────────────────────────
  app.post("/api/analyze/stream", streamLimiter, async (req: Request, res: Response) => {
    const { message, fileContent, fileName, mimeType, model, isRawZip } = req.body as {
      message: string;
      fileContent: string;
      fileName?: string;
      mimeType?: string;
      model?: string;
      isRawZip?: boolean;
    };
    if (model) setModel(model);
    if (!message?.trim() || !fileContent) {
      res.status(400).json({ error: "Message and file content are required" });
      return;
    }
    setSseHeaders(res);
    // v10.2: Auto-select large-context provider for large zip payloads
    const { apiKey: analyzeApiKey, modelName: analyzeModelName } = selectLargeContextProvider(fileContent);
    const resolvedAnalyzeModel = model ? getResolvedModelName(model) : analyzeModelName;
    try {
      if (isRawZip === true) {
        await streamMultiPassAnalysis(fileContent, message.trim(), analyzeApiKey, resolvedAnalyzeModel, res);
      } else {
        const isCode = /\.(xml|json|yaml|yml|js|ts|py|html|css|sh|sql|md|txt|csv)$/i.test(fileName || "");
        const lang = fileName?.split(".").pop()?.toLowerCase() ?? "";
        let fileContext: string;
        if (mimeType?.startsWith("image/")) {
          fileContext = `[Image file: ${fileName || "image"}]\nNote: Image content has been provided.`;
        } else if (isCode) {
          fileContext = `File: ${fileName || "unknown"}\n\`\`\`${lang}\n${fileContent}\n\`\`\``;
        } else {
          fileContext = `File: ${fileName || "document"}\n\nContent:\n${fileContent}`;
        }
        const fullAnswer = await streamFileAnalysis(message.trim(), fileContext, res);
        sseWrite(res, { type: "done", fullAnswer });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Analysis failed";
      sseWrite(res, { type: "error", message: errMsg });
    } finally {
      res.end();
    }
  });

  // ── POST /api/code/execute ─────────────────────────────────────────────────
  app.post("/api/code/execute", streamLimiter, async (req: Request, res: Response) => {
    const codeParsed = codeSchema.safeParse(req.body);
    if (!codeParsed.success) {
      res.status(400).json({ error: codeParsed.error.issues.map(i => i.message).join("; ") });
      return;
    }
    const { code, language } = codeParsed.data;
    try {
      const result = await executeCode(code.trim(), language);
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Execution failed";
      res.status(500).json({ error: message });
    }
  });
}
