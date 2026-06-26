/**
 * semanticImpactPredictor.test.ts — Comprehensive tests for semanticImpactPredictor.ts
 */
import { describe, it, expect } from "vitest";
import {
  predictImpact,
  type ImpactPrediction,
} from "./semanticImpactPredictor.js";

// ─── predictImpact Tests ──────────────────────────────────────────────────────

describe("predictImpact", () => {
  it("should return an ImpactPrediction object with expected fields", async () => {
    const result = await predictImpact({
      targetFile: "server/utils.ts",
      projectRoot: "/tmp",
    });
    expect(result).toHaveProperty("targetFile");
    expect(result).toHaveProperty("riskScore");
    expect(result).toHaveProperty("impactRadius");
    expect(result).toHaveProperty("transitiveRadius");
    expect(result).toHaveProperty("consumers");
    expect(result).toHaveProperty("consumerContextSnippet");
    expect(result).toHaveProperty("highRisk");
    expect(result).toHaveProperty("skipped");
    expect(Array.isArray(result.consumers)).toBe(true);
    expect(typeof result.riskScore).toBe("number");
    expect(result.riskScore).toBeGreaterThanOrEqual(0);
    expect(result.riskScore).toBeLessThanOrEqual(100);
  });

  it("should skip CSS files", async () => {
    const result = await predictImpact({
      targetFile: "src/styles/main.css",
      projectRoot: "/tmp",
    });
    expect(result.skipped).toBe(true);
  });

  it("should skip TSX files", async () => {
    const result = await predictImpact({
      targetFile: "src/components/Button.tsx",
      projectRoot: "/tmp",
    });
    expect(result.skipped).toBe(true);
  });

  it("should skip JSON files", async () => {
    const result = await predictImpact({
      targetFile: "package.json",
      projectRoot: "/tmp",
    });
    expect(result.skipped).toBe(true);
  });

  it("should skip markdown files", async () => {
    const result = await predictImpact({
      targetFile: "README.md",
      projectRoot: "/tmp",
    });
    expect(result.skipped).toBe(true);
  });

  it("should skip test files", async () => {
    const result = await predictImpact({
      targetFile: "server/utils.test.ts",
      projectRoot: "/tmp",
    });
    expect(result.skipped).toBe(true);
  });

  it("should handle non-existent project root gracefully", async () => {
    const result = await predictImpact({
      targetFile: "server/utils.ts",
      projectRoot: "/nonexistent/path",
    });
    expect(result).toHaveProperty("riskScore");
    expect(typeof result.riskScore).toBe("number");
  });

  it("should return highRisk=true when riskScore >= 70", async () => {
    const result = await predictImpact({
      targetFile: "server/utils.ts",
      projectRoot: "/tmp",
    });
    if (!result.skipped) {
      expect(result.highRisk).toBe(result.riskScore >= 70);
    }
  });

  it("should return impactRadius >= 0", async () => {
    const result = await predictImpact({
      targetFile: "server/utils.ts",
      projectRoot: "/tmp",
    });
    if (!result.skipped) {
      expect(result.impactRadius).toBeGreaterThanOrEqual(0);
      expect(result.transitiveRadius).toBeGreaterThanOrEqual(0);
    }
  });

  it("should return consumerContextSnippet as a string", async () => {
    const result = await predictImpact({
      targetFile: "server/utils.ts",
      projectRoot: "/tmp",
    });
    expect(typeof result.consumerContextSnippet).toBe("string");
  });

  it("should respect maxConsumerFiles limit", async () => {
    const result = await predictImpact({
      targetFile: "server/utils.ts",
      projectRoot: "/tmp",
      maxConsumerFiles: 2,
    });
    if (!result.skipped) {
      expect(result.consumers.length).toBeLessThanOrEqual(2);
    }
  });

  it("should include targetFile in result", async () => {
    const result = await predictImpact({
      targetFile: "server/selfImprove.ts",
      projectRoot: "/tmp",
    });
    expect(result.targetFile).toBe("server/selfImprove.ts");
  });
});

// ─── ImpactPrediction type validation ────────────────────────────────────────

describe("ImpactPrediction shape", () => {
  it("should have ConsumerUsage objects with expected fields", async () => {
    const result = await predictImpact({
      targetFile: "server/utils.ts",
      projectRoot: "/tmp",
    });
    if (!result.skipped && result.consumers.length > 0) {
      const consumer = result.consumers[0];
      expect(consumer).toHaveProperty("file");
      expect(consumer).toHaveProperty("callerFunction");
      expect(consumer).toHaveProperty("callSite");
      expect(consumer).toHaveProperty("line");
      expect(typeof consumer.file).toBe("string");
      expect(typeof consumer.line).toBe("number");
    }
  });
});
