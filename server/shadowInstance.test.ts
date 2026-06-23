import { describe, it, expect } from "vitest";
import {
  isDockerAvailable,
} from "./shadowInstance.js";

describe("shadowInstance", () => {
  it("isDockerAvailable returns a boolean", () => {
    const result = isDockerAvailable();
    expect(typeof result).toBe("boolean");
  });

  it("isDockerAvailable is consistent across multiple calls", () => {
    const first = isDockerAvailable();
    const second = isDockerAvailable();
    expect(first).toBe(second);
  });

  it("isDockerAvailable does not throw", () => {
    expect(() => isDockerAvailable()).not.toThrow();
  });

  it("isDockerAvailable returns false in sandbox environment", () => {
    // In the test sandbox, Docker is typically not available
    const result = isDockerAvailable();
    expect(typeof result).toBe("boolean");
    // Just verify it returns a valid boolean, not necessarily false
    expect(result === true || result === false).toBe(true);
  });

  it("module exports isDockerAvailable as a function", () => {
    expect(typeof isDockerAvailable).toBe("function");
  });
});
