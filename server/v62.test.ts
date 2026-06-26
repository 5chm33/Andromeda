/**
 * v62.test.ts — The Security Vault
 */
import { describe, it, expect, beforeEach } from "vitest";
import { registerSignature, detectThreats, getDetections, _resetThreatDetectorForTest } from "./threatDetector";
import { recordBaseline, evaluateAnomaly, _resetAnomalyIsolatorForTest } from "./anomalyIsolator";
import { signPayload, verifyPayload, hashData, _resetCryptographicVerifierForTest } from "./cryptographicVerifier";
import { defineRole, assignRole, checkAccess, _resetAccessControlManagerForTest } from "./accessControlManager";
import { logAuditEvent, verifyTrailIntegrity, generateComplianceReport, getTrail, _resetAuditTrailEnforcerForTest } from "./auditTrailEnforcer";
import { registerPatch, stagePatch, applyPatch, rollbackPatch, getPatchSummary, _resetSecurityPatchApplierForTest } from "./securityPatchApplier";

beforeEach(() => {
  _resetThreatDetectorForTest();
  _resetAnomalyIsolatorForTest();
  _resetCryptographicVerifierForTest();
  _resetAccessControlManagerForTest();
  _resetAuditTrailEnforcerForTest();
  _resetSecurityPatchApplierForTest();
});

describe("threatDetector", () => {
  it("detects a known threat signature", () => {
    registerSignature("DROP TABLE", "critical", "sql_injection");
    const result = detectThreats("SELECT * FROM users; DROP TABLE users;");
    expect(result.matchedSignatures).toHaveLength(1);
    expect(result.threatLevel).toBe("critical");
    expect(result.blocked).toBe(true);
  });

  it("returns low score for clean input", () => {
    registerSignature("malware", "high", "malware");
    const result = detectThreats("Hello, world!");
    expect(result.score).toBe(0);
    expect(result.blocked).toBe(false);
  });

  it("tracks detections", () => {
    detectThreats("clean input");
    expect(getDetections()).toHaveLength(1);
  });
});

describe("anomalyIsolator", () => {
  it("isolates anomalous values", () => {
    for (let i = 0; i < 10; i++) recordBaseline("cpu", 50 + i * 0.5);
    const result = evaluateAnomaly("cpu", 200, 2.5);
    expect(result.isolated).toBe(true);
    expect(result.anomalyScore).toBeGreaterThan(2.5);
  });

  it("does not isolate normal values", () => {
    for (let i = 0; i < 10; i++) recordBaseline("mem", 60 + i);
    const result = evaluateAnomaly("mem", 65, 2.5);
    expect(result.isolated).toBe(false);
  });

  it("handles no baseline gracefully", () => {
    const result = evaluateAnomaly("unknown", 100, 2.5);
    expect(result.reason).toBe("no_baseline");
    expect(result.isolated).toBe(false);
  });
});

describe("cryptographicVerifier", () => {
  it("signs and verifies a payload", () => {
    const payload = signPayload("sensitive data");
    const result = verifyPayload(payload.payloadId, "sensitive data");
    expect(result.valid).toBe(true);
    expect(result.reason).toBe("signature_match");
  });

  it("detects tampered data", () => {
    const payload = signPayload("original data");
    const result = verifyPayload(payload.payloadId, "tampered data");
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("signature_mismatch");
  });

  it("hashes data consistently", () => {
    const h1 = hashData("test");
    const h2 = hashData("test");
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64); // sha256 hex
  });

  it("returns invalid for unknown payload", () => {
    const result = verifyPayload("nonexistent", "data");
    expect(result.valid).toBe(false);
  });
});

describe("accessControlManager", () => {
  it("grants access with correct permission", () => {
    const adminRole = defineRole("admin", ["read", "write", "admin"]);
    assignRole("alice", adminRole.roleId);
    const decision = checkAccess("alice", "/api/users", "write");
    expect(decision.granted).toBe(true);
  });

  it("denies access without permission", () => {
    const readRole = defineRole("reader", ["read"]);
    assignRole("bob", readRole.roleId);
    const decision = checkAccess("bob", "/api/users", "delete");
    expect(decision.granted).toBe(false);
  });

  it("inherits permissions from parent role", () => {
    const baseRole = defineRole("base", ["read"]);
    const extendedRole = defineRole("extended", ["write"], [baseRole.roleId]);
    assignRole("carol", extendedRole.roleId);
    const decision = checkAccess("carol", "/api/data", "read");
    expect(decision.granted).toBe(true);
  });

  it("denies access for user with no roles", () => {
    const decision = checkAccess("nobody", "/api/data", "read");
    expect(decision.granted).toBe(false);
  });
});

describe("auditTrailEnforcer", () => {
  it("logs audit events", () => {
    logAuditEvent("user1", "access", "/api/data", "success");
    expect(getTrail()).toHaveLength(1);
  });

  it("verifies trail integrity", () => {
    logAuditEvent("user1", "modification", "/api/config", "success");
    logAuditEvent("user2", "authentication", "/login", "failure");
    expect(verifyTrailIntegrity()).toBe(true);
  });

  it("generates compliance report", () => {
    const now = Date.now();
    logAuditEvent("u1", "access", "/api", "success");
    logAuditEvent("u1", "access", "/api", "failure");
    const report = generateComplianceReport(now - 1000, now + 1000);
    expect(report.totalEvents).toBe(2);
    expect(report.failureRate).toBe(0.5);
    expect(report.topUsers).toContain("u1");
  });
});

describe("securityPatchApplier", () => {
  it("applies a staged patch successfully", () => {
    const patch = registerPatch("CVE-2024-001", "critical", "Remote code execution");
    stagePatch(patch.patchId);
    const result = applyPatch(patch.patchId, 0.95);
    expect(result.success).toBe(true);
    expect(result.newStatus).toBe("applied");
  });

  it("fails to apply unstaged patch", () => {
    const patch = registerPatch("CVE-2024-002", "high", "XSS vulnerability");
    const result = applyPatch(patch.patchId, 0.95);
    expect(result.success).toBe(false);
    expect(result.newStatus).toBe("failed");
  });

  it("rolls back applied patch", () => {
    const patch = registerPatch("CVE-2024-003", "medium", "Info disclosure");
    stagePatch(patch.patchId);
    applyPatch(patch.patchId, 0.9);
    const rolledBack = rollbackPatch(patch.patchId);
    expect(rolledBack).toBe(true);
  });

  it("tracks patch summary", () => {
    const p1 = registerPatch("CVE-001", "low", "Minor issue");
    const p2 = registerPatch("CVE-002", "high", "Major issue");
    stagePatch(p2.patchId);
    applyPatch(p2.patchId, 0.9);
    const summary = getPatchSummary();
    expect(summary.total).toBe(2);
    expect(summary.applied).toBe(1);
    expect(summary.pending).toBe(1);
  });
});
