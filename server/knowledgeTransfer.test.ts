import { describe, it, expect } from "vitest";
import {
  learnFromAppliedProposal,
  getPatternContextForFile,
  getKnowledgeTransferStatus,
  initKnowledgeTransfer,
} from "./knowledgeTransfer.js";

describe("knowledgeTransfer", () => {
  it("initKnowledgeTransfer runs without throwing", () => {
    expect(() => initKnowledgeTransfer()).not.toThrow();
  });

  it("learnFromAppliedProposal records a proposal without throwing", () => {
    expect(() =>
      learnFromAppliedProposal({
        id: "test-001",
        targetFile: "server/selfImprove.ts",
        category: "performance",
        title: "Reduce redundant LLM calls",
        rationale: "Caching repeated prompts saves tokens",
        confidence: 0.85,
        impact: "high",
      })
    ).not.toThrow();
  });

  it("getPatternContextForFile returns a string after learning", () => {
    learnFromAppliedProposal({
      id: "test-002",
      targetFile: "server/selfImprove.ts",
      category: "reliability",
      title: "Add retry on timeout",
      rationale: "Retries improve resilience",
      confidence: 0.9,
      impact: "medium",
    });
    const ctx = getPatternContextForFile("server/selfImprove.ts", "reliability");
    expect(typeof ctx).toBe("string");
  });

  it("getKnowledgeTransferStatus returns a status object", () => {
    const status = getKnowledgeTransferStatus();
    expect(status).toBeDefined();
    expect(typeof status).toBe("object");
  });

  it("learnFromAppliedProposal handles multiple proposals for the same file", () => {
    for (let i = 0; i < 3; i++) {
      learnFromAppliedProposal({
        id: `test-multi-${i}`,
        targetFile: "server/continuousImprover.ts",
        category: "performance",
        title: `Improvement ${i}`,
        rationale: `Rationale ${i}`,
        confidence: 0.7 + i * 0.05,
        impact: "low",
      });
    }
    const ctx = getPatternContextForFile("server/continuousImprover.ts", "performance");
    expect(typeof ctx).toBe("string");
  });
});
