import { describe, it, expect } from "vitest";
import {
  dbSaveProposal,
  dbLoadProposals,
  dbLoadCycles,
  getRsiDbStatus,
  runRsiDbMigration,
} from "./rsiDb.js";

describe("rsiDb", () => {
  it("getRsiDbStatus returns a status object with expected shape", () => {
    const status = getRsiDbStatus();
    expect(status).toBeDefined();
    expect(typeof status.available).toBe("boolean");
    // url can be string or null
    expect(status.url === null || typeof status.url === "string").toBe(true);
    expect(Array.isArray(status.tables)).toBe(true);
  });

  it("runRsiDbMigration runs without throwing (no-op when DB unavailable)", async () => {
    await expect(runRsiDbMigration()).resolves.not.toThrow();
  });

  it("dbSaveProposal runs without throwing when DB unavailable", async () => {
    const proposal = {
      id: "test-proposal-001",
      targetFile: "server/selfImprove.ts",
      title: "Test proposal",
      rationale: "Test rationale",
      category: "performance" as const,
      impact: "low" as const,
      confidence: 0.8,
      originalSnippet: "const x = 1;",
      proposedSnippet: "const x = 2;",
      proposedContent: "const x = 2;",
      originalContent: "const x = 1;",
      status: "pending" as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await expect(dbSaveProposal(proposal)).resolves.not.toThrow();
  });

  it("dbLoadProposals returns an array (empty when DB unavailable)", async () => {
    const proposals = await dbLoadProposals();
    expect(Array.isArray(proposals)).toBe(true);
  });

  it("dbLoadCycles returns an array (empty when DB unavailable)", async () => {
    const cycles = await dbLoadCycles();
    expect(Array.isArray(cycles)).toBe(true);
  });
});
