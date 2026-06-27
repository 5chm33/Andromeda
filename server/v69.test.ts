/**
 * v69.test.ts — Data Pipeline
 */
import { describe, it, expect, beforeEach } from "vitest";
import { definePipeline, runPipeline, getPipelineResults, _resetDataPipelineForTest } from "./dataPipelineEngine";
import { validateData } from "./dataValidator";
import { registerTransform, applyTransform, composeTransforms, listTransforms, _resetDataTransformRegistryForTest } from "./dataTransformRegistry";
import { addLineageNode, getLineageGraph, traceLineage, _resetDataLineageTrackerForTest } from "./dataLineageTracker";
import { analyzeDataQuality, getQualityReports, _resetDataQualityMonitorForTest } from "./dataQualityMonitor";
import { registerDataAsset, searchCatalog, updateAssetMetadata, listAssets, _resetDataCatalogForTest } from "./dataCatalog";

beforeEach(() => {
  _resetDataPipelineForTest();
  _resetDataTransformRegistryForTest();
  _resetDataLineageTrackerForTest();
  _resetDataQualityMonitorForTest();
  _resetDataCatalogForTest();
});

describe("dataPipelineEngine", () => {
  it("runs a simple ETL pipeline", async () => {
    definePipeline("test", [
      { name: "extract", stage: "extract", fn: async d => d },
      { name: "transform", stage: "transform", fn: async d => (d as number[]).map(x => x * 2) },
      { name: "load", stage: "load", fn: async d => d },
    ]);
    const result = await runPipeline("test", [1, 2, 3]);
    expect(result.success).toBe(true);
    expect(result.inputCount).toBe(3);
    expect(result.outputCount).toBe(3);
    expect(result.lineage).toHaveLength(3);
  });

  it("records pipeline failure", async () => {
    definePipeline("failing", [{ name: "boom", stage: "transform", fn: async () => { throw new Error("pipeline error"); } }]);
    const result = await runPipeline("failing", [1]);
    expect(result.success).toBe(false);
    expect(result.error).toContain("pipeline error");
  });

  it("tracks pipeline results", async () => {
    definePipeline("simple", [{ name: "pass", stage: "transform", fn: async d => d }]);
    await runPipeline("simple", [1, 2]);
    expect(getPipelineResults()).toHaveLength(1);
  });
});

describe("dataValidator", () => {
  it("validates a valid record", () => {
    const result = validateData({ name: "Alice", age: 30 }, { name: { type: "string", required: true }, age: { type: "number", min: 0, max: 150 } });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("catches missing required field", () => {
    const result = validateData({}, { email: { type: "string", required: true } });
    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toBe("email");
  });

  it("coerces string to number", () => {
    const result = validateData({ score: "42" }, { score: { type: "number" } });
    expect(result.valid).toBe(true);
    expect(result.coerced.score).toBe(42);
  });

  it("validates enum constraint", () => {
    const result = validateData({ status: "unknown" }, { status: { type: "string", enum: ["active", "inactive"] } });
    expect(result.valid).toBe(false);
  });
});

describe("dataTransformRegistry", () => {
  it("registers and applies a transform", () => {
    registerTransform("double", "Doubles numbers", d => (d as number) * 2);
    expect(applyTransform("double", 5)).toBe(10);
  });

  it("composes multiple transforms", () => {
    registerTransform("add1", "Add 1", d => (d as number) + 1);
    registerTransform("times3", "Times 3", d => (d as number) * 3);
    const composed = composeTransforms(["add1", "times3"]);
    expect(composed(4)).toBe(15); // (4+1)*3
  });

  it("lists all registered transforms", () => {
    registerTransform("t1", "T1", d => d);
    registerTransform("t2", "T2", d => d);
    expect(listTransforms()).toContain("t1");
    expect(listTransforms()).toContain("t2");
  });
});

describe("dataLineageTracker", () => {
  it("builds a lineage graph", () => {
    const src = addLineageNode("raw_data", "source");
    const transform = addLineageNode("cleaned_data", "transform", [src.nodeId]);
    const sink = addLineageNode("output_table", "sink", [transform.nodeId]);
    const graph = getLineageGraph();
    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges).toHaveLength(2);
    void sink;
  });

  it("traces lineage back to source", () => {
    const src = addLineageNode("source", "source");
    const t1 = addLineageNode("step1", "transform", [src.nodeId]);
    const t2 = addLineageNode("step2", "sink", [t1.nodeId]);
    const trace = traceLineage(t2.nodeId);
    expect(trace).toEqual(["source", "step1", "step2"]);
  });
});

describe("dataQualityMonitor", () => {
  it("reports perfect quality for clean data", () => {
    const records = [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }];
    const report = analyzeDataQuality("users", records, { requiredFields: ["id", "name"] });
    expect(report.completeness).toBe(1);
    expect(report.uniqueness).toBe(1);
    expect(report.issues).toHaveLength(0);
  });

  it("detects duplicate records", () => {
    const records = [{ id: 1 }, { id: 1 }, { id: 1 }];
    const report = analyzeDataQuality("dupes", records);
    expect(report.uniqueness).toBeLessThan(1);
    expect(report.issues.some(i => i.includes("Duplicate"))).toBe(true);
  });

  it("handles empty dataset", () => {
    const report = analyzeDataQuality("empty", []);
    expect(report.totalRecords).toBe(0);
    expect(report.issues).toContain("Empty dataset");
  });
});

describe("dataCatalog", () => {
  it("registers and retrieves a data asset", () => {
    const asset = registerDataAsset("orders", "table", { id: "number", amount: "number" }, "team-a", ["finance"], "Order records");
    expect(asset.assetId).toMatch(/^asset-/);
    expect(listAssets()).toHaveLength(1);
  });

  it("searches catalog by name", () => {
    registerDataAsset("user_events", "stream", {}, "team-b", ["analytics"]);
    registerDataAsset("product_catalog", "table", {}, "team-c", ["ecommerce"]);
    expect(searchCatalog("user")).toHaveLength(1);
    expect(searchCatalog("catalog")).toHaveLength(1);
  });

  it("updates asset metadata", () => {
    const asset = registerDataAsset("metrics", "table", {}, "team-d");
    updateAssetMetadata(asset.assetId, { recordCount: 1000, description: "Updated" });
    const updated = listAssets().find(a => a.assetId === asset.assetId);
    expect(updated?.recordCount).toBe(1000);
    expect(updated?.description).toBe("Updated");
  });
});
