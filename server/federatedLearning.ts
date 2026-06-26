/**
 * federatedLearning.ts — v6.39
 *
 * Federated Learning / Multi-Node RSI Synchronization for Andromeda.
 *
 * Architecture:
 *   - Each Andromeda instance is a "node" with a unique nodeId
 *   - Nodes share RSI improvement proposals and eval results via a gossip protocol
 *   - Proposals from peer nodes are validated locally before adoption
 *   - Federated averaging: merge capability scores across nodes to get global view
 *   - Privacy-preserving: only proposal metadata + scores are shared, not raw code
 *
 * Communication:
 *   - Nodes register via POST /api/federated/register
 *   - Gossip via POST /api/federated/sync (push proposals to peers)
 *   - Pull via GET  /api/federated/proposals (fetch proposals from a peer)
 *   - Heartbeat via GET /api/federated/heartbeat (health + score)
 *
 * Security:
 *   - All federated requests require X-Federated-Token header (shared secret)
 *   - Proposals are validated by local safetySupervisor before adoption
 *   - Nodes can be blocked via BLOCKED_NODES env var
 *
 * Configuration (env vars):
 *   FEDERATED_TOKEN      — shared secret for node authentication
 *   FEDERATED_PEERS      — comma-separated list of peer URLs
 *   FEDERATED_NODE_ID    — this node's ID (default: hostname)
 *   FEDERATED_ENABLED    — "true" to enable (default: false)
 *   FEDERATED_SYNC_INTERVAL_MS — how often to sync (default: 30 min)
 */

import * as fs from "fs";
import * as path from "path";
import { createLogger } from "./logger.js";
import { audit } from "./auditLog.js";

const log = createLogger("federatedLearning");

// ── Types ──────────────────────────────────────────────────────────────────────

export interface FederatedNode {
  nodeId: string;
  url: string;
  version: string;
  capabilityScore: number;
  lastSeenAt: number;
  registeredAt: number;
  healthy: boolean;
  /** Number of proposals this node has contributed */
  contributionCount: number;
  /** Federated trust score (0-1), updated via gossip */
  trustScore: number;
}

export interface FederatedProposal {
  /** Original proposal ID from the source node */
  proposalId: string;
  /** Node that generated this proposal */
  sourceNodeId: string;
  /** Semantic description of the improvement (no raw code) */
  description: string;
  /** Category of improvement (e.g., "performance", "safety", "accuracy") */
  category: string;
  /** Confidence score from source node (0-1) */
  confidence: number;
  /** Capability score delta observed after applying on source node */
  observedDelta: number;
  /** Number of nodes that have successfully applied this proposal */
  adoptionCount: number;
  /** Nodes that have adopted this proposal */
  adoptedBy: string[];
  /** Whether this proposal has been validated by local safety supervisor */
  locallyValidated: boolean;
  /** Whether this proposal has been applied locally */
  locallyApplied: boolean;
  /** Timestamp when received */
  receivedAt: number;
  /** Timestamp when applied locally (if applicable) */
  appliedAt?: number;
  /** Tags for filtering */
  tags: string[];
}

export interface FederatedSyncPayload {
  fromNodeId: string;
  fromNodeUrl: string;
  fromNodeVersion: string;
  capabilityScore: number;
  proposals: FederatedProposal[];
  evalResults: FederatedEvalResult[];
  timestamp: number;
  signature?: string;
}

export interface FederatedEvalResult {
  nodeId: string;
  taskId: string;
  category: string;
  passed: boolean;
  score: number;
  durationMs: number;
  timestamp: number;
}

export interface FederatedStats {
  nodeId: string;
  enabled: boolean;
  peerCount: number;
  healthyPeers: number;
  receivedProposals: number;
  adoptedProposals: number;
  sharedProposals: number;
  lastSyncAt: number | null;
  nextSyncAt: number | null;
  globalCapabilityScore: number;
  localCapabilityScore: number;
  federatedAvgScore: number;
  syncHistory: Array<{ at: number; peerId: string; proposalsReceived: number; proposalsShared: number }>;
}

// ── State ──────────────────────────────────────────────────────────────────────

const NODE_ID = process.env.FEDERATED_NODE_ID ?? (() => {
  try { return require("os").hostname(); } catch { return `node-${Math.random().toString(36).slice(2, 8)}`; }
})();

