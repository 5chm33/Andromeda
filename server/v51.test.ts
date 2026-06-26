/**
 * v51.test.ts — External API Mastery I
 * Tests: apiDocumentationParser, apiSchemaInferrer, apiClientGenerator,
 *        apiAuthManager, apiRateLimiter, apiHealthMonitor
 */

import { describe, it, expect, beforeEach } from "vitest";

import {
  parseOpenApiJson, parseMarkdownDoc, getEndpointsByTag, getEndpointsByMethod,
} from "./apiDocumentationParser.js";

import { inferSchema, schemaToPseudoTypeScript } from "./apiSchemaInferrer.js";

import { generateClient } from "./apiClientGenerator.js";

import {
  registerCredential, getAuthHeader, refreshToken, isCredentialValid, revokeCredential,
  _resetAuthManagerForTest,
} from "./apiAuthManager.js";

import {
  configureRateLimit, tryAcquire, getStatus,
  _resetRateLimiterForTest,
} from "./apiRateLimiter.js";

import {
  registerApi, recordCall, getHealthReport, getAllHealthReports,
  _resetApiHealthMonitorForTest,
} from "./apiHealthMonitor.js";

// ─── Test fixtures ────────────────────────────────────────────────────────────
const SAMPLE_OPENAPI = JSON.stringify({
  info: { title: "Test API", version: "2.0.0" },
  servers: [{ url: "https://api.example.com" }],
  paths: {
    "/users": {
      get: { summary: "List users", parameters: [], responses: { "200": { description: "OK" } }, tags: ["users"] },
      post: { summary: "Create user", parameters: [], responses: { "201": { description: "Created" } }, tags: ["users"] },
    },
    "/users/{id}": {
      get: {
        summary: "Get user by ID",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" }, description: "User ID" }],
        responses: { "200": { description: "OK" } },
        tags: ["users"],
      },
    },
  },
});

