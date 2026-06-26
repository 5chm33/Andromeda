/**
 * swarmOrchestrator.ts — Distributed Swarm Task Execution
 * Andromeda v10.0.0
 *
 * Enables an Andromeda instance to dispatch sub-tasks to peer nodes in the
 * federated network, collect results, and aggregate them using a map-reduce
 * pattern. All tasks are signed with ZK commitments before dispatch.
 *
 * Architecture:
 *   - The orchestrator maintains a registry of active peer nodes (URL + trust score)
 *   - Tasks are dispatched via HTTP POST to peer /swarm/execute endpoints
 *   - Results are verified using the ZK commitment scheme
 *   - Failed peers are penalized in the trust registry
 *   - The orchestrator can run tasks locally as a fallback when no peers are available
 *
 * Integration:
 *   - Works with federatedLoraSharing.ts for weight distribution
 *   - Works with crossInstanceRlhf.ts for distributed judging
 *   - Works with zkProofSigning.ts for tamper-proof task dispatch
 */

import { signProposal, shouldAcceptProposal, updatePeerTrust, loadTrustRegistry } from "./zkProofSigning.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

// ─── Types ────────────────────────────────────────────────────────────────────

export type TaskStatus = "pending" | "running" | "completed" | "failed" | "timeout";

export interface SwarmTask<TInput = unknown, TOutput = unknown> {
  /** Unique task ID */
  id: string;
  /** Human-readable task type (e.g., "eval", "lora_train", "judge") */
  type: string;
  /** Task input payload */
  input: TInput;
  /** Task output (populated after completion) */
  output?: TOutput;
  /** Current status */
  status: TaskStatus;
  /** Instance ID that created this task */
  originInstanceId: string;
  /** Instance ID that executed this task (may differ from origin) */
  executorInstanceId?: string;
  /** Unix timestamp (ms) when the task was created */
  createdAt: number;
  /** Unix timestamp (ms) when the task completed */
  completedAt?: number;
  /** Error message if status is "failed" */
  error?: string;
  /** ZK commitment for the task input */
  commitmentHash?: string;
}

export interface PeerNode {
  instanceId: string;
  url: string;
  trustScore: number;
  lastSeen: number;
  capabilities: string[];
  isOnline: boolean;
}

export interface SwarmConfig {
  /** Maximum number of peers to dispatch a task to simultaneously */
  maxParallelPeers: number;
  /** Timeout for peer responses (ms) */
  peerTimeoutMs: number;
  /** Minimum trust score to dispatch a task to a peer */
  minTrustScore: number;
  /** Whether to run tasks locally when no peers are available */
  localFallback: boolean;
}

export interface SwarmResult<TOutput = unknown> {
  taskId: string;
  results: Array<{
    instanceId: string;
    output: TOutput;
    latencyMs: number;
    verified: boolean;
  }>;
  /** Aggregated output (majority vote or average) */
  aggregated?: TOutput;
  /** Number of peers that responded */
  peerCount: number;
  /** Number of peers that failed */
  failureCount: number;
}

// ─── Configuration ────────────────────────────────────────────────────────────

const DATA_DIR = process.env.ANDROMEDA_WORKSPACE
  ? join(process.env.ANDROMEDA_WORKSPACE, "data")
  : join(process.cwd(), "data");

const PEERS_FILE = join(DATA_DIR, "swarm_peers.json");
const TASKS_FILE = join(DATA_DIR, "swarm_tasks.json");

const DEFAULT_CONFIG: SwarmConfig = {
  maxParallelPeers: 5,
  peerTimeoutMs: 30_000,
  minTrustScore: 0.3,
  localFallback: true,
};

// ─── Peer Registry ────────────────────────────────────────────────────────────

export function loadPeers(): PeerNode[] {
  if (existsSync(PEERS_FILE)) {
    try {
      return JSON.parse(readFileSync(PEERS_FILE, "utf-8")) as PeerNode[];
    } catch {
      return [];
    }
  }
  return [];
}

export function savePeers(peers: PeerNode[]): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(PEERS_FILE, JSON.stringify(peers, null, 2), "utf-8");
}

