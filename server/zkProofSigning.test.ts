import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import os from "os";

// Use a temp directory for all ZK tests
let tmpDir: string;

beforeEach(() => {
  tmpDir = join(os.tmpdir(), `zk-test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  process.env.ANDROMEDA_WORKSPACE = tmpDir;
});

afterEach(async () => {
  // Reset the identity cache so each test gets a fresh identity
  const { resetIdentityCache } = await import("./zkProofSigning.js");
  resetIdentityCache();
  vi.resetModules();
  delete process.env.ANDROMEDA_WORKSPACE;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("zkProofSigning", () => {
  describe("getInstanceIdentity", () => {
    it("generates a new identity on first call", async () => {
      const { getInstanceIdentity } = await import("./zkProofSigning.js");
      const identity = getInstanceIdentity();

      expect(identity.instanceId).toMatch(/^andromeda-[0-9a-f]{16}$/);
      expect(identity.hmacKey).toHaveLength(64); // 32 bytes hex
      expect(identity.keyFingerprint).toHaveLength(64); // SHA-256 hex
      expect(identity.createdAt).toBeGreaterThan(0);
    });

    it("returns the same identity on subsequent calls (cached)", async () => {
      const { getInstanceIdentity } = await import("./zkProofSigning.js");
      const id1 = getInstanceIdentity();
      const id2 = getInstanceIdentity();
      expect(id1.instanceId).toBe(id2.instanceId);
      expect(id1.hmacKey).toBe(id2.hmacKey);
    });

    it("persists identity to disk and reloads it", async () => {
      const { getInstanceIdentity, resetIdentityCache } = await import("./zkProofSigning.js");
      const id1 = getInstanceIdentity();
      resetIdentityCache();
      const id2 = getInstanceIdentity();
      expect(id1.instanceId).toBe(id2.instanceId);
      expect(id1.hmacKey).toBe(id2.hmacKey);
    });
  });

  describe("hashContent", () => {
    it("returns a 64-char hex SHA-256 hash", async () => {
      const { hashContent } = await import("./zkProofSigning.js");
      const hash = hashContent("hello world");
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[0-9a-f]+$/);
    });

    it("produces different hashes for different inputs", async () => {
      const { hashContent } = await import("./zkProofSigning.js");
      expect(hashContent("abc")).not.toBe(hashContent("def"));
    });

    it("produces the same hash for the same input", async () => {
      const { hashContent } = await import("./zkProofSigning.js");
      expect(hashContent("test")).toBe(hashContent("test"));
    });
  });

  describe("signProposal / verifyProposal", () => {
    it("signs a proposal and verifies it successfully", async () => {
      const { signProposal, verifyProposal } = await import("./zkProofSigning.js");
      const payload = { type: "add_function", code: "export function hello() { return 'hi'; }" };
      const signed = signProposal(payload);

      expect(signed.payload).toEqual(payload);
      expect(signed.commitment.contentHash).toHaveLength(64);
      expect(signed.commitment.commitment).toHaveLength(64);
      expect(signed.commitment.nonce).toHaveLength(32);
      expect(signed.commitment.timestamp).toBeGreaterThan(0);

      expect(verifyProposal(signed)).toBe(true);
    });

    it("fails verification when payload is tampered", async () => {
      const { signProposal, verifyProposal } = await import("./zkProofSigning.js");
      const signed = signProposal({ code: "original code" });

      // Tamper with the payload
      const tampered = {
        ...signed,
        payload: { code: "malicious code" },
      };

      expect(verifyProposal(tampered)).toBe(false);
    });

    it("fails verification when commitment is tampered", async () => {
      const { signProposal, verifyProposal } = await import("./zkProofSigning.js");
      const signed = signProposal({ code: "some code" });

      const tampered = {
        ...signed,
        commitment: {
          ...signed.commitment,
          commitment: "a".repeat(64), // Fake commitment
        },
      };

      expect(verifyProposal(tampered)).toBe(false);
    });

    it("signs different payloads with different commitments", async () => {
      const { signProposal } = await import("./zkProofSigning.js");
      const s1 = signProposal({ code: "foo" });
      const s2 = signProposal({ code: "bar" });
      expect(s1.commitment.contentHash).not.toBe(s2.commitment.contentHash);
      expect(s1.commitment.commitment).not.toBe(s2.commitment.commitment);
    });
  });

  describe("challenge-response protocol", () => {
    it("generates a 64-char hex challenge", async () => {
      const { generateChallenge } = await import("./zkProofSigning.js");
      const challenge = generateChallenge();
      expect(challenge).toHaveLength(64);
      expect(challenge).toMatch(/^[0-9a-f]+$/);
    });

    it("responds to a challenge and verifies correctly", async () => {
      const { signProposal, generateChallenge, respondToChallenge, verifyChallengeResponse, getInstanceIdentity } =
        await import("./zkProofSigning.js");

      const identity = getInstanceIdentity();
      const signed = signProposal({ code: "test" });
      const challenge = generateChallenge();
      const response = respondToChallenge(challenge, signed.commitment);

      expect(response.challenge).toBe(challenge);
      expect(response.response).toHaveLength(64);

      // Verify using the peer's HMAC key (shared out-of-band)
      const valid = verifyChallengeResponse(identity.hmacKey, response);
      expect(valid).toBe(true);
    });

    it("rejects a challenge response with wrong key", async () => {
      const { signProposal, generateChallenge, respondToChallenge, verifyChallengeResponse } =
        await import("./zkProofSigning.js");

      const signed = signProposal({ code: "test" });
      const challenge = generateChallenge();
      const response = respondToChallenge(challenge, signed.commitment);

      // Use wrong key
      const wrongKey = "b".repeat(64);
      const valid = verifyChallengeResponse(wrongKey, response);
      expect(valid).toBe(false);
    });
  });

  describe("trust registry", () => {
    it("registers a trusted peer", async () => {
      const { registerTrustedPeer, loadTrustRegistry } = await import("./zkProofSigning.js");
      registerTrustedPeer("peer-001", "a".repeat(64), 0.7);
      const registry = loadTrustRegistry();
      expect(registry.trustedPeers["peer-001"]).toBeDefined();
      expect(registry.trustedPeers["peer-001"].trustScore).toBe(0.7);
      expect(registry.trustedPeers["peer-001"].keyFingerprint).toBe("a".repeat(64));
    });

    it("updates peer trust score on accepted proposal", async () => {
      const { registerTrustedPeer, updatePeerTrust, loadTrustRegistry } = await import("./zkProofSigning.js");
      registerTrustedPeer("peer-002", "b".repeat(64), 0.5);
      updatePeerTrust("peer-002", true, 0.1);
      const registry = loadTrustRegistry();
      expect(registry.trustedPeers["peer-002"].trustScore).toBeCloseTo(0.6, 5);
      expect(registry.acceptedCount).toBe(1);
    });

    it("decreases peer trust score on rejected proposal", async () => {
      const { registerTrustedPeer, updatePeerTrust, loadTrustRegistry } = await import("./zkProofSigning.js");
      registerTrustedPeer("peer-003", "c".repeat(64), 0.8);
      updatePeerTrust("peer-003", false, 0.1);
      const registry = loadTrustRegistry();
      expect(registry.trustedPeers["peer-003"].trustScore).toBeCloseTo(0.6, 5);
      expect(registry.rejectedCount).toBe(1);
    });

    it("shouldAcceptProposal returns false for unknown peer", async () => {
      const { signProposal, shouldAcceptProposal } = await import("./zkProofSigning.js");
      const signed = signProposal({ code: "test" });
      expect(shouldAcceptProposal(signed.commitment)).toBe(false);
    });

    it("shouldAcceptProposal returns true for trusted peer with fresh commitment", async () => {
      const { signProposal, shouldAcceptProposal, registerTrustedPeer, getInstanceIdentity } =
        await import("./zkProofSigning.js");
      const identity = getInstanceIdentity();
      registerTrustedPeer(identity.instanceId, identity.keyFingerprint, 0.9);
      const signed = signProposal({ code: "test" });
      expect(shouldAcceptProposal(signed.commitment)).toBe(true);
    });

    it("shouldAcceptProposal returns false for low-trust peer", async () => {
      const { signProposal, shouldAcceptProposal, registerTrustedPeer, getInstanceIdentity } =
        await import("./zkProofSigning.js");
      const identity = getInstanceIdentity();
      registerTrustedPeer(identity.instanceId, identity.keyFingerprint, 0.1); // Below 0.3 threshold
      const signed = signProposal({ code: "test" });
      expect(shouldAcceptProposal(signed.commitment)).toBe(false);
    });
  });
});
