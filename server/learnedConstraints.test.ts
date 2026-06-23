import { describe, it, expect } from "vitest";
import {
  addLearnedConstraint,
  getLearnedConstraints,
  getAllConstraints,
  checkLearnedConstraints,
  disableConstraint,
  recordRejection,
} from "./learnedConstraints.js";

describe("learnedConstraints", () => {
  it("addLearnedConstraint adds a new constraint and returns it", () => {
    const c = addLearnedConstraint("process.exit(", "Never call process.exit in server code");
    expect(c).toBeDefined();
    expect(c.pattern).toBe("process.exit(");
    expect(c.reason).toBe("Never call process.exit in server code");
    expect(c.active).toBe(true);
    expect(typeof c.id).toBe("string");
  });

  it("getLearnedConstraints returns only active constraints", () => {
    const constraints = getLearnedConstraints();
    expect(Array.isArray(constraints)).toBe(true);
    constraints.forEach(c => expect(c.active).toBe(true));
  });

  it("getAllConstraints returns all constraints", () => {
    const all = getAllConstraints();
    expect(Array.isArray(all)).toBe(true);
    expect(all.length).toBeGreaterThanOrEqual(getLearnedConstraints().length);
  });

  it("checkLearnedConstraints detects a known bad pattern", () => {
    // Use a simple substring pattern (not a regex special char pattern)
    addLearnedConstraint("UNSAFE_EVAL_MARKER", "unsafe eval marker for testing");
    const match = checkLearnedConstraints("const result = UNSAFE_EVAL_MARKER(code)");
    expect(match).not.toBeNull();
    expect(match?.pattern).toBe("UNSAFE_EVAL_MARKER");
  });

  it("checkLearnedConstraints returns null for safe code", () => {
    const match = checkLearnedConstraints("const x = 1 + 2;");
    expect(match).toBeNull();
  });

  it("disableConstraint disables a constraint by id", () => {
    const c = addLearnedConstraint("__dangerousHook__", "test constraint to disable");
    const result = disableConstraint(c.id);
    expect(result).toBe(true);
    const all = getAllConstraints();
    const found = all.find(x => x.id === c.id);
    expect(found?.active).toBe(false);
  });

  it("recordRejection runs without throwing", () => {
    expect(() => recordRejection("delete fs.rmSync", "rmSync is too destructive")).not.toThrow();
  });
});
