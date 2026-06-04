/**
 * v71Routes.ts — v7.1.0
 *
 * HTTP endpoints for v7.1 full-autonomy features:
 *   - Auto-rebuild status and manual trigger
 *   - RLHF feedback collection and stats
 *   - PR generator status and manual trigger
 *   - Knowledge transfer export/import
 */

import { Router } from "express";
import { requireAdminAuth } from "../adminAuth.js";

export const v71Router = Router();

// ─── Auto-Rebuild ────────────────────────────────────────────────────────────

/** GET /api/v71/rebuild/status */
v71Router.get("/rebuild/status", async (_req, res) => {
  try {
    const { getAutoRebuildStatus } = await import("../autoRebuild.js");
    res.json({ ok: true, data: getAutoRebuildStatus() });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** POST /api/v71/rebuild/trigger — manually trigger a rebuild */
v71Router.post("/rebuild/trigger", requireAdminAuth, async (_req, res) => {
  try {
    const { triggerRebuildNow } = await import("../autoRebuild.js");
    const record = await triggerRebuildNow("manual-api");
    res.json({ ok: true, data: record });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** POST /api/v71/rebuild/config — update auto-rebuild config */
v71Router.post("/rebuild/config", requireAdminAuth, async (req, res) => {
  try {
    const { setAutoRebuildConfig } = await import("../autoRebuild.js");
    setAutoRebuildConfig(req.body ?? {});
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── RLHF Feedback ───────────────────────────────────────────────────────────

/** GET /api/v71/rlhf/stats */
v71Router.get("/rlhf/stats", async (_req, res) => {
  try {
    const { getRlhfStats, getRlhfAggregates, getRecentFeedback } = await import("../rlhfCollector.js");
    res.json({
      ok: true,
      data: {
        stats: getRlhfStats(),
        aggregates: getRlhfAggregates(),
        recent: getRecentFeedback(10),
      },
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** POST /api/v71/rlhf/feedback — record explicit feedback for a proposal */
v71Router.post("/rlhf/feedback", async (req, res) => {
  try {
    const { recordFeedback } = await import("../rlhfCollector.js");
    const { proposalId, targetFile, category, title, feedbackType, rawRating, comment, editDiff } = req.body ?? {};
    if (!proposalId || !feedbackType) {
      return res.status(400).json({ ok: false, error: "proposalId and feedbackType are required" });
    }
    const signal = recordFeedback(proposalId, targetFile ?? "", category ?? "unknown", title ?? "", feedbackType, {
      rawRating,
      comment,
      editDiff,
      actorId: (req as any).user?.id ?? "anonymous",
    });
    res.json({ ok: true, data: signal });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── PR Generator ────────────────────────────────────────────────────────────

/** GET /api/v71/prs/status */
v71Router.get("/prs/status", async (_req, res) => {
  try {
    const { getPRGeneratorStatus } = await import("../prGenerator.js");
    res.json({ ok: true, data: getPRGeneratorStatus() });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** POST /api/v71/prs/sync — sync open PR statuses from GitHub */
v71Router.post("/prs/sync", requireAdminAuth, async (_req, res) => {
  try {
    const { syncOpenPRStatus } = await import("../prGenerator.js");
    await syncOpenPRStatus();
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── Knowledge Transfer ──────────────────────────────────────────────────────

/** GET /api/v71/knowledge/status */
v71Router.get("/knowledge/status", async (_req, res) => {
  try {
    const { getKnowledgeTransferStatus } = await import("../knowledgeTransfer.js");
    res.json({ ok: true, data: getKnowledgeTransferStatus() });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** GET /api/v71/knowledge/export — export current knowledge package */
v71Router.get("/knowledge/export", requireAdminAuth, async (_req, res) => {
  try {
    const { exportKnowledgePackage } = await import("../knowledgeTransfer.js");
    const pkg = await exportKnowledgePackage();
    res.json({ ok: true, data: pkg });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** POST /api/v71/knowledge/import — import a knowledge package from another instance */
v71Router.post("/knowledge/import", requireAdminAuth, async (req, res) => {
  try {
    const { importKnowledgePackage } = await import("../knowledgeTransfer.js");
    const pkg = req.body;
    if (!pkg?.packageId || !pkg?.sourceInstanceId) {
      return res.status(400).json({ ok: false, error: "Invalid knowledge package" });
    }
    const result = await importKnowledgePackage(pkg);
    res.json({ ok: true, data: result });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** GET /api/v71/status — full v7.1 system status */
v71Router.get("/status", async (_req, res) => {
  try {
    const [
      { getAutoRebuildStatus },
      { getRlhfStats },
      { getPRGeneratorStatus },
      { getKnowledgeTransferStatus },
    ] = await Promise.all([
      import("../autoRebuild.js"),
      import("../rlhfCollector.js"),
      import("../prGenerator.js"),
      import("../knowledgeTransfer.js"),
    ]);

    res.json({
      ok: true,
      version: "7.1.0",
      data: {
        autoRebuild: getAutoRebuildStatus(),
        rlhf: getRlhfStats(),
        prGenerator: getPRGeneratorStatus(),
        knowledgeTransfer: getKnowledgeTransferStatus(),
      },
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
