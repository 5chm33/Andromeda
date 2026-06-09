import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("makeRequest (Google Maps API)", () => {
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

  it("should throw when credentials are missing", async () => {
    delete process.env.BUILT_IN_FORGE_API_URL;
    const { makeRequest } = await import("./map");
    await expect(makeRequest("/maps/api/geocode/json", { address: "NYC" })).rejects.toThrow(
      "Google Maps proxy credentials missing"
    );
  });

  it("should make a GET request with correct URL and params", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValueOnce({ status: "OK", results: [] }),
    });
    
    const { makeRequest } = await import("./map");
    const result = await makeRequest("/maps/api/geocode/json", { address: "New York" });
    
    expect(result).toEqual({ status: "OK", results: [] });
    const calledUrl = (global.fetch as any).mock.calls[0][0];
    expect(calledUrl).toContain("/v1/maps/proxy/maps/api/geocode/json");
    expect(calledUrl).toContain("key=test-key");
    expect(calledUrl).toContain("address=New+York");
  });

  it("should throw on API error", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: vi.fn().mockResolvedValueOnce("API key invalid"),
    });
    
    const { makeRequest } = await import("./map");
    await expect(makeRequest("/maps/api/geocode/json")).rejects.toThrow("Google Maps API request failed");
  });

  it("should make a POST request when method is POST", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValueOnce({ status: "OK" }),
    });
    
    const { makeRequest } = await import("./map");
    await makeRequest("/maps/api/directions/json", {}, { method: "POST", body: { origin: "NYC" } });
    
    const callArgs = (global.fetch as any).mock.calls[0];
    expect(callArgs[1].method).toBe("POST");
    expect(callArgs[1].body).toContain("origin");
  });
});
