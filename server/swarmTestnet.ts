/**
 * swarmTestnet.ts
 *
 * Multi-instance swarm coordination testnet infrastructure.
 *
 * Provides a local testnet for validating swarm coordination before
 * deploying to real federated peers. Simulates multiple Andromeda
 * instances communicating via an in-process event bus.
 *
 * Features:
 *   - Spawn N virtual Andromeda instances in-process
 *   - Route proposals through the swarm for consensus voting
 *   - Simulate network partitions and Byzantine faults
 *   - Measure consensus latency and throughput
 *   - Export testnet results for analysis
 */

import { EventEmitter } from "events";
import { createLogger } from "./logger.js";

const log = createLogger("swarmTestnet");

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TestnetNode {
  id: string;
  trustScore: number;
  capabilities: string[];
  isOnline: boolean;
  isByzantine: boolean;
  latencyMs: number;
  messagesReceived: number;
  messagesSent: number;
  proposalsVotedOn: number;
  consensusReached: number;
}

export interface TestnetProposal {
  id: string;
  content: string;
  proposedBy: string;
  votes: Map<string, "approve" | "reject" | "abstain">;
  status: "pending" | "approved" | "rejected" | "timeout";
  createdAt: number;
  resolvedAt?: number;
  requiredQuorum: number;
}

export interface TestnetMessage {
  from: string;
  to: string | "broadcast";
  type: "proposal" | "vote" | "heartbeat" | "sync" | "challenge";
  payload: unknown;
  timestamp: number;
  deliveredAt?: number;
  dropped?: boolean;
}

export interface TestnetConfig {
  nodeCount: number;
  byzantineFraction: number;  // 0.0–0.33 (max Byzantine nodes for BFT)
  networkPartitionRate: number;  // probability of message drop
  baseLatencyMs: number;
  jitterMs: number;
  quorumThreshold: number;  // fraction of nodes needed for consensus (0.5–0.67)
  voteTimeoutMs: number;
}

export interface TestnetResult {
  totalProposals: number;
  approvedProposals: number;
  rejectedProposals: number;
  timedOutProposals: number;
  averageConsensusLatencyMs: number;
  messageCount: number;
  droppedMessageCount: number;
  byzantineAttemptsDetected: number;
  testDurationMs: number;
}

// ── Testnet ───────────────────────────────────────────────────────────────────

export class SwarmTestnet extends EventEmitter {
  private nodes = new Map<string, TestnetNode>();
  private proposals = new Map<string, TestnetProposal>();
  private messageLog: TestnetMessage[] = [];
  private config: TestnetConfig;
  private startedAt = 0;

  constructor(config: Partial<TestnetConfig> = {}) {
    super();
    this.config = {
      nodeCount: config.nodeCount ?? 5,
      byzantineFraction: config.byzantineFraction ?? 0.0,
      networkPartitionRate: config.networkPartitionRate ?? 0.0,
      baseLatencyMs: config.baseLatencyMs ?? 10,
      jitterMs: config.jitterMs ?? 5,
      quorumThreshold: config.quorumThreshold ?? 0.67,
      voteTimeoutMs: config.voteTimeoutMs ?? 5000,
    };
  }

  /**
   * Initialize the testnet with N virtual nodes.
   */
  initialize(): void {
    this.nodes.clear();
    this.proposals.clear();
    this.messageLog = [];
    this.startedAt = Date.now();

    const byzantineCount = Math.floor(this.config.nodeCount * this.config.byzantineFraction);

    for (let i = 0; i < this.config.nodeCount; i++) {
      const nodeId = `node-${i.toString().padStart(3, "0")}`;
      const isByzantine = i < byzantineCount;

      this.nodes.set(nodeId, {
        id: nodeId,
        trustScore: isByzantine ? 0.3 : 0.8 + Math.random() * 0.2,
        capabilities: ["rsi", "eval", "lora"].filter(() => Math.random() > 0.3),
        isOnline: true,
        isByzantine,
        latencyMs: this.config.baseLatencyMs + Math.random() * this.config.jitterMs,
        messagesReceived: 0,
        messagesSent: 0,
        proposalsVotedOn: 0,
        consensusReached: 0,
      });
    }

    log.info(`[swarmTestnet] Initialized ${this.config.nodeCount} nodes (${byzantineCount} Byzantine)`);
    this.emit("initialized", { nodeCount: this.config.nodeCount, byzantineCount });
  }

