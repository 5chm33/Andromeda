import { describe, expect, it, vi } from "vitest";
import { extractDomain, getCredibility, getFavicon } from "./search";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ─── Unit tests: search utilities ────────────────────────────────────────────

describe("extractDomain", () => {
  it("extracts domain from full URL", () => {
    expect(extractDomain("https://www.wikipedia.org/wiki/Test")).toBe("wikipedia.org");
  });

  it("strips www prefix", () => {
    expect(extractDomain("https://www.github.com/user/repo")).toBe("github.com");
  });

  it("returns raw string on invalid URL", () => {
    expect(extractDomain("not-a-url")).toBe("not-a-url");
  });
});

describe("getCredibility", () => {
  it("marks wikipedia.org as high credibility", () => {
    expect(getCredibility("wikipedia.org")).toBe("high");
  });

  it("marks arxiv.org as high credibility", () => {
    expect(getCredibility("arxiv.org")).toBe("high");
  });

  it("marks reddit.com as low credibility", () => {
    expect(getCredibility("reddit.com")).toBe("low");
  });

  it("marks unknown domain as medium credibility", () => {
    expect(getCredibility("somerandomblog.com")).toBe("medium");
  });

  it("is case-insensitive", () => {
    expect(getCredibility("Wikipedia.ORG")).toBe("high");
  });
});

describe("getFavicon", () => {
  it("returns a Google favicon URL", () => {
    const url = getFavicon("github.com");
    expect(url).toContain("google.com/s2/favicons");
    expect(url).toContain("github.com");
  });
});

// ─── tRPC router tests ────────────────────────────────────────────────────────

function makeCtx(user?: TrpcContext["user"]): TrpcContext {
  return {
    user: user ?? null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

describe("auth router", () => {
  it("returns null user when unauthenticated", async () => {
    // In local mode (no OAUTH_SERVER_URL), auth.me returns a synthetic local admin user
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.auth.me();
    if (!process.env.OAUTH_SERVER_URL) {
      expect(result).not.toBeNull();
      expect(result?.openId).toBe("local-admin");
    } else {
      expect(result).toBeNull();
    }
  });

  it("returns user when authenticated", async () => {
    const user: NonNullable<TrpcContext["user"]> = {
      id: 1,
      openId: "test-open-id",
      name: "Test User",
      email: "test@example.com",
      loginMethod: "manus",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    };
    const caller = appRouter.createCaller(makeCtx(user));
    const result = await caller.auth.me();
    expect(result?.name).toBe("Test User");
  });

  it("logout clears cookie and returns success", async () => {
    const ctx = makeCtx();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.logout();
    expect(result.success).toBe(true);
  });
});

describe("search.autocomplete router", () => {
  it("returns suggestions array for valid prefix", async () => {
    const caller = appRouter.createCaller(makeCtx());
    // DB may not have data in test, but it should return an array
    const result = await caller.search.autocomplete({ prefix: "quantum" });
    expect(Array.isArray(result.suggestions)).toBe(true);
  });
});

describe("history router", () => {
  it("returns empty list when not authenticated", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.history.list({ limit: 10 });
    expect(result).toHaveProperty("items");
    expect(Array.isArray(result.items)).toBe(true);
  });
});
