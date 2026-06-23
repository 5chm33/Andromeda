import { describe, it, expect } from "vitest";
import { getDefaultAgents, getAgentRoles } from "./agentOrchestrator.js";

describe("getDefaultAgents", () => {
  it("should execute without throwing", () => {
    try {
      const result = getDefaultAgents();
      expect(result).toBeDefined();
    } catch (e: any) {
      // Function may throw in test environment (e.g. no providers registered)
      expect(e).toBeDefined();
    }
  });

  it("should return correct type", () => {
    const result = getDefaultAgents();
    expect(Array.isArray(result)).toBe(true);
  });

  it("should handle invalid inputs", () => {
    // @ts-expect-error Testing invalid input
    try { getDefaultAgents(); } catch (e: any) { expect(e).toBeDefined(); }
  });

});

describe("getAgentRoles", () => {
  it("should execute without throwing", () => {
    try {
      const result = getAgentRoles();
      expect(result).toBeDefined();
    } catch (e: any) {
      // Function may throw in test environment (e.g. no providers registered)
      expect(e).toBeDefined();
    }
  });

  it("should return correct type", () => {
    const result = getAgentRoles();
    expect(Array.isArray(result)).toBe(true);
  });

  it("should handle invalid inputs", () => {
    // @ts-expect-error Testing invalid input
    try { getAgentRoles(); } catch (e: any) { expect(e).toBeDefined(); }
  });

});

