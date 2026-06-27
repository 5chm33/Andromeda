/**
 * v74.test.ts — Privacy & Data Protection
 * Comprehensive tests for all 6 v74 modules.
 */
import { describe, it, expect, beforeEach } from "vitest";

import { initPrivacyEngine, evaluatePrivacy, registerPolicy, getPrivacyDecisions, getPolicies, _resetPrivacyEngineForTest } from "./privacyEngine";
import { redactPii, getRedactionHistory, _resetPiiRedactorForTest } from "./piiRedactor";
import { grantConsent, withdrawConsent, hasConsent, getConsentHistory, _resetConsentManagerForTest } from "./consentManager";
import { addRetentionRule, registerDataRecord, enforceRetention, getRetentionRules, getDataRecords, _resetDataRetentionPolicyForTest } from "./dataRetentionPolicy";
import { runAnonymizationPipeline, getPipelineHistory, _resetAnonymizationPipelineForTest } from "./anonymizationPipeline";
import { checkGdprCompliance, getComplianceReport, _resetGdprComplianceCheckerForTest } from "./gdprComplianceChecker";

// ─── privacyEngine ───────────────────────────────────────────────────────────
describe("privacyEngine", () => {
  beforeEach(() => _resetPrivacyEngineForTest());

  it("initializes with default policies", () => {
    initPrivacyEngine();
    const policies = getPolicies();
    expect(policies.length).toBeGreaterThan(0);
    expect(policies.some(p => p.dataCategory === "pii")).toBe(true);
  });

  it("evaluates PII data as redact with consent", () => {
    initPrivacyEngine();
    const decision = evaluatePrivacy("pii", true);
    expect(decision.action).toBe("redact");
    expect(decision.dataCategory).toBe("pii");
  });

  it("blocks PII data without consent", () => {
    initPrivacyEngine();
    const decision = evaluatePrivacy("pii", false);
    expect(decision.action).toBe("block");
  });

  it("allows public data without consent", () => {
    initPrivacyEngine();
    const decision = evaluatePrivacy("public", false);
    expect(decision.action).toBe("allow");
  });

  it("registers custom policies", () => {
    _resetPrivacyEngineForTest();
    registerPolicy({ policyId: "custom-1", name: "Custom", dataCategory: "internal", action: "anonymize", retentionDays: 60, requiresConsent: false });
    const decision = evaluatePrivacy("internal", false);
    expect(decision.action).toBe("anonymize");
  });

  it("accumulates decisions", () => {
    initPrivacyEngine();
    evaluatePrivacy("pii", true);
    evaluatePrivacy("public", false);
    expect(getPrivacyDecisions().length).toBe(2);
  });
});

// ─── piiRedactor ─────────────────────────────────────────────────────────────
describe("piiRedactor", () => {
  beforeEach(() => _resetPiiRedactorForTest());

  it("redacts email addresses", () => {
    const result = redactPii("Contact me at alice@example.com for details.");
    expect(result.redactedText).toContain("[EMAIL]");
    expect(result.redactedText).not.toContain("alice@example.com");
    expect(result.matches.some(m => m.piiType === "email")).toBe(true);
  });

  it("redacts SSN patterns", () => {
    const result = redactPii("My SSN is 123-45-6789.");
    expect(result.redactedText).toContain("[SSN]");
    expect(result.matches.some(m => m.piiType === "ssn")).toBe(true);
  });

  it("redacts IP addresses", () => {
    const result = redactPii("Server at 192.168.1.1 is down.");
    expect(result.redactedText).toContain("[IP_ADDRESS]");
  });

  it("handles text with no PII", () => {
    const result = redactPii("The sky is blue today.");
    expect(result.redactedText).toBe("The sky is blue today.");
    expect(result.redactionCount).toBe(0);
  });

  it("accumulates redaction history", () => {
    redactPii("test@test.com");
    redactPii("another@test.com");
    expect(getRedactionHistory().length).toBe(2);
  });

  it("resets cleanly", () => {
    redactPii("test@test.com");
    _resetPiiRedactorForTest();
    expect(getRedactionHistory().length).toBe(0);
  });
});

