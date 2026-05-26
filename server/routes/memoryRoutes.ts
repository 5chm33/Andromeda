import type { Express } from "express";
import { storeMemory, searchMemory, listMemories, deleteMemory, getMemoryStats, autoExtractMemories } from "../memory.js";

/**
 * registerMemoryRoutes — Memory CRUD endpoints extracted from streamRouter.ts (v6.02)
 */
export function registerMemoryRoutes(
  app: Express,
  streamLimiter: any,
  heavyLimiter: any,
  setSseHeaders: (res: any) => void,
  sseWrite: (res: any, data: object) => void,
  deps: Record<string, any>
) {
  app.post("/api/memory/store", streamLimiter, (req, res) => {
    const { content, type, tags } = req.body as { content: string; type: string; tags?: string[] };
    if (!content?.trim() || !type) { res.status(400).json({ error: "content and type are required" }); return; }
    const validTypes = ["preference", "error", "project", "feedback", "fact"];
    if (!validTypes.includes(type)) { res.status(400).json({ error: `type must be one of: ${validTypes.join(", ")}` }); return; }
    try {
      const entry = storeMemory(content.trim(), type as any, tags ?? []);
      res.json({ success: true, entry });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Store failed" });
    }
  });

  app.post("/api/memory/search", streamLimiter, (req, res) => {
    const { query, limit, type } = req.body as { query: string; limit?: number; type?: string };
    if (!query?.trim()) { res.status(400).json({ error: "query is required" }); return; }
    try {
      const results = searchMemory(query.trim(), limit ?? 5, type as any);
      res.json({ results: results.map(r => ({ ...r.entry, score: r.score })) });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Search failed" });
    }
  });

  app.get("/api/memory/list", (req, res) => {
    const limit = parseInt(String(req.query.limit ?? "20"));
    const type = req.query.type as string | undefined;
    try {
      const entries = listMemories(limit, type as any);
      res.json({ entries });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "List failed" });
    }
  });

  app.delete("/api/memory/:id", (req, res) => {
    const { id } = req.params;
    const deleted = deleteMemory(id);
    res.json({ success: deleted });
  });

  app.get("/api/memory/stats", (req, res) => {
    try {
      res.json(getMemoryStats());
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Stats failed" });
    }
  });

  // Auto-extract memories from a conversation turn
  app.post("/api/memory/auto-extract", streamLimiter, async (req, res) => {
    const { query, response: aiResponse } = req.body as { query: string; response: string };
    if (!query || !aiResponse) { res.status(400).json({ error: "query and response are required" }); return; }
    const apiKey = process.env.DEEPSEEK_API_KEY ?? "";
    try {
      const stored = await autoExtractMemories(query, aiResponse, apiKey);
      res.json({ stored: stored.length, entries: stored });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Auto-extract failed" });
    }
  });

}
