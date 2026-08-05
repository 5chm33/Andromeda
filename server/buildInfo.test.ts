import { describe, it, expect } from "vitest";
import { ANDROMEDA_VERSION, getBuildInfo } from "./buildInfo.js";

describe("buildInfo", () => {
  it("ANDROMEDA_VERSION should be a valid semver string", () => {
    expect(ANDROMEDA_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("getBuildInfo returns all required fields with correct types", () => {
    const info = getBuildInfo();
    expect(typeof info.version).toBe("string");
    expect(typeof info.name).toBe("string");
    expect(typeof info.commitHash).toBe("string");
    expect(typeof info.buildTimestamp).toBe("string");
    // Timestamp should be a valid ISO date
    expect(() => new Date(info.buildTimestamp)).not.toThrow();
    expect(new Date(info.buildTimestamp).toISOString()).toBe(info.buildTimestamp);
  });

  it("version in getBuildInfo matches ANDROMEDA_VERSION", () => {
    expect(getBuildInfo().version).toBe(ANDROMEDA_VERSION);
  });
});
