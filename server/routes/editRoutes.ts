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
import { getActiveProvider } from "../llmProvider.js";

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
    const activeProvider = getActiveProvider();
    const apiKey = activeProvider.apiKey || process.env.DEEPSEEK_API_KEY || "";
    const modelName = getResolvedModelName(model);
    try {
      const result = await runMultiPassEdit(fileContent, instructions, apiKey, modelName);
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
    const activeProvider = getActiveProvider();
    const apiKey = activeProvider.apiKey || process.env.DEEPSEEK_API_KEY || "";
    const modelName = getResolvedModelName(model);
    try {
      const result = await runMultiPassEditWithAutosubmit(fileContent, instructions, apiKey, modelName, (event) => {
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
    const activeProvider = getActiveProvider();
    const apiKey = activeProvider.apiKey || process.env.DEEPSEEK_API_KEY || "";
    const modelName = getResolvedModelName(model);
    try {
      if (isRawZip === true) {
        await streamMultiPassAnalysis(fileContent, message.trim(), apiKey, modelName, res);
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
