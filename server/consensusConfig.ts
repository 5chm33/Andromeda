/**
 * consensusConfig.ts — v18.0.0
 *
 * Live 3-node consensus configuration with peer health checks and auto-discovery.
 * Reads CONSENSUS_PEERS from the environment and maintains a live health map
 * of all peer nodes. The distributedConsensus module reads this config to
 * determine which peers to contact for quorum votes.
 *
 * Environment variables:
 *   CONSENSUS_PEERS  Comma-separated list of peer base URLs
 *                    e.g. "http://node2:3001,http://node3:3002"
 *   CONSENSUS_SELF   This node's public URL (for peer registration)
 *                    e.g. "http://node1:3000"
 *
 * Exported API:
 *   initConsensusConfig()          → void (called from initDaemons)
 *   getLivePeers()                 → PeerNode[]
 *   getConsensusTopology()         → ConsensusTopology
 *   registerPeer(url)              → Promise<boolean>
 *   _resetConsensusConfigForTest() → void
 */

import { createLogger } from "./logger.js";

const log = createLogger("consensusConfig");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PeerNode {
  url: string;
  healthy: boolean;
  lastCheckedAt: string | null;
  lastSeenAt: string | null;
  version: string | null;
  latencyMs: number | null;
}

export interface ConsensusTopology {
  selfUrl: string | null;
  peers: PeerNode[];
  totalNodes: number;
  healthyNodes: number;
  quorumSize: number;
  isDistributed: boolean;
  mode: "single-node" | "distributed" | "degraded";
}

// ─── State ────────────────────────────────────────────────────────────────────

let _peers: Map<string, PeerNode> = new Map();
let _selfUrl: string | null = null;
let _healthCheckInterval: ReturnType<typeof setInterval> | null = null;
let _initialized = false;

const HEALTH_CHECK_INTERVAL_MS = 30_000; // 30 seconds
const HEALTH_CHECK_TIMEOUT_MS = 5_000;   // 5 second timeout per peer

// ─── Peer Health Check ────────────────────────────────────────────────────────

async function _checkPeerHealth(url: string): Promise<{ healthy: boolean; version: string | null; latencyMs: number }> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);
    const resp = await fetch(`${url}/api/health`, { signal: controller.signal });
    clearTimeout(timer);
    const latencyMs = Date.now() - start;
    if (resp.ok) {
      let version: string | null = null;
      try {
        const data = await resp.json() as { version?: string };
        version = data.version ?? null;
      } catch { /* ignore parse errors */ }
      return { healthy: true, version, latencyMs };
    }
    return { healthy: false, version: null, latencyMs };
  } catch {
    return { healthy: false, version: null, latencyMs: Date.now() - start };
  }
}

async function _runHealthChecks(): Promise<void> {
  const now = new Date().toISOString();
  for (const [url, peer] of _peers.entries()) {
    const { healthy, version, latencyMs } = await _checkPeerHealth(url);
    _peers.set(url, {
      ...peer,
      healthy,
      version,
      latencyMs,
      lastCheckedAt: now,
      lastSeenAt: healthy ? now : peer.lastSeenAt,
    });
    if (!healthy) {
      log.warn(`[consensusConfig] Peer ${url} is UNHEALTHY (latency: ${latencyMs}ms)`);
    }
  }
}

// ─── Peer Registration ────────────────────────────────────────────────────────

/**
 * Register a new peer node by URL. Performs an immediate health check.
 * Returns true if the peer is reachable, false otherwise.
 */
export async function registerPeer(url: string): Promise<boolean> {
  const normalizedUrl = url.replace(/\/$/, "");
  const { healthy, version, latencyMs } = await _checkPeerHealth(normalizedUrl);
  _peers.set(normalizedUrl, {
    url: normalizedUrl,
    healthy,
    version,
    latencyMs,
    lastCheckedAt: new Date().toISOString(),
    lastSeenAt: healthy ? new Date().toISOString() : null,
  });
  log.info(`[consensusConfig] Registered peer ${normalizedUrl} — healthy: ${healthy}`);
  return healthy;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Return all currently healthy peer nodes.
 */
export function getLivePeers(): PeerNode[] {
  return Array.from(_peers.values()).filter(p => p.healthy);
}

/**
 * Return all peer nodes (including unhealthy ones).
 */
export function getAllPeers(): PeerNode[] {
  return Array.from(_peers.values());
}

/**
 * Return the full consensus topology including quorum size and mode.
 */
export function getConsensusTopology(): ConsensusTopology {
  const peers = Array.from(_peers.values());
  const healthyNodes = peers.filter(p => p.healthy).length + 1; // +1 for self
  const totalNodes = peers.length + 1; // +1 for self
  const quorumSize = Math.floor(totalNodes / 2) + 1; // majority quorum

  let mode: ConsensusTopology["mode"];
  if (totalNodes === 1) {
    mode = "single-node";
  } else if (healthyNodes >= quorumSize) {
    mode = "distributed";
  } else {
    mode = "degraded";
  }

  return {
    selfUrl: _selfUrl,
    peers,
    totalNodes,
    healthyNodes,
    quorumSize,
    isDistributed: totalNodes > 1,
    mode,
  };
}

/**
 * Initialize the consensus config from environment variables.
 * Starts the periodic health check loop.
 * Called from initDaemons.ts.
 */
export function initConsensusConfig(): void {
  if (_initialized) return;
  _initialized = true;

  _selfUrl = process.env.CONSENSUS_SELF ?? null;
  const peersEnv = process.env.CONSENSUS_PEERS ?? "";

  if (!peersEnv.trim()) {
    log.info("[consensusConfig] No CONSENSUS_PEERS configured — running in single-node mode");
    return;
  }

  const peerUrls = peersEnv.split(",").map(u => u.trim()).filter(Boolean);
  log.info(`[consensusConfig] Configuring ${peerUrls.length} consensus peer(s)`);

  // Register all peers (async, don't block boot)
  Promise.all(peerUrls.map(url => registerPeer(url))).then(results => {
    const healthy = results.filter(Boolean).length;
    log.info(`[consensusConfig] Initial health check: ${healthy}/${peerUrls.length} peers healthy`);
    const topology = getConsensusTopology();
    log.info(`[consensusConfig] Consensus mode: ${topology.mode} (${topology.healthyNodes}/${topology.totalNodes} nodes, quorum: ${topology.quorumSize})`);
  }).catch(err => {
    log.warn(`[consensusConfig] Peer registration error: ${(err as Error).message}`);
  });

  // Start periodic health checks
  _healthCheckInterval = setInterval(() => {
    _runHealthChecks().catch(err => {
      log.warn(`[consensusConfig] Health check error: ${(err as Error).message}`);
    });
  }, HEALTH_CHECK_INTERVAL_MS);

  if (_healthCheckInterval.unref) _healthCheckInterval.unref();
}

/**
 * Reset state for testing.
 */
export function _resetConsensusConfigForTest(): void {
  _peers = new Map();
  _selfUrl = null;
  _initialized = false;
  if (_healthCheckInterval) {
    clearInterval(_healthCheckInterval);
    _healthCheckInterval = null;
  }
}
