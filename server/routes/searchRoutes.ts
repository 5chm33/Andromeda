/**
 * searchRoutes.ts — Search & Deep Research endpoints (extracted from streamRouter.ts v9.12.0)
 *
 * Routes:
 *   POST /api/search/stream  — Streaming AI response with optional web search
 *   POST /api/search/deep    — Multi-step deep research with sub-query expansion
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { streamAIResponse, streamAIResponseWithContext, streamDeepResearch, setModel } from "../ai.js";
import { generateSubQueries } from "../aiPlanning.js";
import { aggregateSearch, deepResearchSearch } from "../search.js";
import { annotateSources, analyzeDiversity, detectCensorshipSignals, buildHonestyPromptAddendum } from "../biasDetector.js";
import type { SearchSource } from "../../drizzle/schema.js";

// ── Zod schemas ────────────────────────────────────────────────────────────────

const MODEL_ENUM = z.enum(["deepseek-chat", "deepseek-reasoner", "openrouter", "openrouter-fast", "kimi", "anthropic", "openai", "groq"]);

const searchStreamSchema = z.object({
  query: z.string().min(1, "Query is required").max(2000),
  filter: z.enum(["all", "web", "news", "academic"]).default("all"),
  sources: z.array(z.any()).optional(),
  model: MODEL_ENUM.optional(),
  context: z.array(z.object({ query: z.string(), answer: z.string() })).optional(),
});

const deepResearchSchema = z.object({
  query: z.string().min(1).max(2000),
  model: MODEL_ENUM.optional(),
});

// ── Helper ─────────────────────────────────────────────────────────────────────

function shouldRunWebSearch(filter: string, clientSources: SearchSource[] | undefined): boolean {
  if (clientSources && clientSources.length > 0) return false;
  return filter === "web" || filter === "news" || filter === "academic";
}

// ── Route registration ─────────────────────────────────────────────────────────

/**
 * Registers all search-related API routes onto the Express app.
 * @param app Express application instance
 * @param streamLimiter Rate limiter for standard requests
 * @param heavyLimiter Rate limiter for expensive requests
 * @param setSseHeaders Helper to set SSE response headers
 * @param sseWrite Helper to write an SSE event
 */
export function registerSearchRoutes(
  app: Express,
  streamLimiter: import("express").RequestHandler,
  heavyLimiter: import("express").RequestHandler,
  setSseHeaders: (res: Response) => void,
  sseWrite: (res: Response, data: object) => void,
): void {

  // ── POST /api/search/stream ────────────────────────────────────────────────
  app.post("/api/search/stream", streamLimiter, async (req: Request, res: Response) => {
    const parsed = searchStreamSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
      return;
    }
    const { query, filter, sources: clientSources, model, context } = parsed.data;
    if (model) setModel(model);
    setSseHeaders(res);

    try {
      const runSearch = shouldRunWebSearch(filter, clientSources);
      const sources: SearchSource[] =
        clientSources && clientSources.length > 0
          ? clientSources
          : runSearch
            ? await aggregateSearch(query.trim(), filter, 12, { useBrave: true })
            : [];

      const annotated = annotateSources(sources);
      const diversityReport = analyzeDiversity(annotated);
      const censorshipSignal = detectCensorshipSignals(query.trim(), annotated);
      const honestyAddendum = buildHonestyPromptAddendum(diversityReport, censorshipSignal);

      sseWrite(res, {
        type: "sources",
        sources,
        biasAnnotations: annotated.map(s => ({
          url: (s as unknown as { url?: string }).url ?? "",
          biasProfile: s.biasProfile ?? null,
          sensationalismScore: s.sensationalismScore ?? 0,
          dehumanizingWarning: s.dehumanizingWarning ?? null,
        })),
        diversityReport,
        censorshipSignal,
      });

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

  // ── POST /api/search/deep ──────────────────────────────────────────────────
  app.post("/api/search/deep", heavyLimiter, async (req: Request, res: Response) => {
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
}
