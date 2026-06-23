import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TRPCError } from "@trpc/server";

describe("notifyOwner", () => {
  let originalFetch: typeof global.fetch;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalFetch = global.fetch;
    originalEnv = { ...process.env };
    process.env.BUILT_IN_FORGE_API_URL = "http://forge.example.com";
    process.env.BUILT_IN_FORGE_API_KEY = "test-key";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it("should throw BAD_REQUEST when title is empty", async () => {
    const { notifyOwner } = await import("./notification");
    await expect(notifyOwner({ title: "", content: "content" })).rejects.toThrow(TRPCError);
  });

  it("should throw BAD_REQUEST when content is empty", async () => {
    const { notifyOwner } = await import("./notification");
    await expect(notifyOwner({ title: "title", content: "" })).rejects.toThrow(TRPCError);
  });

  it("should throw BAD_REQUEST when title exceeds max length", async () => {
    const { notifyOwner } = await import("./notification");
    const longTitle = "a".repeat(1201);
    await expect(notifyOwner({ title: longTitle, content: "content" })).rejects.toThrow(TRPCError);
  });

  it("should throw INTERNAL_SERVER_ERROR when forgeApiUrl is not set", async () => {
    delete process.env.BUILT_IN_FORGE_API_URL;
    const { notifyOwner } = await import("./notification");
    await expect(notifyOwner({ title: "title", content: "content" })).rejects.toThrow(TRPCError);
  });

  it("should throw INTERNAL_SERVER_ERROR when forgeApiKey is not set", async () => {
    delete process.env.BUILT_IN_FORGE_API_KEY;
    const { notifyOwner } = await import("./notification");
    await expect(notifyOwner({ title: "title", content: "content" })).rejects.toThrow(TRPCError);
  });

  it("should return true on success", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({ ok: true });
    
    const { notifyOwner } = await import("./notification");
    const result = await notifyOwner({ title: "  title  ", content: "  content  " });
    
    expect(result).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("SendNotification"),
      expect.objectContaining({
        body: JSON.stringify({ title: "title", content: "content" }),
      })
    );
  });

  it("should return false on API error", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: vi.fn().mockResolvedValueOnce(""),
    });
    
    const { notifyOwner } = await import("./notification");
    const result = await notifyOwner({ title: "title", content: "content" });
    
    expect(result).toBe(false);
  });

  it("should return false on network error", async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new Error("Network error"));
    
    const { notifyOwner } = await import("./notification");
    const result = await notifyOwner({ title: "title", content: "content" });
    
    expect(result).toBe(false);
  });
});
