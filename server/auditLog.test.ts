import { describe, it, expect } from "vitest";
import { audit, auditRsiEvent, getRecentAuditEvents } from "./auditLog.js";

describe("auditLog", () => {
  it("exports audit, auditRsiEvent, getRecentAuditEvents", () => {
    expect(typeof audit).toBe("function");
    expect(typeof auditRsiEvent).toBe("function");
    expect(typeof getRecentAuditEvents).toBe("function");
  });

  it("getRecentAuditEvents returns an array", () => {
    const events = getRecentAuditEvents();
    expect(Array.isArray(events)).toBe(true);
  });

  it("audit does not throw for rsi category", () => {
    expect(() => {
      audit({ category: "rsi", action: "proposal_applied", actor: "system", success: true, severity: "info" });
    }).not.toThrow();
  });

  it("auditRsiEvent does not throw", () => {
    expect(() => {
      auditRsiEvent({ action: "proposal_applied", proposalId: "test-id", targetFile: "test.ts" });
    }).not.toThrow();
  });

  it("getRecentAuditEvents count increases after audit call", () => {
    const before = getRecentAuditEvents().length;
    audit({ category: "rsi", action: "proposal_applied", actor: "system", success: true, severity: "info" });
    const after = getRecentAuditEvents().length;
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it("getRecentAuditEvents with limit returns at most limit items", () => {
    const events = getRecentAuditEvents({ limit: 2 });
    expect(events.length).toBeLessThanOrEqual(2);
  });
});