const FEDERATED_TOKEN = process.env.FEDERATED_TOKEN ?? "";
const FEDERATED_ENABLED = process.env.FEDERATED_ENABLED === "true";
const SYNC_INTERVAL_MS = parseInt(process.env.FEDERATED_SYNC_INTERVAL_MS ?? "1800000", 10); // 30 min
const BLOCKED_NODES = new Set((process.env.BLOCKED_NODES ?? "").split(",").filter(Boolean));

const nodeRegistry = new Map<string, FederatedNode>();
const receivedProposals = new Map<string, FederatedProposal>();
const sharedProposalIds = new Set<string>();
const syncHistory: FederatedStats["syncHistory"] = [];

let lastSyncAt: number | null = null;
let nextSyncAt: number | null = null;
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let localCapabilityScore = 50; // Updated from rsiEngine

const DATA_DIR = path.join(process.cwd(), "data");
const FEDERATED_STATE_FILE = path.join(DATA_DIR, "federated_state.json");

// ── Persistence ────────────────────────────────────────────────────────────────

function saveFederatedState(): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const state = {
      nodeRegistry: Object.fromEntries(nodeRegistry),
      receivedProposals: Object.fromEntries(receivedProposals),
      sharedProposalIds: Array.from(sharedProposalIds),
      lastSyncAt,
      savedAt: Date.now(),
    };
    fs.writeFileSync(FEDERATED_STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
  } catch (err) {
    log.warn(`[federated] Failed to save state: ${(err as Error).message}`);
  }
}

function loadFederatedState(): void {
  try {
    if (fs.existsSync(FEDERATED_STATE_FILE)) {
      const state = JSON.parse(fs.readFileSync(FEDERATED_STATE_FILE, "utf-8"));
      if (state.nodeRegistry) {
        for (const [id, node] of Object.entries(state.nodeRegistry)) {
          nodeRegistry.set(id, node as FederatedNode);
        }
      }
      if (state.receivedProposals) {
        for (const [id, proposal] of Object.entries(state.receivedProposals)) {
          receivedProposals.set(id, proposal as FederatedProposal);
        }
      }
      if (state.sharedProposalIds) {
        for (const id of state.sharedProposalIds) sharedProposalIds.add(id);
      }
      if (state.lastSyncAt) lastSyncAt = state.lastSyncAt;
      log.info(`[federated] Loaded state: ${nodeRegistry.size} nodes, ${receivedProposals.size} proposals`);
    }
  } catch (err) {
    log.warn(`[federated] Failed to load state: ${(err as Error).message}`);
  }
}

// ── Node Registry ──────────────────────────────────────────────────────────────

export function registerNode(node: Omit<FederatedNode, "registeredAt" | "lastSeenAt" | "healthy" | "trustScore">): FederatedNode {
  if (BLOCKED_NODES.has(node.nodeId)) {
    throw new Error(`Node ${node.nodeId} is blocked`);
  }

  const existing = nodeRegistry.get(node.nodeId);
  const registered: FederatedNode = {
    ...node,
    registeredAt: existing?.registeredAt ?? Date.now(),
    lastSeenAt: Date.now(),
    healthy: true,
    trustScore: existing?.trustScore ?? 0.5,
    contributionCount: existing?.contributionCount ?? 0,
  };
  nodeRegistry.set(node.nodeId, registered);

  audit({
      category: "system",
      action: "server_started", // reuse server_started for node registration
      actor: node.nodeId,
      resource: "federated-node",
      success: true,
      severity: "info",
      details: { nodeId: node.nodeId, url: node.url, version: node.version, event: "node_registered" },
    });

  log.info(`[federated] Node registered: ${node.nodeId} @ ${node.url}`);
  saveFederatedState();
  return registered;
}

export function getNode(nodeId: string): FederatedNode | null {
  return nodeRegistry.get(nodeId) ?? null;
}

export function listNodes(): FederatedNode[] {
  return Array.from(nodeRegistry.values());
}

export function markNodeHealthy(nodeId: string, capabilityScore?: number): void {
  const node = nodeRegistry.get(nodeId);
  if (node) {
    node.lastSeenAt = Date.now();
    node.healthy = true;
    if (capabilityScore !== undefined) node.capabilityScore = capabilityScore;
    nodeRegistry.set(nodeId, node);
  }
}

