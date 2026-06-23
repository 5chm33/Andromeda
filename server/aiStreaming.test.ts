import { describe, it, expect } from "vitest";
import * as aiStreaming from "./aiStreaming.js";

describe("aiStreaming", () => {
  it("module loads without error", () => {
    expect(aiStreaming).toBeDefined();
  });

  it("exports at least one function", () => {
    const fns = Object.values(aiStreaming).filter(v => typeof v === "function");
    expect(fns.length).toBeGreaterThanOrEqual(1);
  });

  it("all exported functions are callable", () => {
    const fns = Object.entries(aiStreaming).filter(([, v]) => typeof v === "function");
    for (const [, fn] of fns) {
      expect(typeof fn).toBe("function");
    }
  });

  it("module does not export undefined values", () => {
    for (const [key, val] of Object.entries(aiStreaming)) {
      expect(val).not.toBeUndefined();
    }
  });

  it("module has at least 2 exports", () => {
    expect(Object.keys(aiStreaming).length).toBeGreaterThanOrEqual(2);
  });
});