describe("v51 External API Mastery I", () => {
  // ─── apiDocumentationParser ───────────────────────────────────────────────
  describe("apiDocumentationParser", () => {
    it("should parse OpenAPI JSON and extract endpoints", () => {
      const doc = parseOpenApiJson(SAMPLE_OPENAPI);
      expect(doc.title).toBe("Test API");
      expect(doc.version).toBe("2.0.0");
      expect(doc.baseUrl).toBe("https://api.example.com");
      expect(doc.endpoints).toHaveLength(3);
    });

    it("should filter endpoints by tag", () => {
      const doc = parseOpenApiJson(SAMPLE_OPENAPI);
      const userEndpoints = getEndpointsByTag(doc, "users");
      expect(userEndpoints).toHaveLength(3);
    });

    it("should filter endpoints by method", () => {
      const doc = parseOpenApiJson(SAMPLE_OPENAPI);
      const getEndpoints = getEndpointsByMethod(doc, "GET");
      expect(getEndpoints).toHaveLength(2);
    });

    it("should parse Markdown documentation", () => {
      const md = `# My Service API\nVersion: 1.5.0\nBase URL: https://svc.example.com\n\n\`GET /health\`\n\`POST /data\``;
      const doc = parseMarkdownDoc(md);
      expect(doc.title).toBe("My Service API");
      expect(doc.endpoints.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ─── apiSchemaInferrer ────────────────────────────────────────────────────
  describe("apiSchemaInferrer", () => {
    it("should infer primitive types", () => {
      expect(inferSchema("hello").type).toBe("string");
      expect(inferSchema(42).type).toBe("number");
      expect(inferSchema(true).type).toBe("boolean");
      expect(inferSchema(null).type).toBe("null");
    });

    it("should infer object schema with required fields", () => {
      const schema = inferSchema({ id: 1, name: "Alice", active: true });
      expect(schema.type).toBe("object");
      expect(schema.properties?.id.type).toBe("number");
      expect(schema.properties?.name.type).toBe("string");
      expect(schema.required).toContain("id");
    });

    it("should infer array schema", () => {
      const schema = inferSchema([{ id: 1 }, { id: 2 }]);
      expect(schema.type).toBe("array");
      expect(schema.items?.type).toBe("object");
    });

    it("should generate TypeScript interface", () => {
      const schema = inferSchema({ userId: "abc", score: 99 });
      const ts = schemaToPseudoTypeScript("UserScore", schema);
      expect(ts).toContain("interface UserScore");
      expect(ts).toContain("userId");
      expect(ts).toContain("score");
    });
  });

  // ─── apiClientGenerator ───────────────────────────────────────────────────
  describe("apiClientGenerator", () => {
    it("should generate a TypeScript client", () => {
      const doc = parseOpenApiJson(SAMPLE_OPENAPI);
      const client = generateClient(doc, "TestApiClient");
      expect(client.code).toContain("TestApiClient");
      expect(client.code).toContain("BASE_URL");
      expect(client.endpointCount).toBe(3);
    });

    it("should include fetch-based request function", () => {
      const doc = parseOpenApiJson(SAMPLE_OPENAPI);
      const client = generateClient(doc);
      expect(client.code).toContain("fetch(");
      expect(client.code).toContain("async function request");
    });
  });

  // ─── apiAuthManager ───────────────────────────────────────────────────────
  describe("apiAuthManager", () => {
    beforeEach(() => _resetAuthManagerForTest());

    it("should register and retrieve bearer token header", () => {
      registerCredential("api1", "bearer", { token: "my-secret-token" });
      const header = getAuthHeader("api1");
      expect(header?.key).toBe("Authorization");
      expect(header?.value).toBe("Bearer my-secret-token");
    });

    it("should return api-key header with custom header name", () => {
      registerCredential("api2", "api-key", { apiKey: "key123", headerName: "X-Custom-Key" });
      const header = getAuthHeader("api2");
      expect(header?.key).toBe("X-Custom-Key");
      expect(header?.value).toBe("key123");
    });

    it("should refresh token", () => {
      registerCredential("api3", "bearer", { token: "old-token" });
      refreshToken("api3", "new-token", 3600);
      const header = getAuthHeader("api3");
      expect(header?.value).toBe("Bearer new-token");
    });

    it("should return null for expired credentials", () => {
      registerCredential("api4", "bearer", { token: "expired", expiresAt: Date.now() - 1000 });
      const header = getAuthHeader("api4");
      expect(header).toBeNull();
    });

    it("should revoke credentials", () => {
      registerCredential("api5", "bearer", { token: "valid" });
      expect(isCredentialValid("api5")).toBe(true);
      revokeCredential("api5");
      expect(isCredentialValid("api5")).toBe(false);
    });
  });

  // ─── apiRateLimiter ───────────────────────────────────────────────────────
  describe("apiRateLimiter", () => {
    beforeEach(() => _resetRateLimiterForTest());

    it("should allow requests within rate limit", () => {
      configureRateLimit({ apiId: "api1", requestsPerMinute: 60, burstSize: 10 });
      expect(tryAcquire("api1")).toBe(true);
      expect(tryAcquire("api1")).toBe(true);
    });

    it("should throttle when burst is exhausted", () => {
      configureRateLimit({ apiId: "api2", requestsPerMinute: 60, burstSize: 2 });
      tryAcquire("api2");
      tryAcquire("api2");
      const result = tryAcquire("api2");
      expect(result).toBe(false);
    });

    it("should report throttled status", () => {
      configureRateLimit({ apiId: "api3", requestsPerMinute: 60, burstSize: 1 });
      tryAcquire("api3");
      tryAcquire("api3"); // exhausts burst
      const status = getStatus("api3");
      expect(status.throttled).toBe(true);
      expect(status.recommendedBackoffMs).toBeGreaterThan(0);
    });
  });

  // ─── apiHealthMonitor ─────────────────────────────────────────────────────
  describe("apiHealthMonitor", () => {
    beforeEach(() => _resetApiHealthMonitorForTest());

    it("should report healthy for all-success calls", () => {
      registerApi({ apiId: "api1", name: "Test API", slaLatencyMs: 500, slaSuccessRate: 0.99 });
      for (let i = 0; i < 10; i++) {
        recordCall({ apiId: "api1", success: true, latencyMs: 100, statusCode: 200, timestamp: Date.now() });
      }
      const report = getHealthReport("api1");
      expect(report?.status).toBe("healthy");
      expect(report?.successRate).toBe(1.0);
    });

    it("should report degraded when success rate drops", () => {
      registerApi({ apiId: "api2", name: "Flaky API", slaSuccessRate: 0.99 });
      for (let i = 0; i < 5; i++) recordCall({ apiId: "api2", success: true, latencyMs: 100, timestamp: Date.now() });
      for (let i = 0; i < 5; i++) recordCall({ apiId: "api2", success: false, latencyMs: 100, errorType: "timeout", timestamp: Date.now() });
      const report = getHealthReport("api2");
      expect(report?.status).not.toBe("healthy");
    });

    it("should return all health reports", () => {
      registerApi({ apiId: "api3", name: "API 3" });
      registerApi({ apiId: "api4", name: "API 4" });
      const reports = getAllHealthReports();
      expect(reports.length).toBeGreaterThanOrEqual(2);
    });
  });
});
