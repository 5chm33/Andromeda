/**
 * distributedConsensus.ts — Distributed 3-Node Consensus Protocol (v16.0.0)
 *
 * Implements a Raft-inspired lightweight consensus protocol for RSI proposal
 * approval. When multiple Andromeda nodes are running (e.g., on a home server
 * cluster or across Docker containers), proposals must receive a majority vote
 * (2 of 3 nodes) before being applied. This eliminates single-node hallucination
 * errors and dramatically increases the acceptance rate quality ceiling.
 *
 * Architecture:
 *   - Each node exposes a POST /api/consensus/vote endpoint
 *   - The proposing node broadcasts the proposal to all known peers
 *   - Each peer independently evaluates the proposal and returns a vote
 *   - The proposing node tallies votes and applies only if quorum is reached
 *   - In single-node mode (no peers configured), consensus passes automatically
 *
 * Node discovery:
 *   - Peers are configured via ANDROMEDA_PEERS env var (comma-separated URLs)
 *   - Example: ANDROMEDA_PEERS=http://node2:3000,http://node3:3000
 *
 * @module distributedConsensus
 * @version 16.0.0
 */

import { createLogger } from "./logger.js";

const log = createLogger("distributedConsensus");

// ─── Configuration ────────────────────────────────────────────────────────────

/** Timeout for each peer vote request in milliseconds */
const VOTE_TIMEOUT_MS = 15_000;

/** Minimum fraction of nodes that must approve for consensus (2/3 = 0.667) */
const QUORUM_FRACTION = 0.667;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ConsensusProposal {
  /** Unique proposal ID */
  proposalId: string;
  /** The target file being modified */
  targetFile: string;
  /** Human-readable title */
  title: string;
  /** The proposed new content or diff */
  proposedContent: string;
  /** The original content (for context) */
  originalContent: string;
  /** RSI area (performance, security, etc.) */
  area: string;
  /** Confidence score from the generating node */
  confidence: number;
  /** ISO timestamp */
  proposedAt: string;
}

export interface PeerVote {
  /** The peer node URL */
  nodeUrl: string;
  /** Whether this peer approves the proposal */
  approved: boolean;
  /** Peer's confidence score for this proposal */
  confidence: number;
  /** Reason for rejection (if not approved) */
  reason: string | null;
  /** Response time in ms */
  responseTimeMs: number;
}

export interface ConsensusResult {
  /** Whether consensus was reached */
  reached: boolean;
  /** Total votes cast */
  totalVotes: number;
  /** Number of approvals */
  approvals: number;
  /** Number of rejections */
  rejections: number;
  /** Number of timeouts/errors */
  timeouts: number;
  /** Individual peer votes */
  peerVotes: PeerVote[];
  /** Whether this is single-node mode (auto-pass) */
  singleNodeMode: boolean;
  /** Average confidence across approving peers */
  avgApprovalConfidence: number;
}

// ─── Peer Discovery ───────────────────────────────────────────────────────────

/**
 * Get the list of peer node URLs from environment configuration.
 * Returns an empty array in single-node mode.
 */
export function getPeerNodes(): string[] {
  const peersEnv = process.env.ANDROMEDA_PEERS;
  if (!peersEnv || peersEnv.trim() === "") return [];

  return peersEnv
    .split(",")
    .map(url => url.trim())
    .filter(url => url.length > 0 && url.startsWith("http"));
}

// ─── Vote Casting ─────────────────────────────────────────────────────────────

/**
 * Cast a local vote on a proposal from another node.
 * This is called when a peer sends us a proposal to evaluate.
 *
 * The local node runs its own validation pipeline and returns a vote.
 */
