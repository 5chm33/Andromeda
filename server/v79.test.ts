/**
 * v79.test.ts — API Gateway & Integration
 * Comprehensive tests for all 6 v79 modules.
 */
import { describe, it, expect, beforeEach } from "vitest";

import { registerService, routeRequest, recordResponse, getService, getAllServices, getRequestLog, getResponseLog, _resetApiGatewayForTest } from "./apiGateway";
import { createPolicy, checkRateLimit, getState, getPolicy, _resetRateLimiterForTest } from "./rateLimiter";
import { registerSchema, validateRequest, getSchema, _resetRequestValidatorForTest } from "./requestValidator";
import { registerTransformRule, transformResponse, getTransformHistory, _resetResponseTransformerForTest } from "./responseTransformer";
import { registerVersion, setDefaultVersion, resolveVersion, getVersions, _resetApiVersionRouterForTest } from "./apiVersionRouter";
import { registerCircuit, canExecute, recordSuccess, recordFailure, getCircuitStatus, getAllCircuits, _resetApiCircuitBreakerForTest } from "./apiCircuitBreaker";

// ─── apiGateway ──────────────────────────────────────────────────────────────
describe("apiGateway", () => {
  beforeEach(() => _resetApiGatewayForTest());

  it("registers and retrieves a service", () => {
    registerService({ serviceId: "svc-1", name: "User Service", baseUrl: "http://users:3000", pathPrefix: "/api/users", timeout: 5000, active: true });
    expect(getService("svc-1")?.name).toBe("User Service");
  });

  it("routes request to matching service", () => {
    registerService({ serviceId: "svc-2", name: "Orders", baseUrl: "http://orders:3001", pathPrefix: "/api/orders", timeout: 5000, active: true });
    const { matched, serviceId } = routeRequest("GET", "/api/orders/123");
    expect(matched).toBe(true);
    expect(serviceId).toBe("svc-2");
  });

  it("returns unmatched for unknown path", () => {
    const { matched } = routeRequest("GET", "/api/unknown");
    expect(matched).toBe(false);
  });

  it("does not route to inactive service", () => {
    registerService({ serviceId: "svc-3", name: "Inactive", baseUrl: "http://x:3002", pathPrefix: "/api/inactive", timeout: 5000, active: false });
    const { matched } = routeRequest("GET", "/api/inactive/test");
    expect(matched).toBe(false);
  });

  it("records responses", () => {
    const { request } = routeRequest("POST", "/api/test");
    recordResponse(request.requestId, "svc-1", 200, { ok: true }, 42);
    expect(getResponseLog().length).toBe(1);
    expect(getResponseLog()[0].statusCode).toBe(200);
  });

  it("resets cleanly", () => {
    registerService({ serviceId: "svc-4", name: "X", baseUrl: "http://x", pathPrefix: "/x", timeout: 1000, active: true });
    _resetApiGatewayForTest();
    expect(getAllServices().length).toBe(0);
  });
});

// ─── rateLimiter ─────────────────────────────────────────────────────────────
describe("rateLimiter", () => {
  beforeEach(() => _resetRateLimiterForTest());

  it("allows requests within limit", () => {
    createPolicy("p1", "Standard", 10, 60000);
    const result = checkRateLimit("client-1", "p1");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9);
  });

  it("blocks requests exceeding limit", () => {
    createPolicy("p2", "Strict", 2, 60000);
    checkRateLimit("client-2", "p2");
    checkRateLimit("client-2", "p2");
    const result = checkRateLimit("client-2", "p2");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Rate limit exceeded");
  });

  it("resets window after expiry", () => {
    createPolicy("p3", "Short", 1, 1);
    checkRateLimit("client-3", "p3");
    const result = checkRateLimit("client-3", "p3", Date.now() + 100);
    expect(result.allowed).toBe(true);
  });

  it("returns error for unknown policy", () => {
    const result = checkRateLimit("client-4", "unknown-policy");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Policy not found");
  });

  it("tracks state per client", () => {
    createPolicy("p4", "Multi", 5, 60000);
    checkRateLimit("client-a", "p4");
    checkRateLimit("client-b", "p4");
    expect(getState("client-a", "p4")?.totalRequests).toBe(1);
    expect(getState("client-b", "p4")?.totalRequests).toBe(1);
  });

  it("resets cleanly", () => {
    createPolicy("p5", "X", 10, 60000);
    _resetRateLimiterForTest();
    expect(getPolicy("p5")).toBeUndefined();
  });
});

