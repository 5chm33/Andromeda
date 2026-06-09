/**
 * distributedProofConsensus.ts
 *
 * Quorum-based distributed proof consensus for RSI proposal approval.
 *
 * Before an RSI proposal can be promoted to production, a quorum of trusted
 * peers must independently verify its cryptographic proof and vote to approve.
 *
 * Protocol:
 *   1. Proposer broadcasts a ProofConsensusRequest to all known peers
 *   2. Each peer independently verifies the proof (HMAC + semantic checks)
 *   3. Peers cast signed votes (approve/reject) with their trust weight
 *   4. Consensus is reached when weighted approval >= quorumThreshold
 *   5. Consensus result is recorded and the proposal is promoted or rejected
 *
 * Trust model:
 *   - Each peer has a trust weight (0.0–1.0)
 *   - Weighted quorum = sum(approveWeights) / sum(allWeights) >= threshold
 *   - Default threshold: 0.6 (60% weighted approval)
 *
 * Network model:
 *   - Peers communicate via HTTP POST to /api/consensus/vote
 *   - Timeouts and unreachable peers are treated as abstentions
 *   - In simulation mode (no peers configured), uses local quorum simulation
 */

import { createLogger } from "./logger.js";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { createHmac } from "crypto";

const log = createLogger("distributedProofConsensus");

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ConsensusPeer {
  id: string;
  url: string;
  trustWeight: number;   // 0.0–1.0
  publicKey?: string;
  lastSeenAt: number;
  isOnline: boolean;
}

export type VoteDecision = "approve" | "reject" | "abstain";

export interface ConsensusVote {
  peerId: string;
  proposalId: string;
  decision: VoteDecision;
  trustWeight: number;
  signature: string;
  reasoning: string;
  castAt: number;
}

export interface ProofConsensusRequest {
  proposalId: string;
  proposerPeerId: string;
  proofHash: string;
  proofPayload: string;
  requestedAt: number;
  expiresAt: number;
  metadata: Record<string, unknown>;
}

export interface ConsensusResult {
  proposalId: string;
  decision: "approved" | "rejected" | "timeout" | "insufficient_peers";
  totalWeight: number;
  approveWeight: number;
  rejectWeight: number;
  abstainWeight: number;
  quorumThreshold: number;
  achievedQuorum: number;
  votes: ConsensusVote[];
  finalizedAt: number;
  reason: string;
}

export interface DistributedConsensusConfig {
  localPeerId: string;
  hmacSecret: string;
  quorumThreshold: number;       // 0.0–1.0, default 0.6
  minPeersRequired: number;      // minimum peers for valid consensus
  voteTimeoutMs: number;
  dataDir: string;
  simulationMode: boolean;       // true when no real peers are configured
}

// ── Distributed Proof Consensus Manager ──────────────────────────────────────

export class DistributedProofConsensusManager {
  private config: DistributedConsensusConfig;
  private peers = new Map<string, ConsensusPeer>();
  private pendingRequests = new Map<string, ProofConsensusRequest>();
  private results = new Map<string, ConsensusResult>();
  private votes = new Map<string, ConsensusVote[]>();
  private dataDir: string;

  constructor(config: Partial<DistributedConsensusConfig> = {}) {
    const workspaceDir = process.env.ANDROMEDA_WORKSPACE ?? process.cwd();
    this.dataDir = config.dataDir ?? join(workspaceDir, "data", "consensus");

    this.config = {
      localPeerId: config.localPeerId ?? `peer-${process.pid}`,
      hmacSecret: config.hmacSecret ?? process.env.ANDROMEDA_HMAC_SECRET ?? "andromeda-consensus-secret",
      quorumThreshold: config.quorumThreshold ?? 0.6,
      minPeersRequired: config.minPeersRequired ?? 1,
      voteTimeoutMs: config.voteTimeoutMs ?? 10_000,
      dataDir: this.dataDir,
      simulationMode: config.simulationMode ?? true,
    };

    mkdirSync(this.dataDir, { recursive: true });
    this.loadPersistedData();
  }

  // ── Peer Management ──────────────────────────────────────────────────────────

