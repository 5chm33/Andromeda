/**
 * federatedLoraSharing.ts
 *
 * Peer-to-Peer LoRA Weight and Tool Proposal Sharing for Andromeda.
 *
 * Extends the existing federatedLearning gossip protocol to share:
 *   1. LoRA adapter weights (compressed, delta-only) between nodes
 *   2. Validated tool proposals (new capabilities discovered by peer nodes)
 *   3. Capability benchmark results for federated averaging
 *
 * Architecture:
 *   - LoRA weights are serialized as base64-encoded binary blobs
 *   - Only delta weights (vs. base model) are shared to minimize bandwidth
 *   - Weights are validated via checksum before merging
 *   - Tool proposals are shared as JSON (no raw code, only tool specs)
 *   - Federated averaging merges weights from top-N trusted peers
 *
 * Privacy:
 *   - Raw training data is NEVER shared
 *   - Only adapter weights (not full model weights) are shared
 *   - Nodes can opt out via FEDERATED_LORA_SHARING=false
 */
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { createLogger } from "./logger.js";

const log = createLogger("federatedLoraSharing");

// ── Types ─────────────────────────────────────────────────────────────────────
export interface LoraWeightPackage {
  /** Unique ID for this weight package */
  packageId: string;
  /** Node that generated these weights */
  sourceNodeId: string;
  /** Base model identifier (e.g., "deepseek-coder-6.7b") */
  baseModel: string;
  /** LoRA rank used during training */
  rank: number;
  /** Number of training steps */
  steps: number;
  /** Capability score improvement observed */
  scoreDelta: number;
  /** Compressed base64-encoded weight delta */
  weightsDelta: string;
  /** SHA-256 checksum of the weights for integrity verification */
  checksum: string;
  /** Size in bytes of the uncompressed weights */
  sizeBytes: number;
  /** Timestamp when generated */
  createdAt: number;
  /** Number of peer nodes that have successfully merged these weights */
  mergeCount: number;
}

export interface SharedToolProposal {
  /** Unique ID */
  proposalId: string;
  /** Source node */
  sourceNodeId: string;
  /** Tool name */
  toolName: string;
  /** Tool description */
  description: string;
  /** Tool spec (JSON schema, no raw code) */
  spec: Record<string, unknown>;
  /** Capability score improvement on source node */
  scoreDelta: number;
  /** Number of successful adoptions across the network */
  adoptionCount: number;
  /** Timestamp */
  createdAt: number;
}

export interface FederatedLoraState {
  packages: LoraWeightPackage[];
  toolProposals: SharedToolProposal[];
  lastSyncAt: number;
  totalMerges: number;
}

// ── State ─────────────────────────────────────────────────────────────────────
const LORA_STATE_FILE = () => {
  const workspace = process.env.ANDROMEDA_WORKSPACE ?? process.cwd();
  return path.join(workspace, "server", "data", "federatedLora.json");
};

function loadState(): FederatedLoraState {
  try {
    const raw = fs.readFileSync(LORA_STATE_FILE(), "utf8");
    return JSON.parse(raw);
  } catch {
    return { packages: [], toolProposals: [], lastSyncAt: 0, totalMerges: 0 };
  }
}

function saveState(state: FederatedLoraState): void {
  const file = LORA_STATE_FILE();
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
}

// ── LoRA Weight Sharing ───────────────────────────────────────────────────────

/**
 * Packages local LoRA weights for sharing with peers.
 * Reads the latest adapter from the localLora data directory.
 */
export function packageLocalLoraWeights(
  baseModel: string,
  rank: number,
  steps: number,
  scoreDelta: number,
  weightsPath: string
): LoraWeightPackage | null {
  if (!fs.existsSync(weightsPath)) {
    log.warn("LoRA weights file not found — cannot package", { weightsPath });
    return null;
  }

  const rawBytes = fs.readFileSync(weightsPath);
  const checksum = crypto.createHash("sha256").update(rawBytes).digest("hex");
  const weightsDelta = rawBytes.toString("base64");
  const nodeId = process.env.FEDERATED_NODE_ID ?? require("os").hostname();

  const pkg: LoraWeightPackage = {
    packageId: crypto.randomUUID(),
    sourceNodeId: nodeId,
    baseModel,
    rank,
    steps,
    scoreDelta,
    weightsDelta,
    checksum,
    sizeBytes: rawBytes.length,
    createdAt: Date.now(),
    mergeCount: 0,
  };

  const state = loadState();
  state.packages.push(pkg);
  // Keep only the last 10 packages
  if (state.packages.length > 10) {
    state.packages = state.packages.slice(-10);
  }
  saveState(state);

  log.info("Packaged LoRA weights for sharing", {
    packageId: pkg.packageId,
    sizeBytes: pkg.sizeBytes,
    scoreDelta,
  });

  return pkg;
}

/**
 * Receives a LoRA weight package from a peer node.
 * Validates checksum, then saves to the local LoRA directory.
 */
