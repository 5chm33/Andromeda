import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("callDataApi", () => {
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

  it("should throw if forgeApiUrl is not configured", async () => {
    delete process.env.BUILT_IN_FORGE_API_URL;
    const { callDataApi } = await import("./dataApi");
    await expect(callDataApi("Youtube/search")).rejects.toThrow("BUILT_IN_FORGE_API_URL is not configured");
  });

  it("should throw if forgeApiKey is not configured", async () => {
    delete process.env.BUILT_IN_FORGE_API_KEY;
    const { callDataApi } = await import("./dataApi");
    await expect(callDataApi("Youtube/search")).rejects.toThrow("BUILT_IN_FORGE_API_KEY is not configured");
  });

  it("should call the API and return parsed jsonData", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValueOnce({ jsonData: JSON.stringify({ results: ["video1"] }) }),
    });
    
    const { callDataApi } = await import("./dataApi");
    const result = await callDataApi("Youtube/search", { query: { q: "manus" } });
    
    expect(result).toEqual({ results: ["video1"] });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("CallApi"),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("should return raw payload when no jsonData field", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValueOnce({ data: "raw" }),
    });
    
    const { callDataApi } = await import("./dataApi");
    const result = await callDataApi("SomeApi/endpoint");
    
    expect(result).toEqual({ data: "raw" });
  });

  it("should throw on API error", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: vi.fn().mockResolvedValueOnce("Server error"),
    });
    
    const { callDataApi } = await import("./dataApi");
    await expect(callDataApi("Youtube/search")).rejects.toThrow("Data API request failed");
  });
});