  /**
   * Submit a proposal to the testnet for consensus voting.
   */
  async submitProposal(content: string, proposedBy: string): Promise<TestnetProposal> {
    const proposalId = `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const requiredQuorum = Math.ceil(this.nodes.size * this.config.quorumThreshold);

    const proposal: TestnetProposal = {
      id: proposalId,
      content,
      proposedBy,
      votes: new Map(),
      status: "pending",
      createdAt: Date.now(),
      requiredQuorum,
    };

    this.proposals.set(proposalId, proposal);
    log.info(`[swarmTestnet] Proposal submitted: ${proposalId} (quorum: ${requiredQuorum}/${this.nodes.size})`);

    // Broadcast to all nodes
    await this.broadcastMessage(proposedBy, {
      type: "proposal",
      payload: { proposalId, content },
    });

    // Collect votes with timeout
    await this.collectVotes(proposal);

    return proposal;
  }

  /**
   * Simulate all nodes voting on a proposal.
   */
  private async collectVotes(proposal: TestnetProposal): Promise<void> {
    const votePromises: Promise<void>[] = [];

    for (const [nodeId, node] of this.nodes) {
      if (!node.isOnline || nodeId === proposal.proposedBy) continue;

      votePromises.push(this.simulateNodeVote(node, proposal));
    }

    // Wait for all votes with timeout
    await Promise.race([
      Promise.all(votePromises),
      new Promise<void>((resolve) => setTimeout(resolve, this.config.voteTimeoutMs)),
    ]);

    // Tally votes
    let approveCount = 0;
    let rejectCount = 0;

    for (const vote of proposal.votes.values()) {
      if (vote === "approve") approveCount++;
      else if (vote === "reject") rejectCount++;
    }

    const totalVotes = proposal.votes.size;
    if (totalVotes === 0) {
      proposal.status = "timeout";
    } else if (approveCount >= proposal.requiredQuorum) {
      proposal.status = "approved";
    } else if (rejectCount > this.nodes.size - proposal.requiredQuorum) {
      proposal.status = "rejected";
    } else {
      proposal.status = "timeout";
    }

    proposal.resolvedAt = Date.now();

    // Update node stats
    for (const nodeId of proposal.votes.keys()) {
      const node = this.nodes.get(nodeId);
      if (node) {
        node.proposalsVotedOn++;
        if (proposal.status === "approved") node.consensusReached++;
      }
    }

    log.info(`[swarmTestnet] Proposal ${proposal.id}: ${proposal.status} (${approveCount} approve, ${rejectCount} reject)`);
    this.emit("proposalResolved", proposal);
  }

  /**
   * Simulate a single node voting on a proposal.
   */
  private async simulateNodeVote(node: TestnetNode, proposal: TestnetProposal): Promise<void> {
    // Simulate network latency
    const latency = node.latencyMs + Math.random() * this.config.jitterMs;
    await new Promise((resolve) => setTimeout(resolve, latency));

    // Check if message was dropped (network partition simulation)
    if (Math.random() < this.config.networkPartitionRate) {
      this.messageLog.push({
        from: proposal.proposedBy,
        to: node.id,
        type: "proposal",
        payload: { proposalId: proposal.id },
        timestamp: Date.now(),
        dropped: true,
      });
      return;
    }

    node.messagesReceived++;

    // Byzantine nodes vote randomly or adversarially
    let vote: "approve" | "reject" | "abstain";
    if (node.isByzantine) {
      // Byzantine: always reject (adversarial)
      vote = "reject";
      this.emit("byzantineVoteDetected", { nodeId: node.id, proposalId: proposal.id });
    } else {
      // Honest nodes: approve if content looks safe (simple heuristic)
      const isSafe = !proposal.content.includes("rm -rf") &&
                     !proposal.content.includes("DROP TABLE") &&
                     !proposal.content.includes("process.exit");
      vote = isSafe ? "approve" : "reject";
    }

    proposal.votes.set(node.id, vote);
    node.messagesSent++;

    // Log the vote message
    this.messageLog.push({
      from: node.id,
      to: proposal.proposedBy,
      type: "vote",
      payload: { proposalId: proposal.id, vote },
      timestamp: Date.now(),
      deliveredAt: Date.now() + latency,
    });
  }

  /**
   * Broadcast a message to all online nodes.
   */
  private async broadcastMessage(
    fromNodeId: string,
    message: { type: TestnetMessage["type"]; payload: unknown }
  ): Promise<void> {
    const fromNode = this.nodes.get(fromNodeId);
    if (!fromNode) return;

    for (const [toNodeId] of this.nodes) {
      if (toNodeId === fromNodeId) continue;

      const msg: TestnetMessage = {
        from: fromNodeId,
        to: toNodeId,
        type: message.type,
        payload: message.payload,
        timestamp: Date.now(),
      };

      this.messageLog.push(msg);
      fromNode.messagesSent++;
    }
  }

  /**
   * Simulate a network partition (take nodes offline).
   */
  partitionNetwork(offlineNodeIds: string[]): void {
    for (const nodeId of offlineNodeIds) {
      const node = this.nodes.get(nodeId);
      if (node) {
        node.isOnline = false;
        log.info(`[swarmTestnet] Node ${nodeId} partitioned (offline)`);
      }
    }
    this.emit("networkPartitioned", { offlineNodes: offlineNodeIds });
  }

  /**
   * Heal a network partition (bring nodes back online).
   */
  healPartition(nodeIds: string[]): void {
    for (const nodeId of nodeIds) {
      const node = this.nodes.get(nodeId);
      if (node) {
        node.isOnline = true;
        log.info(`[swarmTestnet] Node ${nodeId} healed (online)`);
      }
    }
    this.emit("partitionHealed", { healedNodes: nodeIds });
  }

  /**
   * Run a full testnet scenario with N proposals.
   */
  async runScenario(proposalCount: number): Promise<TestnetResult> {
    if (this.nodes.size === 0) this.initialize();

    const scenarioStart = Date.now();
    const consensusLatencies: number[] = [];
    let byzantineAttemptsDetected = 0;

    // Listen for Byzantine vote events
    this.on("byzantineVoteDetected", () => { byzantineAttemptsDetected++; });

    for (let i = 0; i < proposalCount; i++) {
      const proposerId = `node-${(i % this.nodes.size).toString().padStart(3, "0")}`;
      const content = `RSI proposal ${i}: improve module performance by 5%`;

      const proposal = await this.submitProposal(content, proposerId);
      if (proposal.resolvedAt) {
        consensusLatencies.push(proposal.resolvedAt - proposal.createdAt);
      }
    }

    const approved = [...this.proposals.values()].filter(p => p.status === "approved").length;
    const rejected = [...this.proposals.values()].filter(p => p.status === "rejected").length;
    const timedOut = [...this.proposals.values()].filter(p => p.status === "timeout").length;
    const dropped = this.messageLog.filter(m => m.dropped).length;

    const result: TestnetResult = {
      totalProposals: proposalCount,
      approvedProposals: approved,
      rejectedProposals: rejected,
      timedOutProposals: timedOut,
      averageConsensusLatencyMs: consensusLatencies.length > 0
        ? consensusLatencies.reduce((a, b) => a + b, 0) / consensusLatencies.length
        : 0,
      messageCount: this.messageLog.length,
      droppedMessageCount: dropped,
      byzantineAttemptsDetected,
      testDurationMs: Date.now() - scenarioStart,
    };

    log.info(`[swarmTestnet] Scenario complete:`, result);
    this.emit("scenarioComplete", result);

    return result;
  }

  /**
   * Get current state of all nodes.
   */
  getNodes(): TestnetNode[] {
    return Array.from(this.nodes.values());
  }

  /**
   * Get all proposals and their status.
   */
  getProposals(): TestnetProposal[] {
    return Array.from(this.proposals.values());
  }

  /**
   * Get the message log.
   */
  getMessageLog(): TestnetMessage[] {
    return [...this.messageLog];
  }

  /**
   * Reset the testnet to a clean state.
   */
  reset(): void {
    this.nodes.clear();
    this.proposals.clear();
    this.messageLog = [];
    this.removeAllListeners();
    log.info("[swarmTestnet] Testnet reset");
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _testnet: SwarmTestnet | null = null;

export function getSwarmTestnet(config?: Partial<TestnetConfig>): SwarmTestnet {
  if (!_testnet) {
    _testnet = new SwarmTestnet(config);
  }
  return _testnet;
}

export function resetSwarmTestnet(): void {
  if (_testnet) {
    _testnet.reset();
    _testnet = null;
  }
}