// ─── consentManager ──────────────────────────────────────────────────────────
describe("consentManager", () => {
  beforeEach(() => _resetConsentManagerForTest());

  it("grants consent and reports it", () => {
    const record = grantConsent("user-1", "analytics");
    expect(record.status).toBe("granted");
    expect(hasConsent("user-1", "analytics")).toBe(true);
  });

  it("denies consent after withdrawal", () => {
    grantConsent("user-2", "marketing");
    expect(hasConsent("user-2", "marketing")).toBe(true);
    const withdrawn = withdrawConsent("user-2", "marketing");
    expect(withdrawn).toBe(true);
    expect(hasConsent("user-2", "marketing")).toBe(false);
  });

  it("returns false for non-existent consent", () => {
    expect(hasConsent("user-99", "research")).toBe(false);
  });

  it("returns false for withdrawal of non-existent consent", () => {
    const result = withdrawConsent("user-99", "personalization");
    expect(result).toBe(false);
  });

  it("tracks consent history per user", () => {
    grantConsent("user-3", "analytics");
    grantConsent("user-3", "marketing");
    const history = getConsentHistory("user-3");
    expect(history.length).toBe(2);
  });

  it("resets cleanly", () => {
    grantConsent("user-4", "analytics");
    _resetConsentManagerForTest();
    expect(hasConsent("user-4", "analytics")).toBe(false);
  });
});

// ─── dataRetentionPolicy ─────────────────────────────────────────────────────
describe("dataRetentionPolicy", () => {
  beforeEach(() => _resetDataRetentionPolicyForTest());

  it("adds retention rules and registers records", () => {
    addRetentionRule("user_logs", 30, true, "legitimate_interests");
    const record = registerDataRecord("user_logs");
    expect(record.dataType).toBe("user_logs");
    expect(record.deleted).toBe(false);
  });

  it("enforces retention and deletes expired records", () => {
    addRetentionRule("temp_data", 1, true, "consent");
    const record = registerDataRecord("temp_data");
    // Simulate expiry by passing a future time
    const futureMs = record.expiresAt + 1000;
    const { deleted } = enforceRetention(futureMs);
    expect(deleted).toBe(1);
    expect(getDataRecords().find(r => r.recordId === record.recordId)?.deleted).toBe(true);
  });

  it("retains non-expired records", () => {
    addRetentionRule("active_data", 365, true, "contract");
    registerDataRecord("active_data");
    const { retained } = enforceRetention(Date.now());
    expect(retained).toBe(1);
  });

  it("uses default 30-day retention for unknown types", () => {
    const record = registerDataRecord("unknown_type");
    expect(record.expiresAt).toBeGreaterThan(Date.now());
  });

  it("returns retention rules", () => {
    addRetentionRule("type_a", 90, false, "legal_obligation");
    expect(getRetentionRules().length).toBe(1);
  });

  it("resets cleanly", () => {
    addRetentionRule("x", 10, true, "consent");
    registerDataRecord("x");
    _resetDataRetentionPolicyForTest();
    expect(getRetentionRules().length).toBe(0);
    expect(getDataRecords().length).toBe(0);
  });
});

