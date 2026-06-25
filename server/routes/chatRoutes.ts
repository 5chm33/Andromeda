/**
 * chatRoutes.ts — Chat, continue, image generation, video generation, and browse endpoints
 *
 * Routes:
 *   POST /api/chat/stream         — Multi-turn streaming chat (with self-mod redirect)
 *   POST /api/continue/stream     — Continue a truncated response
 *   POST /api/image/generate      — AI image generation (HuggingFace FLUX)
 *   POST /api/image/generate/pro  — High-quality image generation (fal.ai FLUX Pro)
 *   POST /api/video/generate      — Text-to-video generation (fal.ai Kling v2.1)
 *   POST /api/video/animate       — Image-to-video animation (fal.ai Kling v2.1)
 *   GET  /api/video/status        — Check if video generation is available
 *   POST /api/browse              — Web page browsing
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { streamChat, streamContinue, generateImageFromPrompt, setModel } from "../ai.js";
import { streamAgentPlan } from "../aiPlanning.js";
import { browseUrl } from "../browser.js";
import { getWorkspaceDir } from "../workspace.js";
import { streamAgentToSSE } from "../reactEngine.js";
import type { ReactEngine } from "../reactEngine.js";

// ── Zod schemas ────────────────────────────────────────────────────────────────

const MODEL_ENUM = z.enum(["deepseek-chat", "deepseek-reasoner", "openrouter", "openrouter-fast", "kimi", "anthropic", "openai", "groq"]);

const chatStreamSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant", "system"]),
    content: z.string(),
  })).min(1),
  model: MODEL_ENUM.optional(),
  systemPrompt: z.string().optional(),
});

// ── Self-modification detection pattern ───────────────────────────────────────
// When a user asks the AI to look at or modify its own code, redirect to the
// ReactEngine (agent loop) which has full tool access and safety guards.
const SELF_MOD_PATTERN = /take a look at your code|look at your code|your source code|your codebase|your engine|your architect|self.?enhanc|self.?improv|self.?modif|self.?aware|self.?diagnos|fully autonomous|SOTA|truncat|upgrade your|fix yourself|improve yourself|examine your|read your code|analyze your/i;

// ── Route registration ─────────────────────────────────────────────────────────

/**
 * Registers chat, image generation, and browsing routes onto the Express app.
 * @param app Express application instance
 * @param streamLimiter Rate limiter for standard requests
 * @param heavyLimiter Rate limiter for expensive requests
 * @param setSseHeaders Helper to set SSE response headers
 * @param sseWrite Helper to write an SSE event
 * @param deps Shared dependency bag (must include activeAgentSessions)
 */
