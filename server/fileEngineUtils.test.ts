import { describe, it, expect } from "vitest";
import {
  createBudget,
  checkBudget,
} from "./fileEngineUtils.js";

describe("fileEngineUtils", () => {
  it("createBudget returns a CostBudget with default values", () => {
    const budget = createBudget();
    expect(budget).toBeDefined();
    expect(budget).toHaveProperty("maxInputTokens");
    expect(budget).toHaveProperty("maxOutputTokens");
    expect(budget).toHaveProperty("usedInputTokens");
    expect(budget).toHaveProperty("usedOutputTokens");
  });

  it("createBudget accepts custom maxInputTokens", () => {
    const budget = createBudget({ maxInputTokens: 1000 });
    expect(budget.maxInputTokens).toBe(1000);
  });

  it("checkBudget returns ok=true for fresh budget", () => {
    const budget = createBudget();
    const result = checkBudget(budget);
    expect(result).toHaveProperty("ok");
    expect(result.ok).toBe(true);
  });

  it("checkBudget returns ok=false when total tokens exhausted", () => {
    const budget = createBudget({ maxTotalTokens: 10 });
    budget.usedInputTokens = 6;
    budget.usedOutputTokens = 6;
    const result = checkBudget(budget);
    expect(result.ok).toBe(false);
    expect(result).toHaveProperty("reason");
  });

  it("checkBudget reason is a string when api call limit exceeded", () => {
    const budget = createBudget({ maxApiCalls: 1 });
    budget.apiCallCount = 5;
    const result = checkBudget(budget);
    expect(result.ok).toBe(false);
    expect(typeof result.reason).toBe("string");
  });
});