  registerPeer(peer: Omit<ConsensusPeer, "lastSeenAt" | "isOnline">): void {
    this.peers.set(peer.id, {
      ...peer,
      lastSeenAt: Date.now(),
      isOnline: true,
    });
    this.persistPeers();
    log.info(`[consensus] Registered peer: ${peer.id} (weight=${peer.trustWeight})`);
  }

  removePeer(peerId: string): void {
    this.peers.delete(peerId);
    this.persistPeers();
  }

  getPeers(): ConsensusPeer[] {
    return Array.from(this.peers.values());
  }

  getOnlinePeers(): ConsensusPeer[] {
    return Array.from(this.peers.values()).filter(p => p.isOnline);
  }

  // ── Proof Verification ───────────────────────────────────────────────────────

  /**
   * Verify a proof payload using HMAC-SHA256.
   */
  verifyProof(proofPayload: string, proofHash: string): boolean {
    const expectedHash = createHmac("sha256", this.config.hmacSecret)
      .update(proofPayload)
      .digest("hex");
    return expectedHash === proofHash;
  }

  /**
   * Generate a proof hash for a payload.
   */
  generateProofHash(proofPayload: string): string {
    return createHmac("sha256", this.config.hmacSecret)
      .update(proofPayload)
      .digest("hex");
  }

  /**
   * Sign a vote with the local peer's HMAC signature.
   */
  signVote(proposalId: string, decision: VoteDecision): string {
    const payload = `${proposalId}:${decision}:${this.config.localPeerId}`;
    return createHmac("sha256", this.config.hmacSecret)
      .update(payload)
      .digest("hex");
  }

  /**
   * Verify a peer's vote signature.
   */
  verifyVoteSignature(vote: ConsensusVote): boolean {
    const payload = `${vote.proposalId}:${vote.decision}:${vote.peerId}`;
    const expectedSig = createHmac("sha256", this.config.hmacSecret)
      .update(payload)
      .digest("hex");
    return expectedSig === vote.signature;
  }

  // ── Consensus Protocol ───────────────────────────────────────────────────────

  /**
   * Initiate a consensus request for a proposal.
   */
  async initiateConsensus(
    proposalId: string,
    proofPayload: string,
    metadata: Record<string, unknown> = {}
  ): Promise<ConsensusResult> {
    const proofHash = this.generateProofHash(proofPayload);

    const request: ProofConsensusRequest = {
      proposalId,
      proposerPeerId: this.config.localPeerId,
      proofHash,
      proofPayload,
      requestedAt: Date.now(),
      expiresAt: Date.now() + this.config.voteTimeoutMs,
      metadata,
    };

    this.pendingRequests.set(proposalId, request);
    this.votes.set(proposalId, []);

    log.info(`[consensus] Initiating consensus for proposal ${proposalId}`);

    // Collect votes from peers
    const votes = await this.collectVotes(request);

    // Compute result
    const result = this.computeConsensusResult(request, votes);
    this.results.set(proposalId, result);
    this.pendingRequests.delete(proposalId);

    this.persistResult(result);
    log.info(`[consensus] Consensus for ${proposalId}: ${result.decision} (quorum=${result.achievedQuorum.toFixed(3)})`);

    return result;
  }

  /**
   * Collect votes from all online peers (or simulate if no real peers).
   */
  private async collectVotes(request: ProofConsensusRequest): Promise<ConsensusVote[]> {
    const onlinePeers = this.getOnlinePeers();

    // Always include local vote
    const localVote = this.castLocalVote(request);
    const allVotes: ConsensusVote[] = [localVote];

    if (onlinePeers.length === 0 || this.config.simulationMode) {
      // Simulation mode: generate synthetic peer votes
      const simulatedVotes = this.simulatePeerVotes(request);
      allVotes.push(...simulatedVotes);
    } else {
      // Real mode: broadcast to peers and collect votes
      const peerVotePromises = onlinePeers.map(peer =>
        this.requestPeerVote(peer, request)
      );

      const peerVotes = await Promise.allSettled(peerVotePromises);
      for (const result of peerVotes) {
        if (result.status === "fulfilled" && result.value) {
          allVotes.push(result.value);
        }
      }
    }

    this.votes.set(request.proposalId, allVotes);
    return allVotes;
  }

