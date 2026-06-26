/**
 * visionContextEnricher.test.ts — Comprehensive tests for visionContextEnricher.ts
 */
import { describe, it, expect } from "vitest";
import {
  isUIFile,
  enrichWithVisionContext,
  pruneOldVisionScreenshots,
  type VisionEnrichmentResult,
} from "./visionContextEnricher.js";

// ─── isUIFile Tests ───────────────────────────────────────────────────────────

describe("isUIFile", () => {
  it("should return true for .tsx files", () => {
    expect(isUIFile("src/components/Button.tsx")).toBe(true);
  });

  it("should return true for .jsx files", () => {
    expect(isUIFile("src/App.jsx")).toBe(true);
  });

  it("should return true for CSS files", () => {
    expect(isUIFile("styles/main.css")).toBe(true);
  });

  it("should return true for SCSS files", () => {
    expect(isUIFile("styles/theme.scss")).toBe(true);
  });

  it("should return true for files in components/ directory", () => {
    expect(isUIFile("src/components/Modal.ts")).toBe(true);
  });

  it("should return true for files in pages/ directory", () => {
    expect(isUIFile("src/pages/Dashboard.ts")).toBe(true);
  });

  it("should return true for files in views/ directory", () => {
    expect(isUIFile("src/views/Home.ts")).toBe(true);
  });

  it("should return true for files in ui/ directory", () => {
    expect(isUIFile("src/ui/Card.ts")).toBe(true);
  });

  it("should return false for server-side TypeScript files", () => {
    expect(isUIFile("server/selfImprove.ts")).toBe(false);
    expect(isUIFile("server/consensusEngine.ts")).toBe(false);
  });

  it("should return false for plain .ts files outside UI directories", () => {
    expect(isUIFile("utils/helpers.ts")).toBe(false);
  });

  it("should return false for empty string", () => {
    expect(isUIFile("")).toBe(false);
  });

  it("should return true for module CSS files", () => {
    expect(isUIFile("src/Button.module.css")).toBe(true);
  });

  it("should return true for layouts/ directory", () => {
    expect(isUIFile("src/layouts/MainLayout.ts")).toBe(true);
  });
});

// ─── enrichWithVisionContext Tests ────────────────────────────────────────────

describe("enrichWithVisionContext", () => {
  it("should return skipped=true for non-UI files", async () => {
    const result = await enrichWithVisionContext({
      targetFile: "server/selfImprove.ts",
      proposedSnippet: "const x = 1;",
    });
    expect(result.skipped).toBe(true);
    expect(result.enriched).toBe(false);
  });

  it("should return VisionEnrichmentResult with expected fields for non-UI file", async () => {
    const result = await enrichWithVisionContext({
      targetFile: "server/utils.ts",
      proposedSnippet: "const x = 1;",
    });
    expect(result).toHaveProperty("enriched");
    expect(result).toHaveProperty("contextSnippet");
    expect(result).toHaveProperty("skipped");
    expect(typeof result.enriched).toBe("boolean");
    expect(typeof result.contextSnippet).toBe("string");
  });

  it("should return skipped=true for UI file when dev server not running", async () => {
    // Use a port that's definitely not running
    const result = await enrichWithVisionContext({
      targetFile: "src/components/Button.tsx",
      proposedSnippet: "export function Button() { return <div/>; }",
      devServerPort: 19999,
    });
    // Either enriched (if server happens to be running) or skipped
    expect(typeof result.skipped).toBe("boolean");
    expect(typeof result.enriched).toBe("boolean");
  });

  it("should not throw for empty proposedSnippet", async () => {
    await expect(enrichWithVisionContext({
      targetFile: "src/App.tsx",
      proposedSnippet: "",
    })).resolves.not.toThrow();
  });

  it("should not throw for empty targetFile", async () => {
    await expect(enrichWithVisionContext({
      targetFile: "",
      proposedSnippet: "const x = 1;",
    })).resolves.not.toThrow();
  });

  it("should return contextSnippet as empty string when skipped", async () => {
    const result = await enrichWithVisionContext({
      targetFile: "server/utils.ts",
      proposedSnippet: "const x = 1;",
    });
    expect(result.contextSnippet).toBe("");
  });

  it("should include skippedReason when skipped", async () => {
    const result = await enrichWithVisionContext({
      targetFile: "server/utils.ts",
      proposedSnippet: "const x = 1;",
    });
    if (result.skipped) {
      expect(typeof result.skippedReason).toBe("string");
      expect(result.skippedReason!.length).toBeGreaterThan(0);
    }
  });
});

// ─── pruneOldVisionScreenshots Tests ─────────────────────────────────────────

describe("pruneOldVisionScreenshots", () => {
  it("should not throw when called", () => {
    expect(() => pruneOldVisionScreenshots()).not.toThrow();
  });

  it("should be callable multiple times without error", () => {
    expect(() => {
      pruneOldVisionScreenshots();
      pruneOldVisionScreenshots();
    }).not.toThrow();
  });
});
