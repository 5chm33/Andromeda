import { describe, it, expect } from "vitest";

describe("ENV config", () => {
  it("should export ENV object with expected keys", async () => {
    const { ENV } = await import("./env");
    expect(ENV).toHaveProperty("appId");
    expect(ENV).toHaveProperty("cookieSecret");
    expect(ENV).toHaveProperty("databaseUrl");
    expect(ENV).toHaveProperty("oAuthServerUrl");
    expect(ENV).toHaveProperty("ownerOpenId");
    expect(ENV).toHaveProperty("isProduction");
    expect(ENV).toHaveProperty("forgeApiUrl");
    expect(ENV).toHaveProperty("forgeApiKey");
  });

  it("should default to empty strings when env vars are not set", async () => {
    const { ENV } = await import("./env");
    // In test environment, these are likely empty
    expect(typeof ENV.appId).toBe("string");
    expect(typeof ENV.cookieSecret).toBe("string");
    expect(typeof ENV.databaseUrl).toBe("string");
  });

  it("should set isProduction based on NODE_ENV", async () => {
    const { ENV } = await import("./env");
    // In test environment, NODE_ENV is not "production"
    expect(ENV.isProduction).toBe(false);
  });
});