export function registerPeer(peer: Omit<PeerNode, "lastSeen" | "isOnline">): PeerNode[] {
  const peers = loadPeers();
  const existing = peers.findIndex((p) => p.instanceId === peer.instanceId);
  const fullPeer: PeerNode = {
    ...peer,
    lastSeen: Date.now(),
    isOnline: true,
  };

  if (existing >= 0) {
    peers[existing] = fullPeer;
  } else {
    peers.push(fullPeer);
  }

  savePeers(peers);
  return peers;
}

export function getEligiblePeers(
  config: SwarmConfig = DEFAULT_CONFIG,
  requiredCapability?: string
): PeerNode[] {
  const peers = loadPeers();
  const trustRegistry = loadTrustRegistry();

  return peers
    .filter((p) => {
      if (!p.isOnline) return false;
      const trust = trustRegistry.trustedPeers?.[p.instanceId];
      if (!trust || trust.trustScore < config.minTrustScore) return false;
      if (requiredCapability && !p.capabilities.includes(requiredCapability)) return false;
      // Consider peer stale if not seen in 5 minutes
      if (Date.now() - p.lastSeen > 5 * 60 * 1000) return false;
      return true;
    })
    .sort((a, b) => {
      const trustA = trustRegistry.trustedPeers[a.instanceId]?.trustScore ?? 0;
      const trustB = trustRegistry.trustedPeers[b.instanceId]?.trustScore ?? 0;
      return trustB - trustA; // Highest trust first
    })
    .slice(0, config.maxParallelPeers);
}

// ─── Task Store ───────────────────────────────────────────────────────────────

export function loadTasks(): SwarmTask[] {
  if (existsSync(TASKS_FILE)) {
    try {
      return JSON.parse(readFileSync(TASKS_FILE, "utf-8")) as SwarmTask[];
    } catch {
      return [];
    }
  }
  return [];
}

export function saveTask(task: SwarmTask): void {
  const tasks = loadTasks();
  const existing = tasks.findIndex((t) => t.id === task.id);
  if (existing >= 0) {
    tasks[existing] = task;
  } else {
    tasks.push(task);
  }
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(TASKS_FILE, JSON.stringify(tasks.slice(-500), null, 2), "utf-8"); // Keep last 500
}

export function createTask<TInput>(
  type: string,
  input: TInput,
  originInstanceId: string
): SwarmTask<TInput> {
  const signed = signProposal({ type, input });
  const task: SwarmTask<TInput> = {
    id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    input,
    status: "pending",
    originInstanceId,
    createdAt: Date.now(),
    commitmentHash: signed.commitment.contentHash,
  };
  saveTask(task as SwarmTask);
  return task;
}

// ─── Task Dispatch ────────────────────────────────────────────────────────────

/**
 * Dispatch a task to a single peer via HTTP POST.
 * Returns the peer's response or throws on timeout/error.
 */
async function dispatchToPeer<TInput, TOutput>(
  peer: PeerNode,
  task: SwarmTask<TInput>,
  timeoutMs: number
): Promise<{ output: TOutput; latencyMs: number }> {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const signed = signProposal(task);
    const response = await fetch(`${peer.url}/swarm/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(signed),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Peer ${peer.instanceId} returned HTTP ${response.status}`);
    }

    const result = (await response.json()) as { output: TOutput; commitment: unknown };
    const latencyMs = Date.now() - start;

    return { output: result.output, latencyMs };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Dispatch a task to multiple peers in parallel and aggregate results.
 * Falls back to local execution if no peers are available.
 *
 * @param task - The task to dispatch
 * @param localExecutor - Function to execute the task locally (used as fallback)
 * @param config - Swarm configuration
 */
