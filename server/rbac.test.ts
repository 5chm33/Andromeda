import { describe, it, expect } from "vitest";
import { roleAtLeast } from "./rbac.js";

describe("rbac", () => {
  it("exports roleAtLeast", () => {
    expect(typeof roleAtLeast).toBe("function");
  });

  it("admin satisfies admin requirement", () => {
    expect(roleAtLeast("admin", "admin")).toBe(true);
  });

  it("guest satisfies guest requirement", () => {
    expect(roleAtLeast("guest", "guest")).toBe(true);
  });

  it("admin satisfies guest requirement", () => {
    expect(roleAtLeast("admin", "guest")).toBe(true);
  });

  it("guest does not satisfy admin requirement", () => {
    expect(roleAtLeast("guest", "admin")).toBe(false);
  });

  it("system satisfies admin requirement", () => {
    expect(roleAtLeast("system", "admin")).toBe(true);
  });
});