export function registerChatRoutes(
  app: Express,
  streamLimiter: import("express").RequestHandler,
  heavyLimiter: import("express").RequestHandler,
  setSseHeaders: (res: Response) => void,
  sseWrite: (res: Response, data: object) => void,
  deps: Record<string, unknown>,
): void {
  const activeAgentSessions = deps.activeAgentSessions as Map<string, ReactEngine>;

  // ── POST /api/chat/stream ──────────────────────────────────────────────────
  app.post("/api/chat/stream", streamLimiter, async (req: Request, res: Response) => {
    const parsed = chatStreamSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues.map(i => i.message).join("; ") });
      return;
    }
    const { messages, model } = parsed.data;
    if (model) setModel(model);

    // v5.94: Detect self-modification requests and redirect to agent loop
    const lastUserMsg = [...messages].reverse().find(m => m.role === "user")?.content ?? "";
    if (SELF_MOD_PATTERN.test(lastUserMsg)) {
      setSseHeaders(res);
      const workDir = getWorkspaceDir();
      const sid = `react-chat-redirect-${Date.now()}`;
      const engine = streamAgentToSSE(res, lastUserMsg, workDir, { maxSteps: 200, sessionId: sid });
      activeAgentSessions.set(sid, engine);
      return;
    }

    setSseHeaders(res);
    try {
      const fullAnswer = await streamChat(messages, res);
      sseWrite(res, { type: "done", fullAnswer });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Chat failed";
      sseWrite(res, { type: "error", message });
    } finally {
      res.end();
    }
  });

  // ── POST /api/continue/stream ──────────────────────────────────────────────
  app.post("/api/continue/stream", streamLimiter, async (req: Request, res: Response) => {
    const { messages, model } = req.body as {
      messages: Array<{ role: string; content: string }>;
      model?: string;
    };
    if (!messages?.length) {
      res.status(400).json({ error: "messages array is required" });
      return;
    }
    if (model) setModel(model);
    setSseHeaders(res);
    try {
      const fullAnswer = await streamContinue(messages, res);
      sseWrite(res, { type: "done", fullAnswer });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Continue failed";
      sseWrite(res, { type: "error", message });
    } finally {
      res.end();
    }
  });

  // ── POST /api/image/generate ───────────────────────────────────────────────
  // v12.3.2: Auto-routes to fal.ai FLUX Pro when FAL_KEY is set (higher quality).
  // Falls back to HuggingFace FLUX.1-schnell (free) when FAL_KEY is absent.
  app.post("/api/image/generate", heavyLimiter, async (req: Request, res: Response) => {
    const { prompt, model, referenceImageB64, referenceMimeType } = req.body as {
      prompt: string;
      model?: string;
      referenceImageB64?: string;
      referenceMimeType?: string;
    };
    if (!prompt?.trim()) {
      res.status(400).json({ error: "prompt is required" });
      return;
    }
    try {
      // Use fal.ai FLUX Pro when FAL_KEY is available (better quality, no watermark)
      if (process.env.FAL_KEY) {
        const { generateImageFal, isFalAvailable } = await import("../_core/videoGeneration.js");
        if (isFalAvailable()) {
          const result = await generateImageFal({
            prompt: prompt.trim(),
            width: 1024,
            height: 1024,
            useUltra: false, // FLUX Pro (not Ultra) for standard requests — faster & cheaper
          });
          res.json({ url: result.imageUrl, enhancedPrompt: prompt.trim(), usedReference: false, provider: "fal.ai" });
          return;
        }
      }
      // Fallback: HuggingFace FLUX.1-schnell (free)
      const result = await generateImageFromPrompt(prompt.trim(), model, referenceImageB64, referenceMimeType);
      res.json({ url: result.url, enhancedPrompt: result.enhancedPrompt, usedReference: result.usedReference ?? false, provider: "huggingface" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Image generation failed";
      res.status(500).json({ error: message });
    }
  });

  // ── POST /api/image/generate/pro ─────────────────────────────────────────────
  // Higher quality image generation via fal.ai FLUX Pro (requires FAL_KEY)
  app.post("/api/image/generate/pro", heavyLimiter, async (req: Request, res: Response) => {
    const { prompt, negativePrompt, width, height, useUltra } = req.body as {
      prompt: string;
      negativePrompt?: string;
      width?: number;
      height?: number;
      useUltra?: boolean;
    };
    if (!prompt?.trim()) {
      res.status(400).json({ error: "prompt is required" });
      return;
    }
    try {
      const { generateImageFal, isFalAvailable } = await import("../_core/videoGeneration.js");
      if (!isFalAvailable()) {
        res.status(503).json({ error: "FAL_KEY not configured. Add FAL_KEY to .env.local" });
        return;
      }
      const result = await generateImageFal({
        prompt: prompt.trim(),
        negativePrompt,
        width: width ?? 1024,
        height: height ?? 1024,
        useUltra: useUltra ?? true,
      });
      res.json({ url: result.imageUrl, width: result.width, height: result.height, model: result.model, seed: result.seed });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Pro image generation failed";
      res.status(500).json({ error: message });
    }
  });

  // ── GET /api/video/status ──────────────────────────────────────────────────
  app.get("/api/video/status", (_req: Request, res: Response) => {
    const configured = !!process.env.FAL_KEY;
    res.json({
      available: configured,
      provider: "fal.ai",
      models: [
        { id: "kling-video/v2.1/master", type: "text-to-video", durations: ["5s", "10s"] },
        { id: "kling-video/v2.1/master", type: "image-to-video", durations: ["5s", "10s"] },
        { id: "flux-pro/v1.1-ultra", type: "text-to-image", quality: "ultra" },
      ],
      configured,
    });
  });

  // ── POST /api/video/generate ───────────────────────────────────────────────
  // Text-to-video using Kling v2.1 Master (SOTA quality, 5s or 10s clips)
  app.post("/api/video/generate", heavyLimiter, async (req: Request, res: Response) => {
    const { prompt, negativePrompt, duration, aspectRatio, cameraMovement } = req.body as {
      prompt: string;
      negativePrompt?: string;
      duration?: "5" | "10";
      aspectRatio?: "16:9" | "9:16" | "1:1";
      cameraMovement?: string;
    };
    if (!prompt?.trim()) {
      res.status(400).json({ error: "prompt is required" });
      return;
    }
    try {
      const { generateVideoFromText, isFalAvailable } = await import("../_core/videoGeneration.js");
      if (!isFalAvailable()) {
        res.status(503).json({ error: "FAL_KEY not configured. Add FAL_KEY to .env.local" });
        return;
      }
      const result = await generateVideoFromText({
        prompt: prompt.trim(),
        negativePrompt,
        duration: duration ?? "5",
        aspectRatio: aspectRatio ?? "16:9",
        cameraMovement,
      });
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Video generation failed";
      res.status(500).json({ error: message });
    }
  });

  // ── POST /api/video/animate ────────────────────────────────────────────────
  // Image-to-video: animate a still image using Kling v2.1 Master
  app.post("/api/video/animate", heavyLimiter, async (req: Request, res: Response) => {
    const { prompt, imageUrl, duration, aspectRatio, tailImageUrl } = req.body as {
      prompt: string;
      imageUrl: string;
      duration?: "5" | "10";
      aspectRatio?: "16:9" | "9:16" | "1:1";
      tailImageUrl?: string;
    };
    if (!prompt?.trim()) {
      res.status(400).json({ error: "prompt is required" });
      return;
    }
    if (!imageUrl?.trim()) {
      res.status(400).json({ error: "imageUrl is required" });
      return;
    }
    try {
      const { generateVideoFromImage, isFalAvailable } = await import("../_core/videoGeneration.js");
      if (!isFalAvailable()) {
        res.status(503).json({ error: "FAL_KEY not configured. Add FAL_KEY to .env.local" });
        return;
      }
      const result = await generateVideoFromImage({
        prompt: prompt.trim(),
        imageUrl: imageUrl.trim(),
        duration: duration ?? "5",
        aspectRatio: aspectRatio ?? "16:9",
      });
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Image-to-video generation failed";
      res.status(500).json({ error: message });
    }
  });

  // ── POST /api/browse ───────────────────────────────────────────────────────
  app.post("/api/browse", streamLimiter, async (req: Request, res: Response) => {
    const { url } = req.body as { url: string };
    if (!url?.trim()) {
      res.status(400).json({ error: "url is required" });
      return;
    }
    try {
      const result = await browseUrl(url.trim());
      if (result.error) { res.status(422).json({ error: result.error }); return; }
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Browse failed";
      res.status(500).json({ error: message });
    }
  });

  // ── POST /api/agent/plan ───────────────────────────────────────────────────
  app.post("/api/agent/plan", heavyLimiter, async (req: Request, res: Response) => {
    const { query, model } = req.body as { query: string; model?: string };
    if (model) setModel(model);
    if (!query?.trim()) { res.status(400).json({ error: "query is required" }); return; }
    setSseHeaders(res);
    try {
      await streamAgentPlan(query.trim(), res);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Agent plan failed";
      sseWrite(res, { type: "error", message });
    } finally {
      res.end();
    }
  });
}