export function receiveLoraPackage(
  pkg: LoraWeightPackage,
  outputDir: string
): { success: boolean; reason?: string } {
  // Input validation
  if (!pkg || typeof pkg !== 'object' || !pkg.weightsDelta || !pkg.checksum || !pkg.packageId) {
    return { success: false, reason: "invalid_package" };
  }
  if (typeof outputDir !== 'string' || outputDir.length === 0) {
    return { success: false, reason: "invalid_output_dir" };
  }

  // Validate checksum
  const rawBytes = Buffer.from(pkg.weightsDelta, "base64");
  const actualChecksum = crypto.createHash("sha256").update(rawBytes).digest("hex");

  if (actualChecksum !== pkg.checksum) {
    log.warn("LoRA package checksum mismatch — rejecting", {
      packageId: pkg.packageId,
      expected: pkg.checksum,
      actual: actualChecksum,
    });
    return { success: false, reason: "checksum_mismatch" };
  }

  // Size limit: reject packages > 500MB
  if (pkg.sizeBytes > 500 * 1024 * 1024) {
    return { success: false, reason: "package_too_large" };
  }

  // Save to output directory
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(outputDir, `federated-${pkg.packageId.slice(0, 8)}.bin`);
  fs.writeFileSync(outputPath, rawBytes);

  // Update state
  const state = loadState();
  const existing = state.packages.find((p) => p.packageId === pkg.packageId);
  if (!existing) {
    pkg.mergeCount = (pkg.mergeCount ?? 0) + 1;
    state.packages.push(pkg);
    state.totalMerges += 1;
    saveState(state);
  }

  log.info("Received and saved LoRA package from peer", {
    packageId: pkg.packageId,
    sourceNodeId: pkg.sourceNodeId,
    outputPath,
  });

  return { success: true };
}

// ── Tool Proposal Sharing ─────────────────────────────────────────────────────

/**
 * Shares a validated tool proposal with the federated network.
 */
export function shareToolProposal(
  toolName: string,
  description: string,
  spec: Record<string, unknown>,
  scoreDelta: number
): SharedToolProposal {
  const nodeId = process.env.FEDERATED_NODE_ID ?? require("os").hostname();

  const proposal: SharedToolProposal = {
    proposalId: crypto.randomUUID(),
    sourceNodeId: nodeId,
    toolName,
    description,
    spec,
    scoreDelta,
    adoptionCount: 0,
    createdAt: Date.now(),
  };

  const state = loadState();
  state.toolProposals.push(proposal);
  if (state.toolProposals.length > 100) {
    state.toolProposals = state.toolProposals.slice(-100);
  }
  saveState(state);

  log.info("Shared tool proposal to federated network", {
    proposalId: proposal.proposalId,
    toolName,
    scoreDelta,
  });

  return proposal;
}

/**
 * Receives a tool proposal from a peer node.
 */
export function receiveToolProposal(proposal: SharedToolProposal): void {
  if (!proposal || typeof proposal !== 'object' || !proposal.proposalId || !proposal.sourceNodeId || !proposal.toolName) {
    log.warn("Invalid tool proposal received — missing required fields", { proposal });
    return;
  }
  const state = loadState();
  const existing = state.toolProposals.find((p) => p.proposalId === proposal.proposalId);
  if (!existing) {
    state.toolProposals.push(proposal);
    saveState(state);
    log.info("Received tool proposal from peer", {
      proposalId: proposal.proposalId,
      sourceNodeId: proposal.sourceNodeId,
      toolName: proposal.toolName,
    });
  }
}

/**
 * Gets the top-N tool proposals by score delta for local adoption consideration.
 */
export function getTopToolProposals(limit = 10): SharedToolProposal[] {
  const state = loadState();
  return [...state.toolProposals]
    .sort((a, b) => b.scoreDelta - a.scoreDelta)
    .slice(0, limit);
}

/**
 * Gets all available LoRA packages from peers, sorted by score delta.
 */
export function getAvailableLoraPackages(): LoraWeightPackage[] {
  const state = loadState();
  const nodeId = process.env.FEDERATED_NODE_ID ?? require("os").hostname();
  return state.packages
    .filter((p) => p.sourceNodeId !== nodeId) // Only peer packages
    .sort((a, b) => b.scoreDelta - a.scoreDelta);
}

/**
 * Federated averaging: merge capability scores from peers.
 * Returns the weighted average score across all trusted nodes.
 */
export function computeFederatedAverageScore(
  localScore: number,
  peerScores: Array<{ score: number; trustScore: number }>
): number {
  const allScores = [
    { score: localScore, trustScore: 1.0 },
    ...peerScores,
  ];
  const totalWeight = allScores.reduce((sum, s) => sum + s.trustScore, 0);
  const weightedSum = allScores.reduce((sum, s) => sum + s.score * s.trustScore, 0);
  return totalWeight > 0 ? weightedSum / totalWeight : localScore;
}

export function getFederatedLoraState(): FederatedLoraState {
  return loadState();
}
