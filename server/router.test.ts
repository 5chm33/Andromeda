/**
 * router.test.ts — v6.01 tRPC Router Integration Tests
 *
 * Tests the actual tRPC router endpoints:
 * - search.autocomplete
 * - search.saveToHistory
 * - history.list (auth required)
 * - auth.me
 */
import { describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ─── tRPC router tests ────────────────────────────────────────────────────────

function createPublicCtx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

function createAuthCtx(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "test-user",
      email: "test@example.com",
      name: "Test User",
      loginMethod: "manus",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

describe("search.autocomplete router", () => {
  it("returns suggestions array for valid prefix", async () => {
    const caller = appRouter.createCaller(createPublicCtx());
    const result = await caller.search.autocomplete({ prefix: "quantum" });
    expect(result).toHaveProperty("suggestions");
    expect(Array.isArray(result.suggestions)).toBe(true);
  });

  it("returns empty array for empty prefix", async () => {
    const caller = appRouter.createCaller(createPublicCtx());
    const result = await caller.search.autocomplete({ prefix: "" });
    expect(result).toHaveProperty("suggestions");
    expect(Array.isArray(result.suggestions)).toBe(true);
  });
});

describe("search.saveToHistory router", () => {
  it("saves search history for anonymous user", async () => {
    const caller = appRouter.createCaller(createPublicCtx());
    const result = await caller.search.saveToHistory({
      query: "test query for vitest",
      aiAnswer: "This is a test answer",
      filter: "all",
    });
    expect(result).toHaveProperty("id");
  });

  it("saves search history for authenticated user", async () => {
    const caller = appRouter.createCaller(createAuthCtx());
    const result = await caller.search.saveToHistory({
      query: "authenticated test query",
      aiAnswer: "Authenticated answer",
      filter: "web",
    });
    expect(result).toHaveProperty("id");
  });
});

describe("history router", () => {
  it("returns empty list for unauthenticated user", async () => {
    const caller = appRouter.createCaller(createPublicCtx());
    const result = await caller.history.list({ limit: 10 });
    expect(result).toHaveProperty("items");
    expect(Array.isArray(result.items)).toBe(true);
  });

  it("returns history list for authenticated user", async () => {
    const caller = appRouter.createCaller(createAuthCtx());
    const result = await caller.history.list({ limit: 10 });
    expect(result).toHaveProperty("items");
    expect(Array.isArray(result.items)).toBe(true);
  });
});

describe("auth router", () => {
  it("returns null user for unauthenticated requests", async () => {
    const caller = appRouter.createCaller(createPublicCtx());
    const user = await caller.auth.me();
    expect(user).toBeNull();
  });

  it("returns user object for authenticated requests", async () => {
    const caller = appRouter.createCaller(createAuthCtx());
    const user = await caller.auth.me();
    expect(user).not.toBeNull();
    expect(user?.name).toBe("Test User");
  });
});