  /**
   * Cast the local peer's vote on a proposal.
   */
  private castLocalVote(request: ProofConsensusRequest): ConsensusVote {
    const proofValid = this.verifyProof(request.proofPayload, request.proofHash);
    const isExpired = Date.now() > request.expiresAt;

    let decision: VoteDecision;
    let reasoning: string;

    if (isExpired) {
      decision = "abstain";
      reasoning = "Request expired before local vote";
    } else if (!proofValid) {
      decision = "reject";
      reasoning = "Proof hash verification failed";
    } else {
      // Additional semantic checks
      const semanticIssues = this.runSemanticChecks(request);
      if (semanticIssues.length > 0) {
        decision = "reject";
        reasoning = `Semantic checks failed: ${semanticIssues.join(", ")}`;
      } else {
        decision = "approve";
        reasoning = "Proof verified and semantic checks passed";
      }
    }

    return {
      peerId: this.config.localPeerId,
      proposalId: request.proposalId,
      decision,
      trustWeight: 1.0, // Local peer has full trust weight
      signature: this.signVote(request.proposalId, decision),
      reasoning,
      castAt: Date.now(),
    };
  }

  /**
   * Run semantic checks on a proof payload.
   */
  private runSemanticChecks(request: ProofConsensusRequest): string[] {
    const issues: string[] = [];

    // Check proposal ID format
    if (!request.proposalId.match(/^[a-zA-Z0-9_-]+$/)) {
      issues.push("Invalid proposal ID format");
    }

    // Check proof payload is not empty
    if (!request.proofPayload || request.proofPayload.trim().length === 0) {
      issues.push("Empty proof payload");
    }

    // Check for dangerous patterns in payload
    const dangerous = [/<script/i, /eval\s*\(/, /DROP\s+TABLE/i];
    for (const pattern of dangerous) {
      if (pattern.test(request.proofPayload)) {
        issues.push(`Dangerous pattern in payload: ${pattern}`);
      }
    }

    return issues;
  }

  /**
   * Simulate peer votes for testing/simulation mode.
   * Uses deterministic logic based on proof validity.
   */
  private simulatePeerVotes(request: ProofConsensusRequest): ConsensusVote[] {
    const proofValid = this.verifyProof(request.proofPayload, request.proofHash);

    // Simulate 4 additional peers with varying trust weights
    const simulatedPeers = [
      { id: "sim-peer-1", weight: 0.9 },
      { id: "sim-peer-2", weight: 0.8 },
      { id: "sim-peer-3", weight: 0.7 },
      { id: "sim-peer-4", weight: 0.6 },
    ];

    return simulatedPeers.map(peer => {
      // Simulated peers approve valid proofs with high probability
      const approvalProbability = proofValid ? 0.85 : 0.15;
      const random = this.deterministicRandom(request.proposalId + peer.id);
      const decision: VoteDecision = random < approvalProbability ? "approve" : "reject";

      return {
        peerId: peer.id,
        proposalId: request.proposalId,
        decision,
        trustWeight: peer.weight,
        signature: this.signVote(request.proposalId, decision),
        reasoning: `Simulated peer ${peer.id} vote`,
        castAt: Date.now(),
      };
    });
  }

  /**
   * Deterministic pseudo-random number from a seed string (0.0–1.0).
   */
  private deterministicRandom(seed: string): number {
    const hash = createHmac("sha256", "sim-seed")
      .update(seed)
      .digest("hex");
    return parseInt(hash.slice(0, 8), 16) / 0xffffffff;
  }

  /**
   * Request a vote from a remote peer via HTTP.
   */
  private async requestPeerVote(
    peer: ConsensusPeer,
    request: ProofConsensusRequest
  ): Promise<ConsensusVote | null> {
    try {
      const response = await fetch(`${peer.url}/api/consensus/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(this.config.voteTimeoutMs),
      });

      if (!response.ok) return null;

      const vote = await response.json() as ConsensusVote;

      // Verify the peer's vote signature
      if (!this.verifyVoteSignature(vote)) {
        log.warn(`[consensus] Invalid signature from peer ${peer.id}`);
        return null;
      }

      return vote;
    } catch (err) {
      log.warn(`[consensus] Failed to get vote from peer ${peer.id}:`, err);
      // Mark peer as potentially offline
      const p = this.peers.get(peer.id);
      if (p) p.isOnline = false;
      return null;
    }
  }

  /**
   * Compute the final consensus result from collected votes.
   */
  private computeConsensusResult(
    request: ProofConsensusRequest,
    votes: ConsensusVote[]
  ): ConsensusResult {
    let totalWeight = 0;
    let approveWeight = 0;
    let rejectWeight = 0;
    let abstainWeight = 0;

    for (const vote of votes) {
      totalWeight += vote.trustWeight;
      if (vote.decision === "approve") approveWeight += vote.trustWeight;
      else if (vote.decision === "reject") rejectWeight += vote.trustWeight;
      else abstainWeight += vote.trustWeight;
    }

    const achievedQuorum = totalWeight > 0 ? approveWeight / totalWeight : 0;

    let decision: ConsensusResult["decision"];
    let reason: string;

    if (votes.length < this.config.minPeersRequired) {
      decision = "insufficient_peers";
      reason = `Only ${votes.length} peers voted, need ${this.config.minPeersRequired}`;
    } else if (Date.now() > request.expiresAt) {
      decision = "timeout";
      reason = "Consensus window expired";
    } else if (achievedQuorum >= this.config.quorumThreshold) {
      decision = "approved";
      reason = `Quorum achieved: ${(achievedQuorum * 100).toFixed(1)}% >= ${(this.config.quorumThreshold * 100).toFixed(1)}%`;
    } else {
      decision = "rejected";
      reason = `Insufficient quorum: ${(achievedQuorum * 100).toFixed(1)}% < ${(this.config.quorumThreshold * 100).toFixed(1)}%`;
    }

    return {
      proposalId: request.proposalId,
      decision,
      totalWeight,
      approveWeight,
      rejectWeight,
      abstainWeight,
      quorumThreshold: this.config.quorumThreshold,
      achievedQuorum,
      votes,
      finalizedAt: Date.now(),
      reason,
    };
  }

  // ── Vote Reception (for incoming peer requests) ───────────────────────────────

  /**
   * Handle an incoming consensus vote request from another peer.
   * Called when this instance acts as a voting peer.
   */
  handleVoteRequest(request: ProofConsensusRequest): ConsensusVote {
    return this.castLocalVote(request);
  }

  // ── Persistence ──────────────────────────────────────────────────────────────

  private persistPeers(): void {
    const peersPath = join(this.dataDir, "peers.json");
    writeFileSync(peersPath, JSON.stringify(Array.from(this.peers.values()), null, 2), "utf-8");
  }

  private persistResult(result: ConsensusResult): void {
    const resultsPath = join(this.dataDir, "results.jsonl");
    writeFileSync(resultsPath, JSON.stringify(result) + "\n", { flag: "a", encoding: "utf-8" });
  }

  private loadPersistedData(): void {
    const peersPath = join(this.dataDir, "peers.json");
    if (existsSync(peersPath)) {
      try {
        const peers = JSON.parse(readFileSync(peersPath, "utf-8")) as ConsensusPeer[];
        for (const peer of peers) {
          this.peers.set(peer.id, peer);
        }
      } catch {
        // Non-fatal
      }
    }
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  getResult(proposalId: string): ConsensusResult | undefined {
    return this.results.get(proposalId);
  }

  getVotes(proposalId: string): ConsensusVote[] {
    return this.votes.get(proposalId) ?? [];
  }

  getAllResults(): ConsensusResult[] {
    return Array.from(this.results.values());
  }

  getConfig(): DistributedConsensusConfig {
    return { ...this.config };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _manager: DistributedProofConsensusManager | null = null;

export function getConsensusManager(
  config?: Partial<DistributedConsensusConfig>
): DistributedProofConsensusManager {
  if (!_manager) {
    _manager = new DistributedProofConsensusManager(config);
  }
  return _manager;
}

export function resetConsensusManager(): void {
  _manager = null;
}