export function markNodeUnhealthy(nodeId: string): void {
  const node = nodeRegistry.get(nodeId);
  if (node) {
    node.healthy = false;
    nodeRegistry.set(nodeId, node);
    log.warn(`[federated] Node marked unhealthy: ${nodeId}`);
  }
}

// ── Proposal Management ────────────────────────────────────────────────────────

export function receiveProposal(proposal: FederatedProposal): { accepted: boolean; reason?: string } {
  // Reject from blocked nodes
  if (BLOCKED_NODES.has(proposal.sourceNodeId)) {
    return { accepted: false, reason: "Source node is blocked" };
  }

  // Reject if already seen
  if (receivedProposals.has(proposal.proposalId)) {
    return { accepted: false, reason: "Already received" };
  }

  // Reject low-confidence proposals
  if (proposal.confidence < 0.6) {
    return { accepted: false, reason: `Confidence too low: ${proposal.confidence}` };
  }

  // Reject proposals with negative observed delta (made things worse)
  if (proposal.observedDelta < -5) {
    return { accepted: false, reason: `Negative delta: ${proposal.observedDelta}` };
  }

  receivedProposals.set(proposal.proposalId, {
    ...proposal,
    locallyValidated: false,
    locallyApplied: false,
    receivedAt: Date.now(),
  });

  // Update node trust score based on proposal quality
  const node = nodeRegistry.get(proposal.sourceNodeId);
  if (node) {
    node.contributionCount++;
    // Increase trust slightly for each good proposal received
    node.trustScore = Math.min(1, node.trustScore + 0.02);
    nodeRegistry.set(proposal.sourceNodeId, node);
  }

  audit({
    category: "rsi",
    action: "proposal_created", // reuse proposal_created for federated receipt
    actor: proposal.sourceNodeId,
    resource: proposal.proposalId,
    success: true,
    severity: "info",
    details: {
      event: "federated_proposal_received",
      category: proposal.category,
      confidence: proposal.confidence,
      observedDelta: proposal.observedDelta,
      adoptionCount: proposal.adoptionCount,
    },
  });

  log.info(`[federated] Received proposal ${proposal.proposalId} from ${proposal.sourceNodeId} (confidence: ${proposal.confidence})`);
  saveFederatedState();
  return { accepted: true };
}

export function getReceivedProposals(filter?: {
  category?: string;
  minConfidence?: number;
  locallyApplied?: boolean;
  locallyValidated?: boolean;
}): FederatedProposal[] {
  let proposals = Array.from(receivedProposals.values());
  if (filter?.category) proposals = proposals.filter(p => p.category === filter.category);
  if (filter?.minConfidence !== undefined) proposals = proposals.filter(p => p.confidence >= filter.minConfidence!);
  if (filter?.locallyApplied !== undefined) proposals = proposals.filter(p => p.locallyApplied === filter.locallyApplied);
  if (filter?.locallyValidated !== undefined) proposals = proposals.filter(p => p.locallyValidated === filter.locallyValidated);
  return proposals.sort((a, b) => b.confidence - a.confidence);
}

export function markProposalValidated(proposalId: string, validated: boolean): void {
  const proposal = receivedProposals.get(proposalId);
  if (proposal) {
    proposal.locallyValidated = validated;
    receivedProposals.set(proposalId, proposal);
    saveFederatedState();
  }
}

export function markProposalApplied(proposalId: string): void {
  const proposal = receivedProposals.get(proposalId);
  if (proposal) {
    proposal.locallyApplied = true;
    proposal.appliedAt = Date.now();
    receivedProposals.set(proposalId, proposal);

    audit({
      category: "rsi",
      action: "proposal_applied",
      actor: NODE_ID,
      resource: proposalId,
      success: true,
      severity: "info",
      details: { sourceNodeId: proposal.sourceNodeId, category: proposal.category },
    });

    saveFederatedState();
  }
}

// ── Federated Averaging ────────────────────────────────────────────────────────

/**
 * Compute the federated average capability score across all healthy nodes.
 * Weighted by trust score — higher-trust nodes have more influence.
 */