export async function castLocalVote(proposal: ConsensusProposal): Promise<PeerVote> {
  const start = Date.now();
  const nodeUrl = process.env.ANDROMEDA_NODE_URL ?? "http://localhost:3000";

  try {
    // Run a lightweight local validation (constitution + reward model)
    const { checkConstitution } = await import("./constitutionalConstraints.js");
    const { scoreWithRewardModel } = await import("./rewardModel.js");

    const constitutionCheck = checkConstitution({ diff: proposal.proposedContent, targetFile: proposal.targetFile, description: proposal.title });
    if (!constitutionCheck.allowed) {
      return {
        nodeUrl,
        approved: false,
        confidence: 0,
        reason: `Constitution violation: ${constitutionCheck.violations.join(", ")}`,
        responseTimeMs: Date.now() - start,
      };
    }

    const rewardScore = scoreWithRewardModel(proposal.proposedContent);

    const approved = rewardScore >= 0.4;
    return {
      nodeUrl,
      approved,
      confidence: rewardScore,
      reason: approved ? null : `Reward score too low: ${rewardScore.toFixed(2)}`,
      responseTimeMs: Date.now() - start,
    };

  } catch (err) {
    return {
      nodeUrl,
      approved: false,
      confidence: 0,
      reason: `Validation error: ${(err as Error).message}`,
      responseTimeMs: Date.now() - start,
    };
  }
}

// ─── Consensus Protocol ───────────────────────────────────────────────────────

/**
 * Request votes from all peer nodes for a proposal.
 * Returns the vote from each peer (or a timeout vote if the peer is unreachable).
 */
