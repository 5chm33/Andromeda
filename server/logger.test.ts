import { describe, expect, it, vi } from "vitest";
import { createLogger } from "./logger";

describe("Logger Module", () => {
  describe("createLogger", () => {
    it("creates a logger with the specified module name", () => {
      const log = createLogger("testModule");
      expect(log).toBeDefined();
      expect(typeof log.info).toBe("function");
      expect(typeof log.warn).toBe("function");
      expect(typeof log.error).toBe("function");
      expect(typeof log.caught).toBe("function");
    });

    it("info logs without throwing", () => {
      const log = createLogger("testModule");
      expect(() => log.info("test message")).not.toThrow();
    });

    it("warn logs without throwing", () => {
      const log = createLogger("testModule");
      expect(() => log.warn("warning message")).not.toThrow();
    });

    it("error logs without throwing", () => {
      const log = createLogger("testModule");
      expect(() => log.error("error message")).not.toThrow();
    });

    it("caught handles Error objects", () => {
      const log = createLogger("testModule");
      const err = new Error("test error");
      expect(() => log.caught("operation", err)).not.toThrow();
    });

    it("caught handles non-Error values", () => {
      const log = createLogger("testModule");
      expect(() => log.caught("operation", "string error")).not.toThrow();
      expect(() => log.caught("operation", null)).not.toThrow();
      expect(() => log.caught("operation", undefined)).not.toThrow();
      expect(() => log.caught("operation", 42)).not.toThrow();
    });
  });
});
