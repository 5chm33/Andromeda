import { describe, expect, it } from "vitest";
import {
  getActiveProvider,
  setActiveProvider,
  listProviders,
  getActiveProvider,
} from "./llmProvider";

describe("LLM Provider Module", () => {
  describe("getActiveProvider", () => {
    it("returns the currently active provider", () => {
      const provider = getActiveProvider();
      expect(provider).toBeDefined();
      expect(typeof provider.id).toBe("string");
    });
  });

  describe("setActiveProvider", () => {
    it("switches to a valid provider", () => {
      const providers = listProviders();
      if (providers.length > 0) {
        const target = providers[0];
        setActiveProvider({ id: target.id });
        const active = getActiveProvider();
        expect(active.id).toBe(target.id);
      }
    });
  });

  describe("listProviders", () => {
    it("returns an array of available providers", () => {
      const providers = listProviders();
      expect(Array.isArray(providers)).toBe(true);
      expect(providers.length).toBeGreaterThan(0);
      // Each provider should have at least an id
      for (const p of providers) {
        expect(p.id).toBeDefined();
        expect(typeof p.id).toBe("string");
      }
    });
  });

  describe("getActiveProvider", () => {
    it("returns configuration for the active provider", () => {
      const config = getActiveProvider();
      expect(config).toBeDefined();
      expect(typeof config).toBe("object");
    });
  });
});
