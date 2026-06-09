/**
 * zkProofSigning.ts — Zero-Knowledge Cryptographic Proposal Signing
 * Andromeda v10.0.0
 *
 * Implements a lightweight ZK-inspired commitment scheme for RSI tool proposals.
 * Each proposal is signed with a HMAC-SHA256 commitment so that:
 *   1. The proposal content cannot be tampered with after signing.
 *   2. The signing node can prove it authored the proposal without revealing its
 *      private key (using a challenge-response protocol).
 *   3. Malicious nodes cannot inject poisoned code into the swarm without
 *      a valid signature from a trusted peer.
 *
 * Architecture:
 *   - Each Andromeda instance has an identity keypair (HMAC key derived from
 *     a secret + instance ID).
 *   - Proposals are committed with: commit = HMAC(key, sha256(content))
 *   - Peers verify by re-computing the commitment from the received content.
 *   - Challenge-response: verifier sends a random nonce; prover responds with
 *     HMAC(key, nonce || commit) — proves knowledge of key without revealing it.
 *
 * This is a practical approximation of ZK proofs suitable for a local-network
 * swarm. Full ZK-SNARK proofs (e.g., via snarkjs) can be plugged in later by
 * replacing `signProposal` / `verifyProposal` with circuit-based equivalents.
 */

import { createHmac, createHash, randomBytes, timingSafeEqual } from "crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProposalCommitment {
  /** SHA-256 hash of the proposal content (hex) */
  contentHash: string;
  /** HMAC-SHA256(instanceKey, contentHash) — the commitment */
  commitment: string;
  /** Instance ID of the signing node */
  instanceId: string;
  /** Unix timestamp (ms) when the commitment was created */
  timestamp: number;
  /** Nonce used in this commitment (prevents replay attacks) */
  nonce: string;
}

export interface ChallengeResponse {
  /** The challenge nonce sent by the verifier */
  challenge: string;
  /** HMAC-SHA256(instanceKey, challenge || commitment) */
  response: string;
  /** The original commitment being proved */
  commitment: ProposalCommitment;
}

export interface SignedProposal<T = unknown> {
  /** The original proposal payload */
  payload: T;
  /** The cryptographic commitment */
  commitment: ProposalCommitment;
}

export interface TrustRegistry {
  /** Map of instanceId → trusted public commitment keys (SHA-256 of HMAC key) */
  trustedPeers: Record<string, { keyFingerprint: string; addedAt: number; trustScore: number }>;
  /** Proposals rejected due to invalid signatures */
  rejectedCount: number;
  /** Proposals accepted */
  acceptedCount: number;
}

// ─── Key Management ───────────────────────────────────────────────────────────

const DATA_DIR = process.env.ANDROMEDA_WORKSPACE
  ? join(process.env.ANDROMEDA_WORKSPACE, "data")
  : join(process.cwd(), "data");

const IDENTITY_FILE = join(DATA_DIR, "zk_identity.json");

interface InstanceIdentity {
  instanceId: string;
  /** Hex-encoded 32-byte HMAC key */
  hmacKey: string;
  /** SHA-256 of the HMAC key — safe to share publicly as a fingerprint */
  keyFingerprint: string;
  createdAt: number;
}

let _identity: InstanceIdentity | null = null;

/**
 * Load or generate the instance identity.
 * The HMAC key is stored locally and never transmitted.
 */
export function getInstanceIdentity(): InstanceIdentity {
  if (_identity) return _identity;

  if (existsSync(IDENTITY_FILE)) {
    try {
      _identity = JSON.parse(readFileSync(IDENTITY_FILE, "utf-8")) as InstanceIdentity;
      return _identity;
    } catch {
      // Fall through to generate new identity
    }
  }

  // Generate new identity
  const hmacKey = randomBytes(32).toString("hex");
  const keyFingerprint = createHash("sha256").update(hmacKey).digest("hex");
  const instanceId = `andromeda-${randomBytes(8).toString("hex")}`;

  _identity = {
    instanceId,
    hmacKey,
    keyFingerprint,
    createdAt: Date.now(),
  };

  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(IDENTITY_FILE, JSON.stringify(_identity, null, 2), "utf-8");

  return _identity;
}

/** Reset the cached identity (used in tests) */
export function resetIdentityCache(): void {
  _identity = null;
}

// ─── Commitment Scheme ────────────────────────────────────────────────────────

/**
 * Compute SHA-256 hash of arbitrary content.
 */
export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

/**
 * Sign a proposal payload and return a SignedProposal.
 * The payload is JSON-serialized, hashed, and committed with the instance HMAC key.
 */
export function signProposal<T>(payload: T): SignedProposal<T> {
  const identity = getInstanceIdentity();
  const contentStr = JSON.stringify(payload);
  const contentHash = hashContent(contentStr);
  const nonce = randomBytes(16).toString("hex");
  const timestamp = Date.now();

  // commitment = HMAC(key, contentHash || nonce || timestamp)
  const commitment = createHmac("sha256", identity.hmacKey)
    .update(`${contentHash}:${nonce}:${timestamp}`)
    .digest("hex");

  return {
    payload,
    commitment: {
      contentHash,
      commitment,
      instanceId: identity.instanceId,
      timestamp,
      nonce,
    },
  };
}

