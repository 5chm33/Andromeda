import { editFilesInZip } from "./aiPlanning.js";
import type { Express } from "express";
import { getContextWindow } from "./modelRegistry";
import { existsSync } from "fs";
import { join, resolve as pathResolve, basename } from "path";
import { stat as fsStat, readdir, readFile as fsReadFile } from "fs/promises";
import { streamAIResponse, streamAIResponseWithContext, streamDeepResearch, streamFileAnalysis, generateSubQueries, setModel, streamChat, streamContinue, generateImageFromPrompt, streamAgentPlan } from "./ai";
import { browseUrl } from "./browser";
import { executeCodeWithWorkspace, listWorkspaceFiles, readWorkspaceFile, writeWorkspaceFile, deleteWorkspaceFile, getWorkspaceDir } from "./workspace";
import { aggregateSearch, deepResearchSearch } from "./search";
import { executeCode } from "./codeRunner";
import { resolveDependencies, readPackageJson, diagnoseError, searchWorkspaceCode, generateUnifiedDiff } from "./codeIntel";
import { annotateSources, analyzeDiversity, detectCensorshipSignals, buildHonestyPromptAddendum } from "./biasDetector";
import { runMultiPassEdit, streamMultiPassAnalysis, runMultiPassEditWithAutosubmit, createBudget } from "./fileEngine";
import { runTeamAgent } from "./multiAgent";
import { getMemoryStats } from "./memory";
import { listProposals } from "./selfImprove";
import { getActiveProvider, setActiveProvider, listProviders } from "./llmProvider";
import { streamAgentToSSE, ReactEngine } from "./reactEngine";

// v5.36: Session map for human-in-the-loop — maps sessionId to active ReactEngine
const activeAgentSessions = new Map<string, ReactEngine>();
// Cleanup old sessions every 5 minutes
setInterval(() => {
  for (const [id, engine] of Array.from(activeAgentSessions.entries())) {
    const st = engine.getState(); if (st === "completed" || st === "interrupted") activeAgentSessions.delete(id);
  }
}, 5 * 60_000);
import { getToolDefinitions, getAllTools } from "./tools";
import { addServerConfig, removeServerConfig, getServerConfigs, getConnectionStatus, connectServer, disconnectServer, connectAllEnabled } from "./mcpClient";
import type { MCPServerConfig } from "./mcpClient";
import { runOrchestration, getDefaultAgents, getAgentRoles } from "./agentOrchestrator";
import type { SearchSource } from "../drizzle/schema";
import rateLimit from "express-rate-limit";
import { z } from "zod";

import { registerMemoryRoutes } from "./routes/memoryRoutes.js";
import { registerSelfRoutes } from "./routes/selfRoutes.js";
import { registerAgentRoutes } from "./routes/agentRoutes.js";
import { registerLLMRoutes } from "./routes/llmRoutes.js";
import { registerAutonomyRoutes } from "./routes/autonomyRoutes.js";
import { registerSystemRoutes } from "./routes/systemRoutes.js";

// v6.15.5: Normalize model name - always use the active provider's full model ID
// This prevents short names like "deepseek-chat" from being sent to DeepSeek API
function getResolvedModelName(frontendModel?: string): string {
  const active = getActiveProvider();
  // If frontend sent a provider-id style string (not a real model), use active provider model
  const providerIds = ["deepseek-chat", "deepseek-reasoner", "openrouter", "openrouter-fast", "kimi", "anthropic", "openai", "groq"];
  if (!frontendModel || providerIds.includes(frontendModel)) {
    return active.model || "deepseek/deepseek-chat";
  }
  return frontendModel;
}

// ─── Zod schemas for input validation ─────────────────────────────────────────
const searchStreamSchema = z.object({
  query: z.string().min(1, "Query is required").max(2000),
  filter: z.enum(["all", "web", "news", "academic"]).default("all"),
  sources: z.array(z.any()).optional(),
  model: z.enum(["deepseek-chat", "deepseek-reasoner", "openrouter", "openrouter-fast", "kimi", "anthropic", "openai", "groq"]).optional(),  // v6.15: expanded
  context: z.array(z.object({ query: z.string(), answer: z.string() })).optional(),
});

const chatStreamSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant", "system"]),
    content: z.string(),
  })).min(1),
  model: z.enum(["deepseek-chat", "deepseek-reasoner", "openrouter", "openrouter-fast", "kimi", "anthropic", "openai", "groq"]).optional(),  // v6.15: expanded
  systemPrompt: z.string().optional(),
});