// ─── requestValidator ────────────────────────────────────────────────────────
describe("requestValidator", () => {
  beforeEach(() => _resetRequestValidatorForTest());

  it("validates a valid request", () => {
    registerSchema({ schemaId: "s1", name: "Create User", fields: [{ name: "email", type: "string", required: true }, { name: "age", type: "number", required: false }] });
    const result = validateRequest("s1", { email: "test@example.com", age: 25 });
    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  it("rejects missing required field", () => {
    registerSchema({ schemaId: "s2", name: "Login", fields: [{ name: "password", type: "string", required: true }] });
    const result = validateRequest("s2", {});
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("required");
  });

  it("rejects wrong type", () => {
    registerSchema({ schemaId: "s3", name: "Test", fields: [{ name: "count", type: "number", required: true }] });
    const result = validateRequest("s3", { count: "not-a-number" });
    expect(result.valid).toBe(false);
  });

  it("validates string length constraints", () => {
    registerSchema({ schemaId: "s4", name: "Test", fields: [{ name: "name", type: "string", required: true, minLength: 3, maxLength: 10 }] });
    expect(validateRequest("s4", { name: "ab" }).valid).toBe(false);
    expect(validateRequest("s4", { name: "alice" }).valid).toBe(true);
  });

  it("validates enum constraint", () => {
    registerSchema({ schemaId: "s5", name: "Test", fields: [{ name: "role", type: "string", required: true, enum: ["admin", "user"] }] });
    expect(validateRequest("s5", { role: "superuser" }).valid).toBe(false);
    expect(validateRequest("s5", { role: "admin" }).valid).toBe(true);
  });

  it("returns error for unknown schema", () => {
    const result = validateRequest("unknown-schema", {});
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("not found");
  });
});

// ─── responseTransformer ─────────────────────────────────────────────────────
describe("responseTransformer", () => {
  beforeEach(() => _resetResponseTransformerForTest());

  it("renames fields via mapping", () => {
    registerTransformRule({ ruleId: "r1", name: "Rename", fieldMappings: { user_id: "userId" }, excludeFields: [], envelopeKey: null, addFields: {} });
    const result = transformResponse("r1", { user_id: "123", name: "Alice" });
    expect(result?.transformed).toHaveProperty("userId", "123");
    expect(result?.transformed).not.toHaveProperty("user_id");
  });

  it("excludes specified fields", () => {
    registerTransformRule({ ruleId: "r2", name: "Exclude", fieldMappings: {}, excludeFields: ["password", "secret"], envelopeKey: null, addFields: {} });
    const result = transformResponse("r2", { username: "alice", password: "hash", secret: "key" });
    expect(result?.transformed).not.toHaveProperty("password");
    expect(result?.transformed).not.toHaveProperty("secret");
    expect(result?.transformed).toHaveProperty("username");
  });

  it("wraps response in envelope", () => {
    registerTransformRule({ ruleId: "r3", name: "Envelope", fieldMappings: {}, excludeFields: [], envelopeKey: "data", addFields: {} });
    const result = transformResponse("r3", { id: 1 });
    expect(result?.transformed).toHaveProperty("data");
  });

  it("adds extra fields", () => {
    registerTransformRule({ ruleId: "r4", name: "AddFields", fieldMappings: {}, excludeFields: [], envelopeKey: null, addFields: { version: "v2", source: "api" } });
    const result = transformResponse("r4", { id: 1 });
    expect(result?.transformed).toHaveProperty("version", "v2");
  });

  it("returns null for unknown rule", () => {
    expect(transformResponse("unknown-rule", { id: 1 })).toBeNull();
  });

  it("resets cleanly", () => {
    registerTransformRule({ ruleId: "r5", name: "X", fieldMappings: {}, excludeFields: [], envelopeKey: null, addFields: {} });
    _resetResponseTransformerForTest();
    expect(getTransformHistory().length).toBe(0);
  });
});

// ─── apiVersionRouter ────────────────────────────────────────────────────────
describe("apiVersionRouter", () => {
  beforeEach(() => _resetApiVersionRouterForTest());

  it("resolves version from path", () => {
    registerVersion({ version: "v1", status: "current", sunsetDate: null, handlerTag: "handler-v1" });
    const result = resolveVersion({ path: "/v1/users", strategy: "path" });
    expect(result?.resolvedVersion).toBe("v1");
    expect(result?.handlerTag).toBe("handler-v1");
  });

  it("resolves version from header", () => {
    registerVersion({ version: "v2", status: "current", sunsetDate: null, handlerTag: "handler-v2" });
    const result = resolveVersion({ headers: { "api-version": "v2" }, strategy: "header" });
    expect(result?.resolvedVersion).toBe("v2");
  });

  it("marks deprecated version", () => {
    registerVersion({ version: "v1", status: "deprecated", sunsetDate: "2025-01-01", handlerTag: "handler-v1" });
    const result = resolveVersion({ path: "/v1/test", strategy: "path" });
    expect(result?.deprecated).toBe(true);
    expect(result?.sunsetDate).toBe("2025-01-01");
  });

  it("falls back to default version", () => {
    registerVersion({ version: "v3", status: "current", sunsetDate: null, handlerTag: "handler-v3" });
    setDefaultVersion("v3");
    const result = resolveVersion({ path: "/no-version/test", strategy: "path" });
    expect(result?.resolvedVersion).toBe("v3");
  });

  it("returns null for unknown version", () => {
    const result = resolveVersion({ path: "/v99/test", strategy: "path" });
    expect(result).toBeNull();
  });

  it("resets cleanly", () => {
    registerVersion({ version: "v1", status: "current", sunsetDate: null, handlerTag: "h1" });
    _resetApiVersionRouterForTest();
    expect(getVersions().length).toBe(0);
  });
});

// ─── apiCircuitBreaker ───────────────────────────────────────────────────────
describe("apiCircuitBreaker", () => {
  beforeEach(() => _resetApiCircuitBreakerForTest());

  it("starts in closed state and allows execution", () => {
    registerCircuit({ circuitId: "cb-1", name: "UserService", failureThreshold: 3, successThreshold: 2, timeoutMs: 5000 });
    expect(canExecute("cb-1")).toBe(true);
    expect(getCircuitStatus("cb-1")?.state).toBe("closed");
  });

  it("opens circuit after failure threshold", () => {
    registerCircuit({ circuitId: "cb-2", name: "OrderService", failureThreshold: 2, successThreshold: 2, timeoutMs: 5000 });
    recordFailure("cb-2");
    recordFailure("cb-2");
    expect(getCircuitStatus("cb-2")?.state).toBe("open");
    expect(canExecute("cb-2")).toBe(false);
  });

  it("transitions to half_open after timeout", () => {
    registerCircuit({ circuitId: "cb-3", name: "PaymentService", failureThreshold: 1, successThreshold: 1, timeoutMs: 100 });
    recordFailure("cb-3");
    const result = canExecute("cb-3", Date.now() + 200);
    expect(result).toBe(true);
    expect(getCircuitStatus("cb-3")?.state).toBe("half_open");
  });

  it("closes circuit after success threshold in half_open", () => {
    registerCircuit({ circuitId: "cb-4", name: "SearchService", failureThreshold: 1, successThreshold: 2, timeoutMs: 100 });
    recordFailure("cb-4");
    canExecute("cb-4", Date.now() + 200);
    recordSuccess("cb-4");
    recordSuccess("cb-4");
    expect(getCircuitStatus("cb-4")?.state).toBe("closed");
  });

  it("resets failure count on success in closed state", () => {
    registerCircuit({ circuitId: "cb-5", name: "CacheService", failureThreshold: 3, successThreshold: 1, timeoutMs: 5000 });
    recordFailure("cb-5");
    recordSuccess("cb-5");
    expect(getCircuitStatus("cb-5")?.failureCount).toBe(0);
  });

  it("resets cleanly", () => {
    registerCircuit({ circuitId: "cb-6", name: "X", failureThreshold: 1, successThreshold: 1, timeoutMs: 1000 });
    _resetApiCircuitBreakerForTest();
    expect(getAllCircuits().length).toBe(0);
  });
});
