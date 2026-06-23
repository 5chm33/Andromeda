import { describe, it, expect } from "vitest";
import * as mod from "./ai.js";

describe("ai module", () => {
  it("should load without errors", () => {
    expect(mod).toBeDefined();
    expect(typeof mod).toBe("object");
  });
});