const _browseSchema = z.object({
  url: z.string().url("Invalid URL format").max(4096),
});

const codeSchema = z.object({
  code: z.string().min(1).max(100_000),
  language: z.enum(["javascript", "typescript", "python", "bash", "shell"]).default("javascript"),
});

const _fileAnalysisSchema = z.object({
  content: z.string().min(1),
  filename: z.string().min(1).max(500),
  query: z.string().max(2000).optional(),
});

const deepResearchSchema = z.object({
  query: z.string().min(1).max(2000),
  model: z.enum(["deepseek-chat", "deepseek-reasoner", "openrouter", "openrouter-fast", "kimi", "anthropic", "openai", "groq"]).optional(),  // v6.15: expanded
});

// v5.11: SSE event union type for type safety across all stream endpoints
type SSEEvent =
  | { type: "delta"; content: string }
  | { type: "done"; fullAnswer?: string; answer?: string; sources?: SearchSource[] }
  | { type: "error"; message: string }
  | { type: "sources"; sources: SearchSource[]; biasAnnotations?: any[]; diversityReport?: any; censorshipSignal?: any }
  | { type: "progress"; step: string; message: string; queries?: string[]; sources?: SearchSource[] }
  | { type: "grounding"; confidence: number; warnings: string[]; unverifiedCount: number }
  | { type: "truncated" }
  | { type: "step_start"; stepIndex: number; step: any }
  | { type: "step_result"; stepIndex: number; result: string }
  | { type: "step_error"; stepIndex: number; message: string }
  | { type: "plan"; steps: any[] }
  | { type: "image"; url: string; prompt: string };

// v5.11: Helper to get real client IP behind proxies (x-forwarded-for support)
function getClientIp(req: any): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    const ips = (typeof forwarded === "string" ? forwarded : forwarded[0]).split(",");
    return ips[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || "unknown";
}

// Rate limiters — protect AI endpoints from accidental loops and abuse
// Both limiters skip localhost so local development is never throttled
const streamLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 1000,           // v5.43: CEO edition - effectively unlimited
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests — please wait a moment before trying again." },
  // v5.11: Check both direct IP and x-forwarded-for for proxy-aware localhost skip
  skip: (req) => {
    const ip = getClientIp(req);
    return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
  },
  keyGenerator: (req) => getClientIp(req),
});

const heavyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,            // v5.43: CEO edition - generous limit for heavy ops
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many heavy requests — please wait a moment before trying again." },
  skip: (req) => {
    const ip = getClientIp(req);
    return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
  },
  keyGenerator: (req) => getClientIp(req),
});

function setSseHeaders(res: any) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
}

function sseWrite(res: any, data: object) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
  if (typeof res.flush === "function") res.flush();
}