async function _requestPeerVotes(
  proposal: ConsensusProposal,
  peers: string[]
): Promise<PeerVote[]> {
  const votePromises = peers.map(async (peerUrl): Promise<PeerVote> => {
    const start = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), VOTE_TIMEOUT_MS);

    try {
      const resp = await fetch(`${peerUrl}/api/consensus/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(proposal),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!resp.ok) {
        return {
          nodeUrl: peerUrl,
          approved: false,
          confidence: 0,
          reason: `HTTP ${resp.status}`,
          responseTimeMs: Date.now() - start,
        };
      }

      const vote = await resp.json() as PeerVote;
      vote.responseTimeMs = Date.now() - start;
      return vote;

    } catch (err) {
      clearTimeout(timeoutId);
      const isTimeout = (err as Error).name === "AbortError";
      return {
        nodeUrl: peerUrl,
        approved: false,
        confidence: 0,
        reason: isTimeout ? "Timeout" : `Network error: ${(err as Error).message}`,
        responseTimeMs: Date.now() - start,
      };
    }
  });

  return Promise.all(votePromises);
}

/**
 * Run the full distributed consensus protocol for a proposal.
 *
 * In single-node mode (no peers configured), consensus passes automatically
 * with the local node's own validation as the sole vote.
 *
 * In multi-node mode, the proposal is broadcast to all peers and consensus
 * requires QUORUM_FRACTION (2/3) of all votes to be approvals.
 *
 * @param proposal  The proposal to seek consensus on
 * @returns         Consensus result with detailed voting breakdown
 */
export async function seekConsensus(proposal: ConsensusProposal): Promise<ConsensusResult> {
  const peers = getPeerNodes();

  // ── Single-node mode: auto-pass with local validation ──
  if (peers.length === 0) {
    log.info(`[distributedConsensus] Single-node mode — auto-passing proposal ${proposal.proposalId}`);
    const localVote = await castLocalVote(proposal);

    return {
      reached: localVote.approved,
      totalVotes: 1,
      approvals: localVote.approved ? 1 : 0,
      rejections: localVote.approved ? 0 : 1,
      timeouts: 0,
      peerVotes: [localVote],
      singleNodeMode: true,
      avgApprovalConfidence: localVote.approved ? localVote.confidence : 0,
    };
  }

  // ── Multi-node mode: broadcast and tally ──
  log.info(
    `[distributedConsensus] Broadcasting proposal ${proposal.proposalId} to ${peers.length} peers`
  );

  // Cast local vote in parallel with peer requests
  const [localVote, peerVotes] = await Promise.all([
    castLocalVote(proposal),
    _requestPeerVotes(proposal, peers),
  ]);

  const allVotes = [localVote, ...peerVotes];
  const approvals = allVotes.filter(v => v.approved).length;
  const rejections = allVotes.filter(v => !v.approved && v.reason !== "Timeout").length;
  const timeouts = allVotes.filter(v => v.reason === "Timeout").length;
  const totalVotes = allVotes.length;

  const quorumRequired = Math.ceil(totalVotes * QUORUM_FRACTION);
  const reached = approvals >= quorumRequired;

  const approvingVotes = allVotes.filter(v => v.approved);
  const avgApprovalConfidence = approvingVotes.length > 0
    ? approvingVotes.reduce((sum, v) => sum + v.confidence, 0) / approvingVotes.length
    : 0;

  log.info(
    `[distributedConsensus] Proposal ${proposal.proposalId}: ` +
    `${approvals}/${totalVotes} votes (need ${quorumRequired}) — ` +
    `consensus ${reached ? "REACHED" : "FAILED"}`
  );

  if (!reached) {
    const rejectionReasons = allVotes
      .filter(v => !v.approved && v.reason)
      .map(v => `${v.nodeUrl}: ${v.reason}`)
      .join("; ");
    log.warn(`[distributedConsensus] Rejection reasons: ${rejectionReasons}`);
  }

  return {
    reached,
    totalVotes,
    approvals,
    rejections,
    timeouts,
    peerVotes: allVotes,
    singleNodeMode: false,
    avgApprovalConfidence,
  };
}

// ─── Status & Health ──────────────────────────────────────────────────────────

export interface ConsensusStatus {
  mode: "single-node" | "multi-node";
  peerCount: number;
  peers: string[];
  quorumRequired: number;
  isHealthy: boolean;
}

/**
 * Get the current consensus system status.
 */
export function getConsensusStatus(): ConsensusStatus {
  const peers = getPeerNodes();
  const mode = peers.length === 0 ? "single-node" : "multi-node";
  const totalNodes = peers.length + 1; // peers + self
  const quorumRequired = Math.ceil(totalNodes * QUORUM_FRACTION);

  return {
    mode,
    peerCount: peers.length,
    peers,
    quorumRequired,
    isHealthy: true,
  };
}

/**
 * Initialize the distributed consensus module.
 * Logs the current mode and peer configuration.
 */
export function initDistributedConsensus(): void {
  const status = getConsensusStatus();

  if (status.mode === "single-node") {
    log.info(
      "[distributedConsensus] Initialized in SINGLE-NODE mode. " +
      "Set ANDROMEDA_PEERS=http://node2:3000,http://node3:3000 to enable multi-node consensus."
    );
  } else {
    log.info(
      `[distributedConsensus] Initialized in MULTI-NODE mode with ${status.peerCount} peers. ` +
      `Quorum required: ${status.quorumRequired}/${status.peerCount + 1} nodes. ` +
      `Peers: ${status.peers.join(", ")}`
    );
  }
}

// ─── Adaptive Threshold (v17.0.0) ─────────────────────────────────────────────

/**
 * Critical file patterns that require a higher consensus threshold.
 * These files are architectural foundations — a bad change here cascades everywhere.
 */
const CRITICAL_FILE_PATTERNS = [
  /selfImprove\.ts$/,
  /rsiEngine\.ts$/,
  /llmProvider\.ts$/,
  /circuitBreaker\.ts$/,
  /constitutionalConstraints\.ts$/,
  /z3ProofLayer\.ts$/,
  /gracefulDegradation\.ts$/,
  /transactionLog\.ts$/,
  /_core\/index\.ts$/,
  /_core\/initDaemons\.ts$/,
];

/** Threshold for critical files: 100% approval required */
const CRITICAL_QUORUM_FRACTION = 1.0;
/** Threshold for safe proposals (high safety score): simple majority */
const SAFE_QUORUM_FRACTION = 0.51;
/** Default threshold: 2/3 majority */
const DEFAULT_QUORUM_FRACTION = 0.667;

export interface AdaptiveThresholdResult {
  quorumFraction: number;
  rationale: string;
  isCriticalFile: boolean;
  isSafeProposal: boolean;
}

/**
 * Compute the adaptive consensus threshold for a proposal.
 *
 * Rules:
 *   - Critical files (rsiEngine, llmProvider, etc.): require 100% approval
 *   - High semantic safety score (>= 0.85) + low impact radius: simple majority (51%)
 *   - Everything else: standard 2/3 majority
 */
export function computeAdaptiveThreshold(
  targetFile: string,
  semanticSafetyScore: number,
  impactRadius: number
): AdaptiveThresholdResult {
  // Check if this is a critical architectural file
  const isCriticalFile = CRITICAL_FILE_PATTERNS.some(p => p.test(targetFile));
  if (isCriticalFile) {
    return {
      quorumFraction: CRITICAL_QUORUM_FRACTION,
      rationale: `Critical architectural file — unanimous approval required`,
      isCriticalFile: true,
      isSafeProposal: false,
    };
  }

  // Check if this is a safe, low-impact proposal
  const isSafeProposal = semanticSafetyScore >= 0.85 && impactRadius <= 3;
  if (isSafeProposal) {
    return {
      quorumFraction: SAFE_QUORUM_FRACTION,
      rationale: `High safety score (${semanticSafetyScore.toFixed(2)}) + low impact radius (${impactRadius}) — simple majority sufficient`,
      isCriticalFile: false,
      isSafeProposal: true,
    };
  }

  return {
    quorumFraction: DEFAULT_QUORUM_FRACTION,
    rationale: `Standard proposal — 2/3 majority required`,
    isCriticalFile: false,
    isSafeProposal: false,
  };
}

/**
 * Adaptive version of seekConsensus that uses a dynamic quorum threshold.
 * This is the primary entry point for v17+ consensus checks.
 */
export async function seekAdaptiveConsensus(
  proposal: ConsensusProposal,
  semanticSafetyScore: number,
  impactRadius: number
): Promise<ConsensusResult & { adaptiveThreshold: AdaptiveThresholdResult }> {
  const threshold = computeAdaptiveThreshold(
    proposal.targetFile,
    semanticSafetyScore,
    impactRadius
  );

  log.info(
    `[distributedConsensus] Adaptive threshold for ${proposal.targetFile}: ` +
    `${(threshold.quorumFraction * 100).toFixed(0)}% — ${threshold.rationale}`
  );

  const peers = getPeerNodes();

  // Single-node mode
  if (peers.length === 0) {
    const localVote = await castLocalVote(proposal);
    // For critical files in single-node mode, still require local approval
    const reached = threshold.isCriticalFile ? localVote.approved : localVote.approved;
    return {
      reached,
      totalVotes: 1,
      approvals: localVote.approved ? 1 : 0,
      rejections: localVote.approved ? 0 : 1,
      timeouts: 0,
      peerVotes: [localVote],
      singleNodeMode: true,
      avgApprovalConfidence: localVote.approved ? localVote.confidence : 0,
      adaptiveThreshold: threshold,
    };
  }

  // Multi-node mode with adaptive quorum
  const [localVote, peerVotes] = await Promise.all([
    castLocalVote(proposal),
    _requestPeerVotes(proposal, peers),
  ]);

  const allVotes = [localVote, ...peerVotes];
  const approvals = allVotes.filter(v => v.approved).length;
  const rejections = allVotes.filter(v => !v.approved && v.reason !== "Timeout").length;
  const timeouts = allVotes.filter(v => v.reason === "Timeout").length;
  const totalVotes = allVotes.length;

  // Use the adaptive quorum fraction instead of the hardcoded QUORUM_FRACTION
  const quorumRequired = Math.ceil(totalVotes * threshold.quorumFraction);
  const reached = approvals >= quorumRequired;

  const approvingVotes = allVotes.filter(v => v.approved);
  const avgApprovalConfidence = approvingVotes.length > 0
    ? approvingVotes.reduce((sum, v) => sum + v.confidence, 0) / approvingVotes.length
    : 0;

  log.info(
    `[distributedConsensus] Adaptive consensus for ${proposal.proposalId}: ` +
    `${approvals}/${totalVotes} votes (need ${quorumRequired} at ${(threshold.quorumFraction * 100).toFixed(0)}%) — ` +
    `${reached ? "REACHED" : "FAILED"}`
  );

  return {
    reached,
    totalVotes,
    approvals,
    rejections,
    timeouts,
    peerVotes: allVotes,
    singleNodeMode: false,
    avgApprovalConfidence,
    adaptiveThreshold: threshold,
  };
}
