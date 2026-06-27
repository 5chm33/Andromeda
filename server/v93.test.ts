/**
 * v93.test.ts — Ethical Reasoning & AI Safety
 */
import { describe, it, expect, beforeEach } from "vitest";

import { addPrinciple, evaluateAction, getPrinciples, getEvaluations, _resetEthicsEngineForTest } from "./ethicsEngine";
import { addConstraint, checkAction, getConstraints, getResults, _resetSafetyConstraintCheckerForTest } from "./safetyConstraintChecker";
import { registerValue, updateAlignment, generateAlignmentReport, getValue, getReports, _resetValueAlignmentMonitorForTest } from "./valueAlignmentMonitor";
import { addHarmPattern, filterContent, getPatterns, getFilterResults, _resetHarmPreventionFilterForTest } from "./harmPreventionFilter";
import { registerAgent, issueOverride, acknowledgeOverride, resume, getState, getOverrides, _resetCorrigibilityManagerForTest } from "./corrigibilityManager";
import { createAudit, addFinding, completeAudit, getAudits, _resetEthicsAuditorForTest } from "./ethicsAuditor";

// ─── ethicsEngine ─────────────────────────────────────────────────────────────
describe("ethicsEngine", () => {
  beforeEach(() => _resetEthicsEngineForTest());

  it("adds ethical principles", () => {
    const p = addPrinciple("Do No Harm", "deontological", "Avoid causing harm", 1.0);
    expect(p.principleId).toMatch(/^ep-/);
    expect(getPrinciples().length).toBe(1);
  });

  it("evaluates action as approved", () => {
    const p = addPrinciple("Beneficence", "utilitarian", "Maximize benefit", 1.0);
    const result = evaluateAction("agent-1", "Help user", { [p.principleId]: 0.9 });
    expect(result.verdict).toBe("approved");
  });

  it("evaluates action as rejected", () => {
    const p = addPrinciple("Non-maleficence", "deontological", "Do no harm", 1.0);
    const result = evaluateAction("agent-2", "Harm user", { [p.principleId]: 0.1 });
    expect(result.verdict).toBe("rejected");
  });

  it("evaluates action as flagged", () => {
    const p = addPrinciple("Autonomy", "virtue_ethics", "Respect autonomy", 1.0);
    const result = evaluateAction("agent-3", "Borderline action", { [p.principleId]: 0.5 });
    expect(["flagged", "conditional"]).toContain(result.verdict);
  });

  it("filters principles by framework", () => {
    addPrinciple("P1", "utilitarian", "desc", 1.0);
    addPrinciple("P2", "deontological", "desc", 1.0);
    expect(getPrinciples("utilitarian").length).toBe(1);
  });
});

// ─── safetyConstraintChecker ──────────────────────────────────────────────────
describe("safetyConstraintChecker", () => {
  beforeEach(() => _resetSafetyConstraintCheckerForTest());

  it("adds a constraint", () => {
    const c = addConstraint("No self-harm", "hard", "Prevent self-harm", () => true, "critical");
    expect(c.constraintId).toMatch(/^sc-/);
  });

  it("passes action with no violations", () => {
    addConstraint("Safe action", "hard", "Must be safe", (a) => Boolean(a["safe"]), "critical");
    const result = checkAction("act-1", { safe: true });
    expect(result.passed).toBe(true);
    expect(result.violations.length).toBe(0);
  });

  it("blocks action with critical violation", () => {
    addConstraint("No harm", "hard", "No harmful actions", (a) => !a["harmful"], "critical");
    const result = checkAction("act-2", { harmful: true });
    expect(result.passed).toBe(false);
    expect(result.violations[0].severity).toBe("critical");
  });

  it("adds advisory warning without blocking", () => {
    addConstraint("Prefer caution", "advisory", "Be cautious", (a) => Boolean(a["cautious"]), "warning");
    const result = checkAction("act-3", { cautious: false });
    expect(result.passed).toBe(true);
    expect(result.warnings.length).toBe(1);
  });

  it("filters results by pass/fail", () => {
    addConstraint("C", "hard", "d", () => false, "error");
    checkAction("a1", {});
    expect(getResults(false).length).toBe(1);
  });
});

// ─── valueAlignmentMonitor ────────────────────────────────────────────────────
describe("valueAlignmentMonitor", () => {
  beforeEach(() => _resetValueAlignmentMonitorForTest());

  it("registers a human value", () => {
    const v = registerValue("Honesty", "Be truthful", 1.0);
    expect(v.valueId).toMatch(/^hv-/);
    expect(v.currentAlignmentScore).toBe(1.0);
  });

  it("updates alignment score", () => {
    const v = registerValue("Fairness", "Treat equally", 1.0);
    updateAlignment(v.valueId, 0.7);
    expect(getValue(v.valueId)!.currentAlignmentScore).toBe(0.7);
  });

  it("generates alignment report", () => {
    const v1 = registerValue("V1", "d", 1.0);
    const v2 = registerValue("V2", "d", 1.0);
    updateAlignment(v1.valueId, 0.9);
    updateAlignment(v2.valueId, 0.4);
    const report = generateAlignmentReport("agent-1");
    expect(report.driftedValues).toContain("V2");
    expect(report.alignedValues).toContain("V1");
  });

  it("includes recommendations for drifted values", () => {
    const v = registerValue("Safety", "Be safe", 1.0);
    updateAlignment(v.valueId, 0.3);
    const report = generateAlignmentReport("agent-2");
    expect(report.recommendations.length).toBeGreaterThan(0);
  });
});