export function computeFederatedAvgScore(): number {
  const healthyNodes = Array.from(nodeRegistry.values()).filter(n => n.healthy);
  if (healthyNodes.length === 0) return localCapabilityScore;

  // Include local node
  const allScores = [
    { score: localCapabilityScore, weight: 1.0 }, // local node always weight 1
    ...healthyNodes.map(n => ({ score: n.capabilityScore, weight: n.trustScore })),
  ];

  const totalWeight = allScores.reduce((sum, s) => sum + s.weight, 0);
  const weightedSum = allScores.reduce((sum, s) => sum + s.score * s.weight, 0);
  return totalWeight > 0 ? Math.round(weightedSum / totalWeight) : localCapabilityScore;
}

export function updateLocalScore(score: number): void {
  localCapabilityScore = score;
}

// ── Gossip Protocol ────────────────────────────────────────────────────────────

/**
 * Process an incoming sync payload from a peer node.
 * Validates the token, registers the node, and ingests proposals.
 */
export function processSyncPayload(
  payload: FederatedSyncPayload,
  token: string
): { accepted: boolean; proposalsAccepted: number; proposalsRejected: number; error?: string } {
  // Validate token
  if (FEDERATED_TOKEN && token !== FEDERATED_TOKEN) {
    audit({
      category: "auth",
      action: "auth_failed",
      actor: payload.fromNodeId,
      resource: "federated-sync",
      success: false,
      severity: "warn",
      details: { reason: "Invalid federated token" },
    });
    return { accepted: false, proposalsAccepted: 0, proposalsRejected: 0, error: "Invalid token" };
  }

  // Block check
  if (BLOCKED_NODES.has(payload.fromNodeId)) {
    return { accepted: false, proposalsAccepted: 0, proposalsRejected: 0, error: "Node is blocked" };
  }

  // Register/update the peer node
  try {
    registerNode({
      nodeId: payload.fromNodeId,
      url: payload.fromNodeUrl,
      version: payload.fromNodeVersion,
      capabilityScore: payload.capabilityScore,
      contributionCount: 0,
    });
  } catch {
    return { accepted: false, proposalsAccepted: 0, proposalsRejected: 0, error: "Node registration failed" };
  }

  // Ingest proposals
  let accepted = 0;
  let rejected = 0;
  for (const proposal of payload.proposals) {
    const result = receiveProposal(proposal);
    if (result.accepted) accepted++;
    else rejected++;
  }

  // Record sync
  const syncRecord = {
    at: Date.now(),
    peerId: payload.fromNodeId,
    proposalsReceived: accepted,
    proposalsShared: 0,
  };
  syncHistory.push(syncRecord);
  if (syncHistory.length > 100) syncHistory.shift();
  lastSyncAt = Date.now();

  log.info(`[federated] Sync from ${payload.fromNodeId}: ${accepted} proposals accepted, ${rejected} rejected`);
  return { accepted: true, proposalsAccepted: accepted, proposalsRejected: rejected };
}

/**
 * Prepare a sync payload to push to a peer node.
 * Includes our best recent proposals that the peer hasn't seen yet.
 */
