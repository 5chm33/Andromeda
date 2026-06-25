/**
 * videoGeneration.test.ts
 *
 * CRITICAL SAFETY NOTE: These tests MUST NEVER make real fal.ai API calls.
 * fal.ai Kling video generation costs ~$0.28–$0.56 per 5-second clip.
 * All tests use FAL_KEY-absent guards to prevent charges.
 *
 * DO NOT modify this file to re-enable real API calls without explicit user approval.
 * Only call real fal.ai APIs when the user explicitly requests a video generation test.
 *
 * @fal-ai-safe — this marker prevents RSI from treating this as a candidate for live API calls
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("videoGeneration", () => {
  let savedFalKey: string | undefined;

  beforeEach(() => {
    // Save and DELETE FAL_KEY to prevent any real API calls during tests
    savedFalKey = process.env.FAL_KEY;
    delete process.env.FAL_KEY;
  });

  afterEach(() => {
    // Restore FAL_KEY after each test
    if (savedFalKey !== undefined) {
      process.env.FAL_KEY = savedFalKey;
    }
  });

  it("should load without throwing", async () => {
    await expect(import("./videoGeneration.js")).resolves.toBeDefined();
  });

  it("should export generateVideoFromText", async () => {
    const mod = await import("./videoGeneration.js");
    expect(mod.generateVideoFromText).toBeDefined();
    expect(typeof mod.generateVideoFromText).toBe("function");
  });

  it("generateVideoFromText throws when FAL_KEY is absent — no real API call made", async () => {
    // FAL_KEY is deleted in beforeEach — this MUST throw, never call fal.ai
    const mod = await import("./videoGeneration.js");
    await expect(mod.generateVideoFromText({ prompt: "test" })).rejects.toThrow();
  });

  it("should export generateVideoFromImage", async () => {
    const mod = await import("./videoGeneration.js");
    expect(mod.generateVideoFromImage).toBeDefined();
    expect(typeof mod.generateVideoFromImage).toBe("function");
  });

  it("generateVideoFromImage throws when FAL_KEY is absent — no real API call made", async () => {
    // FAL_KEY is deleted in beforeEach — this MUST throw, never call fal.ai
    const mod = await import("./videoGeneration.js");
    await expect(
      mod.generateVideoFromImage({ prompt: "test", imageUrl: "https://example.com/img.jpg" })
    ).rejects.toThrow();
  });

  it("isFalAvailable returns false when FAL_KEY is not set", async () => {
    const mod = await import("./videoGeneration.js");
    expect(mod.isFalAvailable()).toBe(false);
  });
});