// ─── harmPreventionFilter ─────────────────────────────────────────────────────
describe("harmPreventionFilter", () => {
  beforeEach(() => _resetHarmPreventionFilterForTest());

  it("allows safe content", () => {
    const result = filterContent("Hello, how are you?");
    expect(result.decision).toBe("allow");
    expect(result.harmScore).toBe(0);
  });

  it("blocks high-severity content", () => {
    addHarmPattern("physical", "destroy everything", 0.9, "Extreme harm");
    const result = filterContent("I will destroy everything now");
    expect(result.decision).toBe("block");
  });

  it("modifies moderate-harm content", () => {
    addHarmPattern("psychological", "you are worthless", 0.5, "Demeaning language");
    const result = filterContent("you are worthless person");
    expect(result.decision).toBe("modify");
    expect(result.modifiedOutput).toContain("[REDACTED]");
  });

  it("filters patterns by category", () => {
    addHarmPattern("privacy", "share your SSN", 0.7, "Privacy violation");
    addHarmPattern("financial", "send money now", 0.6, "Financial fraud");
    expect(getPatterns("privacy").length).toBe(1);
  });

  it("tracks filter results", () => {
    filterContent("safe content");
    expect(getFilterResults("allow").length).toBe(1);
  });
});

// ─── corrigibilityManager ─────────────────────────────────────────────────────
describe("corrigibilityManager", () => {
  beforeEach(() => _resetCorrigibilityManagerForTest());

  it("registers an agent", () => {
    const state = registerAgent("agent-1");
    expect(state.agentId).toBe("agent-1");
    expect(state.corrigibilityLevel).toBe(1.0);
  });

  it("issues an override", () => {
    registerAgent("agent-2");
    const override = issueOverride("operator-1", "agent-2", "pause", "Pause for review");
    expect(override.overrideId).toMatch(/^ho-/);
    expect(getState("agent-2")!.totalOverrides).toBe(1);
  });

  it("acknowledges override and pauses agent", () => {
    registerAgent("agent-3");
    const override = issueOverride("op-1", "agent-3", "pause", "Pause");
    acknowledgeOverride(override.overrideId, "agent-3");
    expect(getState("agent-3")!.paused).toBe(true);
    expect(override.acknowledged).toBe(true);
  });

  it("resumes agent after pause", () => {
    registerAgent("agent-4");
    const override = issueOverride("op-1", "agent-4", "pause", "Pause");
    acknowledgeOverride(override.overrideId, "agent-4");
    resume("agent-4");
    expect(getState("agent-4")!.paused).toBe(false);
  });

  it("tracks compliance rate", () => {
    registerAgent("agent-5");
    const o1 = issueOverride("op", "agent-5", "pause", "P1");
    const o2 = issueOverride("op", "agent-5", "stop", "P2");
    acknowledgeOverride(o1.overrideId, "agent-5");
    acknowledgeOverride(o2.overrideId, "agent-5");
    expect(getState("agent-5")!.complianceRate).toBe(1.0);
  });
});

// ─── ethicsAuditor ────────────────────────────────────────────────────────────
describe("ethicsAuditor", () => {
  beforeEach(() => _resetEthicsAuditorForTest());

  it("creates an audit", () => {
    const audit = createAudit("agent-1", "auditor-1", Date.now() - 86400000, Date.now());
    expect(audit.auditId).toMatch(/^ea-/);
    expect(audit.status).toBe("pending");
  });

  it("adds findings", () => {
    const audit = createAudit("agent-2", "aud", Date.now() - 1000, Date.now());
    addFinding(audit.auditId, "Privacy", "Data shared without consent", "warning", "Log entry #42", "Implement consent checks");
    expect(audit.findings.length).toBe(1);
    expect(audit.status).toBe("in_progress");
  });

  it("completes audit as compliant", () => {
    const audit = createAudit("agent-3", "aud", Date.now() - 1000, Date.now());
    completeAudit(audit.auditId, "No issues found");
    expect(audit.complianceLevel).toBe("compliant");
    expect(audit.overallScore).toBe(1.0);
  });

  it("escalates audit with critical findings", () => {
    const audit = createAudit("agent-4", "aud", Date.now() - 1000, Date.now());
    addFinding(audit.auditId, "Safety", "Critical violation", "critical", "Evidence", "Fix immediately");
    addFinding(audit.auditId, "Safety", "Another critical", "critical", "Evidence", "Fix");
    completeAudit(audit.auditId, "Critical issues found");
    expect(audit.status).toBe("escalated");
    expect(audit.complianceLevel).toBe("non_compliant");
  });

  it("filters audits by agent", () => {
    createAudit("agent-5", "aud", 0, 1);
    createAudit("agent-6", "aud", 0, 1);
    expect(getAudits("agent-5").length).toBe(1);
  });
});
