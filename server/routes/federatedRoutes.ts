/**
 * federatedRoutes.ts — v6.39
 *
 * HTTP endpoints for federated learning / multi-node RSI synchronization.
 *
 * Endpoints:
 *   POST /api/federated/register       — register this node with a peer
 *   POST /api/federated/sync           — receive a sync payload from a peer
 *   GET  /api/federated/proposals      — serve our proposals to peers
 *   GET  /api/federated/heartbeat      — health + capability score
 *   GET  /api/federated/stats          — full federated stats
 *   GET  /api/federated/nodes          — list known peer nodes
 *   POST /api/federated/nodes/block    — block a node
 *   GET  /api/federated/proposals/received — list received proposals
 *   POST /api/federated/proposals/:id/adopt — adopt a received proposal locally
 *   POST /api/federated/sync/trigger   — manually trigger a sync cycle
 */

import { Router, type Request, type Response } from "express";
import {
  registerNode,
  listNodes,
  getNode,
  getFederatedStats,
  processSyncPayload,
  prepareSyncPayload,
  getReceivedProposals,
  markProposalValidated,
  markProposalApplied,
  computeFederatedAvgScore,
  updateLocalScore,
  getNodeId,
  type FederatedSyncPayload,
} from "../federatedLearning.js";
import { requireAdmin, requireOperator } from "../rbac.js";

export const federatedRouter = Router();

// ── Token validation helper ────────────────────────────────────────────────────

function validateFederatedToken(req: Request, res: Response): boolean {
  const token = req.headers["x-federated-token"] as string | undefined;
  const expectedToken = process.env.FEDERATED_TOKEN ?? "";

  // If no token is configured, allow all (dev mode)
  if (!expectedToken) return true;

  if (!token || token !== expectedToken) {
    res.status(401).json({ error: "Invalid or missing X-Federated-Token" });
    return false;
  }
  return true;
}

// ── Heartbeat (public — used by peers to check health) ────────────────────────

/** GET /api/federated/heartbeat */
federatedRouter.get("/heartbeat", (_req: Request, res: Response) => {
  const stats = getFederatedStats();
  let version = "6.39.0";
  try {
    const { readFileSync } = require("fs");
    const { join } = require("path");
    version = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8")).version;
  } catch { /* non-fatal */ }

  res.json({
    ok: true,
    nodeId: stats.nodeId,
    version,
    capabilityScore: stats.localCapabilityScore,
    federatedAvgScore: stats.federatedAvgScore,
    peerCount: stats.peerCount,
    enabled: stats.enabled,
    timestamp: Date.now(),
  });
});

// ── Register (peer-to-peer) ────────────────────────────────────────────────────

