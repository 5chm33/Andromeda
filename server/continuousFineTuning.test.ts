import { describe, it, expect } from "vitest";
import { runNightlyFineTuningCycle } from "./continuousFineTuning.js";

describe("continuousFineTuning", () => {
  it("runNightlyFineTuningCycle returns a FineTuningCycleResult shape", async () => {
    const result = await runNightlyFineTuningCycle();
    expect(result).toBeDefined();
    expect(result).toHaveProperty("success");
    expect(typeof result.success).toBe("boolean");
  }, 15000);

  it("runNightlyFineTuningCycle result has rlaifPairsGenerated field", async () => {
    const result = await runNightlyFineTuningCycle();
    expect(result).toHaveProperty("rlaifPairsGenerated");
    expect(typeof result.rlaifPairsGenerated).toBe("number");
  }, 15000);

  it("runNightlyFineTuningCycle result has totalDatasetSize field", async () => {
    const result = await runNightlyFineTuningCycle();
    expect(result).toHaveProperty("totalDatasetSize");
    expect(typeof result.totalDatasetSize).toBe("number");
  }, 15000);

  it("runNightlyFineTuningCycle rlaifPairsGenerated is non-negative", async () => {
    const result = await runNightlyFineTuningCycle();
    expect(result.rlaifPairsGenerated).toBeGreaterThanOrEqual(0);
  }, 15000);

  it("runNightlyFineTuningCycle totalDatasetSize is non-negative", async () => {
    const result = await runNightlyFineTuningCycle();
    expect(result.totalDatasetSize).toBeGreaterThanOrEqual(0);
  }, 15000);
});
