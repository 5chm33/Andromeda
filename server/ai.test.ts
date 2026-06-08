import { describe, it, expect } from "vitest";

describe("ai module", () => {
  it("module loads without throwing", async () => {
    await expect(import("./ai.js")).resolves.toBeDefined();
  });
});