export async function prepareSyncPayload(peerNodeId?: string): Promise<FederatedSyncPayload> {
  // Get our recent high-confidence proposals to share
  let proposalsToShare: FederatedProposal[] = [];
  try {
    const { listProposals } = await import("./selfImprove.js");
    const applied = listProposals("applied");
    // Convert local proposals to federated format
    proposalsToShare = applied
      .filter(p => !sharedProposalIds.has(p.id))
      .slice(-10) // Last 10 applied proposals
      .map(p => ({
        proposalId: `${NODE_ID}:${p.id}`,
        sourceNodeId: NODE_ID,
        description: p.rationale ?? p.title ?? "RSI improvement",
        category: p.category ?? "general",
        confidence: p.confidence ?? 0.8,
        observedDelta: 0, // Will be filled in after verification
        adoptionCount: 0,
        adoptedBy: [],
        locallyValidated: true,
        locallyApplied: true,
        receivedAt: Date.now(),
        tags: [p.category ?? "general"],
      }));

    // Mark as shared
    proposalsToShare.forEach(p => sharedProposalIds.add(p.proposalId));
  } catch {
    // Non-fatal — send empty proposals
  }

  return {
    fromNodeId: NODE_ID,
    fromNodeUrl: process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 5000}`,
    fromNodeVersion: (() => {
      try {
        return JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf-8")).version;
      } catch { return "6.39.0"; }
    })(),
    capabilityScore: localCapabilityScore,
    proposals: proposalsToShare,
    evalResults: [],
    timestamp: Date.now(),
  };
}

// ── Peer Sync (HTTP) ───────────────────────────────────────────────────────────

async function syncWithPeer(peerUrl: string): Promise<void> {
  try {
    const payload = await prepareSyncPayload();
    const response = await fetch(`${peerUrl}/api/federated/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Federated-Token": FEDERATED_TOKEN,
        "X-Node-ID": NODE_ID,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      log.warn(`[federated] Sync to ${peerUrl} failed: HTTP ${response.status}`);
      return;
    }

    const result = await response.json() as { proposalsAccepted?: number };
    log.info(`[federated] Sync to ${peerUrl} complete: ${result.proposalsAccepted ?? 0} proposals accepted`);

    // Also pull proposals from the peer
    const pullResponse = await fetch(`${peerUrl}/api/federated/proposals?minConfidence=0.7&limit=20`, {
      headers: {
        "X-Federated-Token": FEDERATED_TOKEN,
        "X-Node-ID": NODE_ID,
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (pullResponse.ok) {
      const { proposals } = await pullResponse.json() as { proposals: FederatedProposal[] };
      let pulled = 0;
      for (const proposal of (proposals ?? [])) {
        const r = receiveProposal(proposal);
        if (r.accepted) pulled++;
      }
      if (pulled > 0) log.info(`[federated] Pulled ${pulled} proposals from ${peerUrl}`);
    }
  } catch (err) {
    log.warn(`[federated] Sync to ${peerUrl} error: ${(err as Error).message}`);
    // Find node by URL and mark unhealthy
    for (const [id, node] of nodeRegistry) {
      if (node && node.url === peerUrl) { markNodeUnhealthy(id); break; }
    }
  }
}

async function runSyncCycle(): Promise<void> {
  if (!FEDERATED_ENABLED) return;

  const peers = (process.env.FEDERATED_PEERS ?? "").split(",").map(s => s.trim()).filter(Boolean);
  if (peers.length === 0) return;

  log.info(`[federated] Starting sync cycle with ${peers.length} peer(s)`);
  await Promise.allSettled(peers.map(url => syncWithPeer(url)));
  lastSyncAt = Date.now();
  saveFederatedState();
  scheduleNextSync();
}

function scheduleNextSync(): void {
  if (syncTimer) clearTimeout(syncTimer);
  if (!FEDERATED_ENABLED) { nextSyncAt = null; return; }
  nextSyncAt = Date.now() + SYNC_INTERVAL_MS;
  syncTimer = setTimeout(() => runSyncCycle(), SYNC_INTERVAL_MS);
}

// ── Stats ──────────────────────────────────────────────────────────────────────

export function getFederatedStats(): FederatedStats {
  const nodes = Array.from(nodeRegistry.values());
  const proposals = Array.from(receivedProposals.values());

  return {
    nodeId: NODE_ID,
    enabled: FEDERATED_ENABLED,
    peerCount: nodes.length,
    healthyPeers: nodes.filter(n => n.healthy).length,
    receivedProposals: proposals.length,
    adoptedProposals: proposals.filter(p => p.locallyApplied).length,
    sharedProposals: sharedProposalIds.size,
    lastSyncAt,
    nextSyncAt,
    globalCapabilityScore: computeFederatedAvgScore(),
    localCapabilityScore,
    federatedAvgScore: computeFederatedAvgScore(),
    syncHistory: syncHistory.slice(-20),
  };
}

export function getNodeId(): string {
  return NODE_ID;
}

// ── Init ───────────────────────────────────────────────────────────────────────

export function initFederatedLearning(): void {
  loadFederatedState();

  if (FEDERATED_ENABLED) {
    log.info(`[federated] Federated learning enabled. NodeID: ${NODE_ID}`);
    // Start sync after a short delay to let the server fully start
    setTimeout(() => runSyncCycle(), 30_000);
  } else {
    log.info(`[federated] Federated learning disabled (set FEDERATED_ENABLED=true to enable). NodeID: ${NODE_ID}`);
  }
}