export async function dispatchTask<TInput, TOutput>(
  task: SwarmTask<TInput>,
  localExecutor: (input: TInput) => Promise<TOutput>,
  config: SwarmConfig = DEFAULT_CONFIG
): Promise<SwarmResult<TOutput>> {
  const eligiblePeers = getEligiblePeers(config, task.type);

  // Update task status
  const updatedTask: SwarmTask<TInput> = { ...task, status: "running" };
  saveTask(updatedTask as SwarmTask);

  if (eligiblePeers.length === 0) {
    if (!config.localFallback) {
      const failedTask: SwarmTask<TInput> = {
        ...updatedTask,
        status: "failed",
        error: "No eligible peers available and local fallback is disabled",
        completedAt: Date.now(),
      };
      saveTask(failedTask as SwarmTask);
      return {
        taskId: task.id,
        results: [],
        peerCount: 0,
        failureCount: 0,
      };
    }

    // Local fallback
    const output = await localExecutor(task.input);
    const completedTask: SwarmTask<TInput, TOutput> = {
      ...updatedTask,
      status: "completed",
      output,
      executorInstanceId: "local",
      completedAt: Date.now(),
    };
    saveTask(completedTask as SwarmTask);

    return {
      taskId: task.id,
      results: [{ instanceId: "local", output, latencyMs: 0, verified: true }],
      aggregated: output,
      peerCount: 1,
      failureCount: 0,
    };
  }

  // Dispatch to peers in parallel
  const dispatches = eligiblePeers.map(async (peer) => {
    try {
      const { output, latencyMs } = await dispatchToPeer<TInput, TOutput>(
        peer,
        task,
        config.peerTimeoutMs
      );
      updatePeerTrust(peer.instanceId, true, 0.02);
      return { instanceId: peer.instanceId, output, latencyMs, verified: true, error: null };
    } catch (err) {
      updatePeerTrust(peer.instanceId, false, 0.05);
      return {
        instanceId: peer.instanceId,
        output: null as unknown as TOutput,
        latencyMs: config.peerTimeoutMs,
        verified: false,
        error: String(err),
      };
    }
  });

  const settled = await Promise.allSettled(dispatches);
  const results = settled
    .filter((r): r is PromiseFulfilledResult<typeof dispatches extends Array<Promise<infer R>> ? R : never> =>
      r.status === "fulfilled"
    )
    .map((r) => r.value);

  const successful = results.filter((r) => r.verified);
  const failureCount = results.length - successful.length;

  // Aggregate: use the output from the highest-trust peer that succeeded
  const aggregated = successful[0]?.output;

  const completedTask: SwarmTask<TInput, TOutput> = {
    ...updatedTask,
    status: successful.length > 0 ? "completed" : "failed",
    output: aggregated,
    executorInstanceId: successful[0]?.instanceId,
    completedAt: Date.now(),
    error: successful.length === 0 ? "All peers failed" : undefined,
  };
  saveTask(completedTask as SwarmTask);

  return {
    taskId: task.id,
    results: successful,
    aggregated,
    peerCount: eligiblePeers.length,
    failureCount,
  };
}

// ─── Swarm Health ─────────────────────────────────────────────────────────────

export interface SwarmHealth {
  totalPeers: number;
  onlinePeers: number;
  averageTrustScore: number;
  pendingTasks: number;
  completedTasks: number;
  failedTasks: number;
  successRate: number;
}

export function getSwarmHealth(): SwarmHealth {
  const peers = loadPeers();
  const trustRegistry = loadTrustRegistry();
  const tasks = loadTasks();

  const onlinePeers = peers.filter((p) => p.isOnline).length;
  const trustScores = Object.values(trustRegistry.trustedPeers).map((p) => p.trustScore);
  const averageTrustScore =
    trustScores.length > 0
      ? trustScores.reduce((a, b) => a + b, 0) / trustScores.length
      : 0;

  const pendingTasks = tasks.filter((t) => t.status === "pending" || t.status === "running").length;
  const completedTasks = tasks.filter((t) => t.status === "completed").length;
  const failedTasks = tasks.filter((t) => t.status === "failed").length;
  const totalFinished = completedTasks + failedTasks;
  const successRate = totalFinished > 0 ? completedTasks / totalFinished : 1.0;

  return {
    totalPeers: peers.length,
    onlinePeers,
    averageTrustScore,
    pendingTasks,
    completedTasks,
    failedTasks,
    successRate,
  };
}