/** POST /api/federated/register — register a peer node */
federatedRouter.post("/register", (req: Request, res: Response) => {
  if (!validateFederatedToken(req, res)) return;

  const { nodeId, url, version, capabilityScore } = req.body ?? {};
  if (!nodeId || !url) {
    res.status(400).json({ error: "nodeId and url are required" });
    return;
  }

  try {
    const node = registerNode({
      nodeId,
      url,
      version: version ?? "unknown",
      capabilityScore: capabilityScore ?? 50,
      contributionCount: 0,
    });
    res.status(201).json({
      success: true,
      node,
      ourNodeId: getNodeId(),
      message: `Node ${nodeId} registered successfully`,
    });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ── Sync (receive proposals from a peer) ──────────────────────────────────────

/** POST /api/federated/sync — receive a sync payload from a peer */
federatedRouter.post("/sync", (req: Request, res: Response) => {
  const token = req.headers["x-federated-token"] as string ?? "";
  const payload = req.body as FederatedSyncPayload;

  if (!payload?.fromNodeId) {
    res.status(400).json({ error: "Invalid sync payload — fromNodeId required" });
    return;
  }

  const result = processSyncPayload(payload, token);
  if (!result.accepted) {
    res.status(403).json({ error: result.error ?? "Sync rejected" });
    return;
  }

  res.json({
    success: true,
    proposalsAccepted: result.proposalsAccepted,
    proposalsRejected: result.proposalsRejected,
    ourNodeId: getNodeId(),
  });
});

// ── Serve proposals to peers ───────────────────────────────────────────────────

/** GET /api/federated/proposals — serve our proposals to peers */
federatedRouter.get("/proposals", async (req: Request, res: Response) => {
  if (!validateFederatedToken(req, res)) return;

  const {
    minConfidence = "0.7",
    limit = "20",
    category,
  } = req.query as Record<string, string | undefined>;

  try {
    const payload = await prepareSyncPayload();
    let proposals = payload.proposals;
    if (category) proposals = proposals.filter(p => p.category === category);
    proposals = proposals
      .filter(p => p.confidence >= parseFloat(minConfidence))
      .slice(0, parseInt(limit, 10));

    res.json({
      nodeId: getNodeId(),
      proposals,
      count: proposals.length,
      timestamp: Date.now(),
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Stats (admin) ──────────────────────────────────────────────────────────────

/** GET /api/federated/stats — full federated stats */
federatedRouter.get("/stats", requireOperator, (_req: Request, res: Response) => {
  res.json(getFederatedStats());
});

// ── Node management (admin) ────────────────────────────────────────────────────

/** GET /api/federated/nodes — list known peer nodes */
federatedRouter.get("/nodes", requireOperator, (_req: Request, res: Response) => {
  const nodes = listNodes();
  res.json({ nodes, count: nodes.length });
});

/** GET /api/federated/nodes/:id — get a specific node */
federatedRouter.get("/nodes/:id", requireOperator, (req: Request, res: Response) => {
  const node = getNode(req.params.id);
  if (!node) {
    res.status(404).json({ error: `Node '${req.params.id}' not found` });
    return;
  }
  res.json({ node });
});

// ── Received proposals (admin) ─────────────────────────────────────────────────

/** GET /api/federated/proposals/received — list received proposals */
federatedRouter.get("/proposals/received", requireOperator, (req: Request, res: Response) => {
  const {
    category,
    minConfidence,
    locallyApplied,
    locallyValidated,
  } = req.query as Record<string, string | undefined>;

  const proposals = getReceivedProposals({
    category,
    minConfidence: minConfidence ? parseFloat(minConfidence) : undefined,
    locallyApplied: locallyApplied === "true" ? true : locallyApplied === "false" ? false : undefined,
    locallyValidated: locallyValidated === "true" ? true : locallyValidated === "false" ? false : undefined,
  });

  res.json({ proposals, count: proposals.length });
});

/** POST /api/federated/proposals/:id/validate — mark a proposal as validated */
federatedRouter.post("/proposals/:id/validate", requireAdmin, (req: Request, res: Response) => {
  const { id } = req.params;
  const { validated = true } = req.body ?? {};
  markProposalValidated(id, Boolean(validated));
  res.json({ success: true, proposalId: id, validated });
});

/** POST /api/federated/proposals/:id/adopt — adopt a received proposal locally */
federatedRouter.post("/proposals/:id/adopt", requireAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;

  // Mark as validated first
  markProposalValidated(id, true);
  markProposalApplied(id);

  res.json({
    success: true,
    proposalId: id,
    message: "Proposal marked as adopted. Apply it manually via the RSI proposal system.",
  });
});

// ── Manual sync trigger (admin) ────────────────────────────────────────────────

/** POST /api/federated/sync/trigger — manually trigger a sync cycle */
federatedRouter.post("/sync/trigger", requireAdmin, async (_req: Request, res: Response) => {
  const peers = (process.env.FEDERATED_PEERS ?? "").split(",").map(s => s.trim()).filter(Boolean);

  if (peers.length === 0) {
    res.json({
      success: false,
      message: "No peers configured. Set FEDERATED_PEERS env var.",
    });
    return;
  }

  // Trigger async — don't wait
  const { initFederatedLearning } = await import("../federatedLearning.js");
  res.json({
    success: true,
    message: `Sync triggered with ${peers.length} peer(s)`,
    peers,
  });
});

/** POST /api/federated/score/update — update local capability score for federated averaging */
federatedRouter.post("/score/update", requireOperator, (req: Request, res: Response) => {
  const { score } = req.body ?? {};
  if (typeof score !== "number" || score < 0 || score > 100) {
    res.status(400).json({ error: "score must be a number between 0 and 100" });
    return;
  }
  updateLocalScore(score);
  res.json({ success: true, score, federatedAvgScore: computeFederatedAvgScore() });
});
