/**
 * cryptographicVerifier.ts — v62.0.0 "The Security Vault"
 * Verifies data integrity using hash-based signatures and HMAC-style verification.
 */

import { createHash, createHmac } from "crypto";

export interface SignedPayload { payloadId: string; data: string; signature: string; algorithm: string; timestamp: number; }
export interface VerificationResult { verificationId: string; payloadId: string; valid: boolean; reason: string; }

const payloads = new Map<string, SignedPayload>();
const verifications: VerificationResult[] = [];
let pCounter = 0, vCounter = 0;
const SECRET = "andromeda-v62-secret-key";

export function signPayload(data: string, algorithm: "sha256" | "sha512" = "sha256"): SignedPayload {
  const signature = createHmac(algorithm, SECRET).update(data).digest("hex");
  const payload: SignedPayload = { payloadId: `pay-${++pCounter}`, data, signature, algorithm, timestamp: Date.now() };
  payloads.set(payload.payloadId, payload);
  return payload;
}

export function verifyPayload(payloadId: string, data: string): VerificationResult {
  const payload = payloads.get(payloadId);
  if (!payload) {
    const result: VerificationResult = { verificationId: `ver-${++vCounter}`, payloadId, valid: false, reason: "payload_not_found" };
    verifications.push(result);
    return result;
  }
  const expectedSig = createHmac(payload.algorithm, SECRET).update(data).digest("hex");
  const valid = expectedSig === payload.signature;
  const result: VerificationResult = { verificationId: `ver-${++vCounter}`, payloadId, valid, reason: valid ? "signature_match" : "signature_mismatch" };
  verifications.push(result);
  return result;
}

export function hashData(data: string, algorithm: "md5" | "sha256" | "sha512" = "sha256"): string {
  return createHash(algorithm).update(data).digest("hex");
}

export function _resetCryptographicVerifierForTest(): void { payloads.clear(); verifications.length = 0; pCounter = 0; vCounter = 0; }
