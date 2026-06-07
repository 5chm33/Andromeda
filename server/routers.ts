import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { getBudgetStats, getSessionDetail } from "./tokenBudgetManager.js";
import { getActiveModel } from "./aiTokens.js";
import {
  deleteSearchHistoryItem,
  deleteUserSearchHistory,
  getAutocompleteSuggestions,
  getUserSearchHistory,
  getSessionSearchHistory,
  saveSearchHistory,
  upsertSuggestion,
} from "./db";
import { generateSuggestions } from "./ai";
import { aggregateSearch } from "./search";
import { z } from "zod";

export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  search: router({
    getSources: publicProcedure
      .input(
        z.object({
          query: z.string().min(1).max(500),
          filter: z.enum(["all", "web", "news", "academic"]).default("all"),
        })
      )
      .mutation(async ({ input }) => {
        // v8.4.0: getSources is called from the frontend explicitly — Brave is OK here
        const sources = await aggregateSearch(input.query, input.filter, 12, { useBrave: true });
        await upsertSuggestion(input.query);
        return { sources };
      }),

    saveToHistory: publicProcedure
      .input(
        z.object({
          query: z.string().min(1).max(500),
          aiAnswer: z.string().optional(),
          sources: z.array(z.any()).optional(),
          filter: z.string().optional(),
          sessionId: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const id = await saveSearchHistory({
          userId: ctx.user?.id ?? null,
          sessionId: input.sessionId,
          query: input.query,
          aiAnswer: input.aiAnswer,
          sources: input.sources as any,
          filter: input.filter ?? "all",
        });
        return { id };
      }),

    autocomplete: publicProcedure
      .input(z.object({ prefix: z.string().max(100).default("") }))
      .query(async ({ input }) => {
        // v5.55: Return empty results for short prefixes to avoid 400 spam in console
        if (!input.prefix || input.prefix.trim().length < 2) {
          return { suggestions: [] };
        }
        const suggestions = await getAutocompleteSuggestions(input.prefix, 6);
        return { suggestions: suggestions.map((s) => s.query) };
      }),

    followUpSuggestions: publicProcedure
      .input(z.object({ query: z.string().min(1).max(500) }))
      .query(async ({ input }) => {
        const suggestions = await generateSuggestions(input.query);
        return { suggestions };
      }),
  }),

  // ── Usage / Cost Tracker (v8.8.0) ──────────────────────────────────────────
  usage: router({
    stats: publicProcedure
      .input(z.object({ sessionId: z.string().optional() }))
      .query(({ input }) => {
        const sid = input.sessionId || "global";
        const session = getSessionDetail(sid);
        const model = getActiveModel();
        // Approximate cost per 1M tokens (USD)
        const COST_PER_1M: Record<string, { input: number; output: number }> = {
          "deepseek-chat":      { input: 0.27,  output: 1.10 },
          "deepseek-reasoner":  { input: 0.55,  output: 2.19 },
          "kimi-k2":            { input: 0.60,  output: 2.50 },
          "kimi-k2.6":          { input: 0.60,  output: 2.50 },
          "gpt-4o":             { input: 2.50,  output: 10.0 },
          "gpt-4o-mini":        { input: 0.15,  output: 0.60 },
          "claude-3-5-sonnet":  { input: 3.00,  output: 15.0 },
        };
        const rates = COST_PER_1M[model] ?? { input: 0.50, output: 2.00 };
        const inputTokens  = session?.inputTokens  ?? 0;
        const outputTokens = session?.outputTokens ?? 0;
        const totalTokens  = inputTokens + outputTokens;
        const estimatedCostUsd =
          (inputTokens  / 1_000_000) * rates.input +
          (outputTokens / 1_000_000) * rates.output;
        return {
          model,
          inputTokens,
          outputTokens,
          totalTokens,
          turnCount: session?.turnCount ?? 0,
          estimatedCostUsd: parseFloat(estimatedCostUsd.toFixed(6)),
          ratesPerMillion: rates,
        };
      }),
  }),

  history: router({
    // v5.10: publicProcedure — history works without login (uses userId if available, else sessionId)
    list: publicProcedure
      .input(z.object({
        limit: z.number().min(1).max(100).default(20),
        cursor: z.number().optional(),
        sessionId: z.string().optional(),
      }))
      .query(async ({ ctx, input }) => {
        const userId = ctx.user?.id ?? null;
        if (!userId && !input.sessionId) return { items: [], nextCursor: null };
        const items = userId
          ? await getUserSearchHistory(userId, input.limit, input.cursor)
          : await getSessionSearchHistory(input.sessionId!, input.limit, input.cursor);
        const nextCursor = items.length === input.limit ? items[items.length - 1]?.id ?? null : null;
        return { items, nextCursor };
      }),

    deleteItem: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const userId = ctx.user?.id ?? null;
        if (userId) await deleteSearchHistoryItem(input.id, userId);
        return { success: true };
      }),

    clearAll: publicProcedure.mutation(async ({ ctx }) => {
      const userId = ctx.user?.id ?? null;
      if (userId) await deleteUserSearchHistory(userId);
      return { success: true };
    }),
  }),
});

export type AppRouter = typeof appRouter;