// ─── anonymizationPipeline ───────────────────────────────────────────────────
describe("anonymizationPipeline", () => {
  beforeEach(() => _resetAnonymizationPipelineForTest());

  it("pseudonymizes a field", () => {
    const rows = [{ name: "Alice" }, { name: "Bob" }];
    const { rows: output, result } = runAnonymizationPipeline(rows, [{ field: "name", technique: "pseudonymize" }]);
    expect(output[0].name).not.toBe("Alice");
    expect(String(output[0].name)).toMatch(/^pseudo-/);
    expect(result.anonymizedFields).toContain("name");
  });

  it("generalizes a field using a map", () => {
    const rows = [{ age: "25" }, { age: "35" }];
    const { rows: output } = runAnonymizationPipeline(rows, [{
      field: "age", technique: "generalize",
      generalizationMap: { "25": "20-30", "35": "30-40" },
    }]);
    expect(output[0].age).toBe("20-30");
    expect(output[1].age).toBe("30-40");
  });

  it("suppresses rows with empty field", () => {
    const rows = [{ id: "1", value: "" }, { id: "2", value: "hello" }];
    const { rows: output, result } = runAnonymizationPipeline(rows, [{ field: "value", technique: "suppress" }]);
    expect(output.length).toBe(1);
    expect(result.suppressedRows).toBe(1);
  });

  it("adds noise to numeric fields", () => {
    const rows = [{ score: 100 }];
    const { rows: output } = runAnonymizationPipeline(rows, [{ field: "score", technique: "noise", noiseRange: 5 }]);
    expect(Number(output[0].score)).not.toBe(100);
  });

  it("accumulates pipeline history", () => {
    runAnonymizationPipeline([{ x: "1" }], [{ field: "x", technique: "pseudonymize" }]);
    runAnonymizationPipeline([{ y: "2" }], [{ field: "y", technique: "pseudonymize" }]);
    expect(getPipelineHistory().length).toBe(2);
  });

  it("resets cleanly", () => {
    runAnonymizationPipeline([{ x: "1" }], [{ field: "x", technique: "pseudonymize" }]);
    _resetAnonymizationPipelineForTest();
    expect(getPipelineHistory().length).toBe(0);
  });
});

// ─── gdprComplianceChecker ───────────────────────────────────────────────────
describe("gdprComplianceChecker", () => {
  beforeEach(() => _resetGdprComplianceCheckerForTest());

  it("marks compliant operation as compliant", () => {
    const check = checkGdprCompliance({
      operation: "user_analytics",
      lawfulBasis: "consent",
      hasConsent: true,
      dataMinimized: true,
      purposeLimited: true,
      retentionDefined: true,
    });
    expect(check.compliant).toBe(true);
    expect(check.violations.length).toBe(0);
  });

  it("detects missing consent violation", () => {
    const check = checkGdprCompliance({
      operation: "marketing_email",
      lawfulBasis: "consent",
      hasConsent: false,
      dataMinimized: true,
      purposeLimited: true,
      retentionDefined: true,
    });
    expect(check.compliant).toBe(false);
    expect(check.violations).toContain("Consent required but not obtained");
  });

  it("detects data minimization violation", () => {
    const check = checkGdprCompliance({
      operation: "data_export",
      lawfulBasis: "contract",
      hasConsent: false,
      dataMinimized: false,
      purposeLimited: true,
      retentionDefined: true,
    });
    expect(check.violations).toContain("Data minimization principle violated");
  });

  it("detects multiple violations simultaneously", () => {
    const check = checkGdprCompliance({
      operation: "bulk_export",
      lawfulBasis: "consent",
      hasConsent: false,
      dataMinimized: false,
      purposeLimited: false,
      retentionDefined: false,
    });
    expect(check.violations.length).toBe(4);
  });

  it("generates compliance report", () => {
    checkGdprCompliance({ operation: "op1", lawfulBasis: "contract", hasConsent: false, dataMinimized: true, purposeLimited: true, retentionDefined: true });
    checkGdprCompliance({ operation: "op2", lawfulBasis: "consent", hasConsent: true, dataMinimized: true, purposeLimited: true, retentionDefined: true });
    const report = getComplianceReport();
    expect(report.total).toBe(2);
    expect(report.compliant).toBe(2);
  });

  it("resets cleanly", () => {
    checkGdprCompliance({ operation: "op1", lawfulBasis: "contract", hasConsent: false, dataMinimized: true, purposeLimited: true, retentionDefined: true });
    _resetGdprComplianceCheckerForTest();
    expect(getComplianceReport().total).toBe(0);
  });
});