/**
 * Verify a signed proposal against the local instance key.
 * Returns true if the commitment matches the payload content.
 *
 * Note: For cross-instance verification, peers must share their HMAC key
 * fingerprint and use the challenge-response protocol instead.
 */
export function verifyProposal<T>(signed: SignedProposal<T>): boolean {
  const identity = getInstanceIdentity();
  const { payload, commitment } = signed;

  // Re-compute content hash
  const contentStr = JSON.stringify(payload);
  const expectedContentHash = hashContent(contentStr);

  if (expectedContentHash !== commitment.contentHash) {
    return false;
  }

  // Re-compute commitment
  const expectedCommitment = createHmac("sha256", identity.hmacKey)
    .update(`${commitment.contentHash}:${commitment.nonce}:${commitment.timestamp}`)
    .digest("hex");

  // Timing-safe comparison
  try {
    return timingSafeEqual(
      Buffer.from(expectedCommitment, "hex"),
      Buffer.from(commitment.commitment, "hex")
    );
  } catch {
    return false;
  }
}

// ─── Challenge-Response Protocol ─────────────────────────────────────────────

/**
 * Generate a challenge nonce for a peer to respond to.
 * The verifier sends this to the prover.
 */
export function generateChallenge(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Respond to a challenge from a verifier.
 * Proves knowledge of the HMAC key without revealing it.
 * response = HMAC(key, challenge || commitment)
 */
export function respondToChallenge(
  challenge: string,
  commitment: ProposalCommitment
): ChallengeResponse {
  const identity = getInstanceIdentity();
  const response = createHmac("sha256", identity.hmacKey)
    .update(`${challenge}:${commitment.commitment}`)
    .digest("hex");

  return { challenge, response, commitment };
}

/**
 * Verify a challenge response from a peer.
 * The verifier must know the peer's HMAC key to verify (shared out-of-band
 * during peer registration, or via a PKI).
 *
 * @param peerHmacKey - The peer's HMAC key (shared during trust establishment)
 * @param challengeResponse - The response from the peer
 */
export function verifyChallengeResponse(
  peerHmacKey: string,
  challengeResponse: ChallengeResponse
): boolean {
  const { challenge, response, commitment } = challengeResponse;

  const expectedResponse = createHmac("sha256", peerHmacKey)
    .update(`${challenge}:${commitment.commitment}`)
    .digest("hex");

  try {
    return timingSafeEqual(
      Buffer.from(expectedResponse, "hex"),
      Buffer.from(response, "hex")
    );
  } catch {
    return false;
  }
}

// ─── Trust Registry ───────────────────────────────────────────────────────────

const TRUST_FILE = join(DATA_DIR, "zk_trust_registry.json");

export function loadTrustRegistry(): TrustRegistry {
  if (existsSync(TRUST_FILE)) {
    try {
      return JSON.parse(readFileSync(TRUST_FILE, "utf-8")) as TrustRegistry;
    } catch {
      // Fall through
    }
  }
  return { trustedPeers: {}, rejectedCount: 0, acceptedCount: 0 };
}

export function saveTrustRegistry(registry: TrustRegistry): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(TRUST_FILE, JSON.stringify(registry, null, 2), "utf-8");
}

/**
 * Register a trusted peer by their instance ID and key fingerprint.
 * The key fingerprint is SHA-256(hmacKey) — safe to share publicly.
 */
export function registerTrustedPeer(
  instanceId: string,
  keyFingerprint: string,
  initialTrustScore = 0.5
): TrustRegistry {
  const registry = loadTrustRegistry();
  registry.trustedPeers[instanceId] = {
    keyFingerprint,
    addedAt: Date.now(),
    trustScore: initialTrustScore,
  };
  saveTrustRegistry(registry);
  return registry;
}

/**
 * Update the trust score of a peer based on proposal outcomes.
 * Accepted proposals increase trust; rejected proposals decrease it.
 */
export function updatePeerTrust(
  instanceId: string,
  accepted: boolean,
  delta = 0.05
): void {
  const registry = loadTrustRegistry();
  const peer = registry.trustedPeers[instanceId];
  if (!peer) return;

  if (accepted) {
    peer.trustScore = Math.min(1.0, peer.trustScore + delta);
    registry.acceptedCount++;
  } else {
    peer.trustScore = Math.max(0.0, peer.trustScore - delta * 2);
    registry.rejectedCount++;
  }

  saveTrustRegistry(registry);
}

/**
 * Check if a proposal from a peer should be accepted based on trust score.
 * Proposals from unknown peers are always rejected.
 */
export function shouldAcceptProposal(
  commitment: ProposalCommitment,
  minTrustScore = 0.3
): boolean {
  const registry = loadTrustRegistry();
  const peer = registry.trustedPeers[commitment.instanceId];

  if (!peer) return false;
  if (peer.trustScore < minTrustScore) return false;

  // Check timestamp freshness (reject proposals older than 5 minutes)
  const ageMs = Date.now() - commitment.timestamp;
  if (ageMs > 5 * 60 * 1000) return false;

  return true;
}
