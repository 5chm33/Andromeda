import { describe, it, expect } from "vitest";
import { verifyModule } from "./formalVerification.js";

describe("formalVerification", () => {
  it("verifyModule returns a VerificationResult for initSafety", async () => {
    const result = await verifyModule("initSafety");
    expect(result).toBeDefined();
    expect(result).toHaveProperty("moduleName");
    expect(result.moduleName).toBe("initSafety");
  }, 15000);

  it("verifyModule returns a VerificationResult for fsWatcher", async () => {
    const result = await verifyModule("fsWatcher");
    expect(result).toBeDefined();
    expect(result).toHaveProperty("moduleName");
    expect(result.moduleName).toBe("fsWatcher");
  }, 15000);

  it("verifyModule result has passed boolean field", async () => {
    const result = await verifyModule("initSafety");
    expect(result).toHaveProperty("passed");
    expect(typeof result.passed).toBe("boolean");
  }, 15000);

  it("verifyModule result has output string field", async () => {
    const result = await verifyModule("initSafety");
    expect(result).toHaveProperty("output");
    expect(typeof result.output).toBe("string");
  }, 15000);

  it("verifyModule result has specPath string field", async () => {
    const result = await verifyModule("fsWatcher");
    expect(result).toHaveProperty("specPath");
    expect(typeof result.specPath).toBe("string");
  }, 15000);
});
