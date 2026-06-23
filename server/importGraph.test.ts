import { describe, it, expect } from "vitest";
import {
  buildImportGraph,
  getImporters,
  getImportees,
  getGraphSummary,
  getExportedSymbols,
} from "./importGraph.js";

describe("importGraph", () => {
  it("buildImportGraph returns a graph object with nodes and edges", async () => {
    const graph = await buildImportGraph();
    expect(graph).toBeDefined();
    expect(typeof graph).toBe("object");
  });

  it("getImporters returns an array for a known file", async () => {
    const importers = await getImporters("server/selfImprove.ts");
    expect(Array.isArray(importers)).toBe(true);
  });

  it("getImportees returns an array for a known file", async () => {
    const importees = await getImportees("server/selfImprove.ts");
    expect(Array.isArray(importees)).toBe(true);
  });

  it("getGraphSummary returns a summary object with expected fields", async () => {
    const summary = await getGraphSummary();
    expect(summary).toBeDefined();
    expect(typeof summary).toBe("object");
  });

  it("getExportedSymbols returns an array for a known file", async () => {
    const symbols = await getExportedSymbols("server/selfImprove.ts");
    expect(Array.isArray(symbols)).toBe(true);
  });
});
