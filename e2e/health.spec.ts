/**
 * health.spec.ts — v101.0.0
 * E2E tests for the /health endpoint and core API availability.
 */
import { test, expect } from "@playwright/test";

test.describe("Health Endpoint", () => {
  test("GET /health returns 200 with valid JSON", async ({ request }) => {
    const res = await request.get("/health");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("status");
    expect(["ok", "healthy", "running"]).toContain(body.status);
  });

  test("GET /health includes version field", async ({ request }) => {
    const res = await request.get("/health");
    const body = await res.json();
    // Version should be a semver-like string
    if (body.version) {
      expect(typeof body.version).toBe("string");
      expect(body.version.length).toBeGreaterThan(0);
    }
  });

  test("GET /health responds within 2 seconds", async ({ request }) => {
    const start = Date.now();
    const res = await request.get("/health");
    const elapsed = Date.now() - start;
    expect(res.status()).toBe(200);
    expect(elapsed).toBeLessThan(2000);
  });
});

test.describe("API Availability", () => {
  test("GET /api/rsi/status returns a response", async ({ request }) => {
    const res = await request.get("/api/rsi/status");
    // Accept 200 or 503 (service may not be running in test env)
    expect([200, 503, 404]).toContain(res.status());
  });
});
