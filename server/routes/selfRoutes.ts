import { validateBody } from "./validate.js";
import { selfAnalyzeSchema, selfApplySchema } from "./zodSchemas.js";
import type { Express } from "express";
import { analyzeAndPropose, applyProposal, listProposals, rejectProposal, getAnalyzableFiles } from "../selfImprove.js";
import { requireAdminAuth } from "../adminAuth.js";

/**
 * registerSelfRoutes — Self-improvement endpoints extracted from streamRouter.ts (v6.02)
 */
export function registerSelfRoutes(
  app: Express,
  streamLimiter: any,
  heavyLimiter: any,
  setSseHeaders: (res: any) => void,
  sseWrite: (res: any, data: object) => void,
  deps: Record<string, any>
) {
  // v6.25: mutation endpoints require admin auth
  app.post("/api/self/analyze", requireAdminAuth, heavyLimiter, validateBody(selfAnalyzeSchema), async (req, res) => {
    const { file, area } = req.body as { file: string; area?: string };
    if (!file?.trim()) { res.status(400).json({ error: "file is required" }); return; }
    try {
      const proposal = await analyzeAndPropose(file.trim(), area);
      res.json({ proposal });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Analysis failed" });
    }
  });

  app.post("/api/self/apply", requireAdminAuth, validateBody(selfApplySchema), async (req, res) => {
    const { proposalId } = req.body as { proposalId: string };
    if (!proposalId) { res.status(400).json({ error: "proposalId is required" }); return; }
    const result = await applyProposal(proposalId);
    res.json(result);
  });

  app.get("/api/self/proposals", (req, res) => {
    const status = req.query.status as string | undefined;
    const proposals = listProposals(status as any);
    // Don't send full file contents in list view — too large
    res.json({ proposals: proposals.map(p => ({ ...p, originalContent: undefined, proposedContent: undefined })) });
  });

  app.get("/api/self/proposals/:id", (req, res) => {
    const proposals = listProposals();
    const proposal = proposals.find(p => p.id === req.params.id);
    if (!proposal) { res.status(404).json({ error: "Proposal not found" }); return; }
    res.json({ proposal });
  });

  app.delete("/api/self/proposals/:id", requireAdminAuth, (req, res) => {
    const rejected = rejectProposal(req.params.id);
    res.json({ success: rejected });
  });

  app.get("/api/self/files", (req, res) => {
    res.json({ files: getAnalyzableFiles() });
  });
}