export function registerStreamRoutes(app: Express) {
  // ─── Standard search stream ──────────────────────────────────────────────
  // v6.02: Shared dependencies for extracted route modules
  const deps: Record<string, any> = { activeAgentSessions, getClientIp };

  app.post("/api/search/stream", streamLimiter, async (req, res) => {
    // v5.9: Zod validation on all inputs
    const parsed = searchStreamSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
      return;
    }
    const { query, filter, sources: clientSources, model, context } = parsed.data;
    if (model) setModel(model);

    setSseHeaders(res);

    try {
      const sources: SearchSource[] =
        clientSources && clientSources.length > 0
          ? clientSources
          : await aggregateSearch(query.trim(), filter);

      // v5.0: Annotate sources with bias profiles and run diversity analysis
      const annotated = annotateSources(sources);
      const diversityReport = analyzeDiversity(annotated);
      const censorshipSignal = detectCensorshipSignals(query.trim(), annotated);
      const honestyAddendum = buildHonestyPromptAddendum(diversityReport, censorshipSignal);

      // Emit bias metadata to the frontend
      sseWrite(res, {
        type: "sources",
        sources,
        biasAnnotations: annotated.map(s => ({
          url: (s as any).url ?? "",
          biasProfile: s.biasProfile ?? null,
          sensationalismScore: s.sensationalismScore ?? 0,
          dehumanizingWarning: s.dehumanizingWarning ?? null,
        })),
        diversityReport,
        censorshipSignal,
      });

      // Use context-aware streaming when prior turns are provided
      const fullAnswer = context && context.length > 0
        ? await streamAIResponseWithContext(query.trim(), sources, context, res, honestyAddendum)
        : await streamAIResponse(query.trim(), sources, res, honestyAddendum);

      sseWrite(res, { type: "done", fullAnswer });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Search failed";
      sseWrite(res, { type: "error", message });
    } finally {
      res.end();
    }
  });

  // ─── Deep Research stream ────────────────────────────────────────────────
  app.post("/api/search/deep", heavyLimiter, async (req, res) => {
    // v5.11: Zod validation on deep search inputs
    const parsed = deepResearchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
      return;
    }
    const { query, model } = parsed.data;
    if (model) setModel(model);

    setSseHeaders(res);

    try {
      sseWrite(res, { type: "progress", step: "planning", message: "Planning research strategy…" });
      const subQueries = await generateSubQueries(query.trim());

      sseWrite(res, { type: "progress", step: "queries", queries: subQueries, message: `Running ${subQueries.length} parallel searches…` });

      const searchResults = await deepResearchSearch(subQueries);

      const allSources: SearchSource[] = [];
      const seenUrls = new Set<string>();
      for (const result of searchResults) {
        for (const source of result.sources) {
          if (!seenUrls.has(source.url)) {
            seenUrls.add(source.url);
            allSources.push(source);
          }
        }
      }

      sseWrite(res, {
        type: "progress",
        step: "sources",
        sources: allSources,
        message: `Found ${allSources.length} sources across ${searchResults.length} searches. Synthesizing…`,
      });

      const fullAnswer = await streamDeepResearch(query.trim(), searchResults, res);

      sseWrite(res, { type: "done", fullAnswer, sources: allSources });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Deep research failed";
      sseWrite(res, { type: "error", message });
    } finally {
      res.end();
    }
  });

  // ─── File editing endpoint ──────────────────────────────────────────────
  // ─── Multi-Pass ZIP Edit (v5.12) ─────────────────────────────────────────
  // Replaces the old naive editFilesInZip with the new multi-pass engine
  app.post("/api/edit/zip", heavyLimiter, async (req, res) => {
    const { fileContent, fileName: _fileName, instructions, model } = req.body as {
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

    // v6.15: Use active provider (OpenRouter/DeepSeek/etc) instead of hardcoded DEEPSEEK_API_KEY
    const _activeProvider = getActiveProvider();
    const apiKey = _activeProvider.apiKey || process.env.DEEPSEEK_API_KEY || "";
    const modelName = getResolvedModelName(model);

    try {
      const result = await runMultiPassEdit(fileContent, instructions, apiKey, modelName);
      res.json({
        success: true,
        editedContent: result.editedZip,
        summary: result.summary,
        editsApplied: result.editsApplied,
        log: result.log,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Edit failed";
      res.status(500).json({ error: message });
    }
  });

  // ─── Multi-Pass ZIP Edit with SSE progress (v5.12) ──────────────────────
  app.post("/api/edit/zip/stream", heavyLimiter, async (req, res) => {
    const { fileContent, fileName: _fileName, instructions, model } = req.body as {
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
    // v6.15: Use active provider (OpenRouter/DeepSeek/etc) instead of hardcoded DEEPSEEK_API_KEY
    const _activeProvider = getActiveProvider();
    const apiKey = _activeProvider.apiKey || process.env.DEEPSEEK_API_KEY || "";
    const modelName = getResolvedModelName(model);

    try {
      // v5.12: Use autosubmit pattern — always return partial work on failure
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

  // ─── Code execution ──────────────────────────────────────────────────────
  app.post("/api/code/execute", streamLimiter, async (req, res) => {
    // v5.34: Zod validation
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

  // ─── File analysis stream (v5.13: Multi-Pass with raw ZIP support) ─────
  app.post("/api/analyze/stream", streamLimiter, async (req, res) => {
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
    // v6.15: Use active provider (OpenRouter/DeepSeek/etc) instead of hardcoded DEEPSEEK_API_KEY
    const _activeProvider = getActiveProvider();
    const apiKey = _activeProvider.apiKey || process.env.DEEPSEEK_API_KEY || "";
    const modelName = getResolvedModelName(model);

    try {
      // v5.19 fix: Only use multi-pass ZIP analysis when isRawZip is EXPLICITLY true
      // (prevents trying to base64-decode text summaries when rawBase64 was unavailable on client)
      const isZipWithRawData = isRawZip === true;

      if (isZipWithRawData) {
        // ─── v5.13: Multi-Pass Analysis for ZIP archives ────────────────────
        // When isRawZip=true, fileContent is the raw base64 ZIP data
        // The fileEngine extracts files at full resolution — no frontend truncation
        await streamMultiPassAnalysis(fileContent, message.trim(), apiKey, modelName, res);
      } else {
        // ─── Single-file analysis (unchanged) ─────────────────────────────
        const isCode = /\.(xml|json|yaml|yml|js|ts|py|html|css|sh|sql|md|txt|csv)$/i.test(fileName || "");
        const lang = fileName?.split(".").pop()?.toLowerCase() ?? "";

        let fileContext: string;
        if (mimeType?.startsWith("image/")) {
          fileContext = `[Image file: ${fileName || "image"}]\nNote: Image content has been provided. Analyze based on the user's description and any metadata available.`;
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

  // ─── Chat stream (multi-turn conversation) ───────────────────────────────
  // v5.94: Self-modification requests are automatically redirected to the agent loop
  // so that the ReactEngine (with pre-load, guards, and tool access) handles them.
  // This fixes the core issue where "Auto" mode used DeepSeek chat directly.
  const SELF_MOD_PATTERN = /take a look at your code|look at your code|your source code|your codebase|your engine|your architect|self.?enhanc|self.?improv|self.?modif|self.?aware|self.?diagnos|fully autonomous|SOTA|truncat|upgrade your|fix yourself|improve yourself|examine your|read your code|analyze your/i;

  app.post("/api/chat/stream", streamLimiter, async (req, res) => {
    // v5.34: Zod validation
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
      // Redirect to agent loop — streamAgentToSSE handles the full response lifecycle
      // including res.end(). Do NOT add a checkDone interval — it races with the engine.
      setSseHeaders(res);
      const workDir = getWorkspaceDir();
      const sid = `react-chat-redirect-${Date.now()}`;
      const engine = streamAgentToSSE(res, lastUserMsg, workDir, { maxSteps: 200, sessionId: sid });
      activeAgentSessions.set(sid, engine);
      // Session cleanup is handled by the 5-min interval above via engine.getState()
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

  // ─── Continue truncated response ────────────────────────────────────────
  // v5.4: Allows the frontend to continue a response that was cut off at max_tokens
  app.post("/api/continue/stream", streamLimiter, async (req, res) => {
    const { messages, model } = req.body as {
      // Full conversation so far: system + user + assistant (truncated) + any prior turns
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

  // ─── Image generation ────────────────────────────────────────────────────
  // v5.0: Accepts optional referenceImageB64 (base64 data URL) for reference-guided generation
  app.post("/api/image/generate", heavyLimiter, async (req, res) => {
    const { prompt, model, referenceImageB64, referenceMimeType } = req.body as {
      prompt: string;
      model?: string;
      referenceImageB64?: string;   // base64 data URL of the reference image
      referenceMimeType?: string;   // e.g. "image/png"
    };
    if (!prompt?.trim()) {
      res.status(400).json({ error: "prompt is required" });
      return;
    }
    try {
      const result = await generateImageFromPrompt(
        prompt.trim(),
        model,
        referenceImageB64,
        referenceMimeType
      );
      res.json({
        url: result.url,
        enhancedPrompt: result.enhancedPrompt,
        usedReference: result.usedReference ?? false,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Image generation failed";
      res.status(500).json({ error: message });
    }
  });

  // ─── Web Browse ─────────────────────────────────────────────────────────
  app.post("/api/browse", streamLimiter, async (req, res) => {
    const { url } = req.body as { url: string };
    if (!url?.trim()) {
      res.status(400).json({ error: "url is required" });
      return;
    }
    try {
      const result = await browseUrl(url.trim());
      if (result.error) {
        res.status(422).json({ error: result.error });
        return;
      }
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Browse failed";
      res.status(500).json({ error: message });
    }
  });

  // ─── Workspace file operations ───────────────────────────────────────────
  app.get("/api/workspace/files", streamLimiter, async (_req, res) => {
    try {
      const files = await listWorkspaceFiles();
      res.json({ files, workspaceDir: getWorkspaceDir() });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to list workspace";
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/workspace/file", streamLimiter, async (req, res) => {
    const { name } = req.query as { name: string };
    if (!name?.trim()) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    try {
      const content = await readWorkspaceFile(name.trim());
      res.json({ name, content });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to read file";
      res.status(404).json({ error: message });
    }
  });

  app.post("/api/code/execute-workspace", streamLimiter, async (req, res) => {
    const { code, language } = req.body as { code: string; language?: string };
    if (!code?.trim()) {
      res.status(400).json({ error: "No code provided" });
      return;
    }
    try {
      const result = await executeCodeWithWorkspace(code.trim(), language);
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Execution failed";
      res.status(500).json({ error: message });
    }
  });

  // ─── Agent Plan (dynamic multi-step planning + execution) ────────────────
  app.post("/api/agent/plan", heavyLimiter, async (req, res) => {
    const { query, model } = req.body as { query: string; model?: string };
    if (model) setModel(model);
    if (!query?.trim()) {
      res.status(400).json({ error: "query is required" });
      return;
    }
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

  // ─── v4.8: Dependency Resolver (grounded — reads real package.json) ──────
  app.post("/api/deps/resolve", streamLimiter, async (req, res) => {
    const { packages, projectRoot } = req.body as { packages?: string[]; projectRoot?: string };
    try {
      // If no packages specified, resolve all from package.json
      let pkgNames = packages;
      if (!pkgNames || pkgNames.length === 0) {
        const pkg = readPackageJson(projectRoot);
        pkgNames = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
      }
      const results = await resolveDependencies(pkgNames, projectRoot);
      res.json({ dependencies: results });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Dependency resolution failed";
      res.status(500).json({ error: message });
    }
  });

  // ─── v4.8: Package.json reader (raw, grounded) ───────────────────────────
  app.get("/api/deps/package-json", streamLimiter, async (req, res) => {
    const { root } = req.query as { root?: string };
    try {
      const pkg = readPackageJson(root);
      res.json(pkg);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not read package.json";
      res.status(404).json({ error: message });
    }
  });

  // ─── v4.8: Error Explainer ────────────────────────────────────────────────
  app.post("/api/code/explain-error", streamLimiter, async (req, res) => {
    const { error: rawError } = req.body as { error: string };
    if (!rawError?.trim()) {
      res.status(400).json({ error: "error text is required" });
      return;
    }
    try {
      const diagnosis = diagnoseError(rawError.trim());
      res.json({ diagnosis });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error analysis failed";
      res.status(500).json({ error: message });
    }
  });

  // ─── v4.8: Workspace Code Search ─────────────────────────────────────────
  app.post("/api/workspace/search", streamLimiter, async (req, res) => {
    const { pattern, caseSensitive, maxResults } = req.body as {
      pattern: string;
      caseSensitive?: boolean;
      maxResults?: number;
    };
    if (!pattern?.trim()) {
      res.status(400).json({ error: "pattern is required" });
      return;
    }
    try {
      const results = searchWorkspaceCode(pattern.trim(), { caseSensitive, maxResults });
      res.json({ results, count: results.length });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Code search failed";
      res.status(500).json({ error: message });
    }
  });

  // ─── v4.8: Diff Generator ─────────────────────────────────────────────────
  app.post("/api/code/diff", streamLimiter, async (req, res) => {
    const { original, modified, fileName } = req.body as {
      original: string;
      modified: string;
      fileName?: string;
    };
    if (original === undefined || modified === undefined) {
      res.status(400).json({ error: "original and modified are required" });
      return;
    }
    try {
      const diff = generateUnifiedDiff(original, modified, fileName);
      res.json({ diff });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Diff generation failed";
      res.status(500).json({ error: message });
    }
  });

  // ─── v4.8: Workspace file write ───────────────────────────────────────────
  app.post("/api/workspace/file", streamLimiter, async (req, res) => {
    const { name, content } = req.body as { name: string; content: string };
    if (!name?.trim() || content === undefined) {
      res.status(400).json({ error: "name and content are required" });
      return;
    }
    try {
      await writeWorkspaceFile(name.trim(), content);
      res.json({ success: true, name: name.trim() });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Write failed";
      res.status(500).json({ error: message });
    }
  });

  // ─── v4.8: Workspace file delete ─────────────────────────────────────────
  app.delete("/api/workspace/file", streamLimiter, async (req, res) => {
    const { name } = req.query as { name: string };
    if (!name?.trim()) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    try {
      await deleteWorkspaceFile(name.trim());
      res.json({ success: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Delete failed";
      res.status(500).json({ error: message });
    }
  });

  // ─── Multi-Agent Team ─────────────────────────────────────────────────────
  // v5.1: Architect → Coder → Debugger → Security Auditor pipeline
  app.post("/api/agent/team", heavyLimiter, async (req, res) => {
    const { task } = req.body as { task: string };
    if (!task?.trim()) { res.status(400).json({ error: "task is required" }); return; }
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.flushHeaders();
    try {
      await runTeamAgent(task.trim(), res);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Team agent failed";
      res.write(`data: ${JSON.stringify({ type: "error", message })}\n\n`);
      res.end();
    }
  });

  // Team Agent file download — returns all workspace files as JSON
  app.post("/api/agent/team/download", async (req, res) => {
    try {
      const files = await listWorkspaceFiles();
      if (files.length === 0) { res.status(404).json({ error: "No workspace files to download" }); return; }
      const fileContents = await Promise.all(files.map(async (f) => {
        try { return { name: f.name, content: await readWorkspaceFile(f.name) }; }
        catch { return { name: f.name, content: "" }; }
      }));
      res.json({ files: fileContents });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Download failed" });
    }
  });

  // ─── Persistent Memory ────────────────────────────────────────────────────
  // v5.1: Store, search, list, delete memories across sessions
  // v6.02: Extracted to routes/memoryRoutes.ts
  registerMemoryRoutes(app, streamLimiter, heavyLimiter, setSseHeaders, sseWrite, deps);

  // ─── Self-Improving Codebase ──────────────────────────────────────────────
  // v5.1: Analyze own source, generate diffs, apply approved improvements
  // v6.02: Extracted to routes/selfRoutes.ts
  registerSelfRoutes(app, streamLimiter, heavyLimiter, setSseHeaders, sseWrite, deps);


  // ═══════════════════════════════════════════════════════════════════════════
  // v6.02: Extracted to routes/agentRoutes.ts
  registerAgentRoutes(app, streamLimiter, heavyLimiter, setSseHeaders, sseWrite, deps);


  // ═══════════════════════════════════════════════════════════════════════════
  // v5.5: LLM Provider endpoints
  // ═══════════════════════════════════════════════════════════════════════════

  app.get("/api/llm/providers", (req, res) => {
    res.json({ providers: listProviders(), active: getActiveProvider() });
  });

  app.post("/api/llm/provider", (req, res) => {
    const config = req.body;
    if (!config?.id) { res.status(400).json({ error: "id is required" }); return; }
    setActiveProvider(config);
    res.json({ success: true, active: getActiveProvider() });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // v5.5: Tool Registry endpoints
  // ═══════════════════════════════════════════════════════════════════════════

  app.get("/api/tools", (req, res) => {
    const tools = getAllTools().map(t => ({
      name: t.name,
      description: t.description,
      category: t.category ?? "general",
      safety: t.safety ?? "safe",
    }));
    res.json({ tools });
  });

  app.get("/api/tools/definitions", (req, res) => {
    res.json({ definitions: getToolDefinitions() });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // v5.5: MCP Server endpoints
  // ═══════════════════════════════════════════════════════════════════════════

  app.get("/api/mcp/servers", (req, res) => {
    res.json({ servers: getServerConfigs(), connections: getConnectionStatus() });
  });

  app.post("/api/mcp/servers", (req, res) => {
    const config = req.body as MCPServerConfig;
    if (!config?.id || !config?.name) { res.status(400).json({ error: "id and name required" }); return; }
    addServerConfig(config);
    res.json({ success: true });
  });

  app.delete("/api/mcp/servers/:id", (req, res) => {
    removeServerConfig(req.params.id);
    res.json({ success: true });
  });

  app.post("/api/mcp/connect/:id", async (req, res) => {
    try {
      const result = await connectServer(req.params.id);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post("/api/mcp/disconnect/:id", (req, res) => {
    disconnectServer(req.params.id);
    res.json({ success: true });
  });

  app.post("/api/mcp/connect-all", async (req, res) => {
    try {
      await connectAllEnabled();
      res.json({ success: true, connections: getConnectionStatus() });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ─── Delegated Route Modules (v6.03 refactor) ─────────────────────────────
  // These were previously inline in this file (lines 844–2973, ~2130 lines).
  // Each module is now a focused, independently testable route handler.
  registerLLMRoutes(app);
  registerAutonomyRoutes(app);
  registerSystemRoutes(app);
}
