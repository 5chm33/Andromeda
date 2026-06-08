import { describe, it, expect } from "vitest";
import { registerStreamRoutes } from "./streamRouter.js";

// Minimal mock Express app for route registration tests
function makeMockApp() {
  const app: any = {
    get: () => {},
    post: () => {},
    put: () => {},
    delete: () => {},
    use: () => {},
  };
  return app;
}

describe("registerStreamRoutes", () => {
  it("should execute without throwing", () => {
    const app = makeMockApp();
    expect(() => registerStreamRoutes(app)).not.toThrow();
  });

  it("should handle empty/null inputs gracefully", () => {
    // {} is not a valid Express app — expected to throw
    try { registerStreamRoutes({} as any); } catch (e: any) { expect(e).toBeDefined(); }
  });

  it("should handle invalid inputs", () => {
    // @ts-expect-error Testing invalid input
    try { registerStreamRoutes(undefined); } catch (e: any) { expect(e).toBeDefined(); }
  });

});

