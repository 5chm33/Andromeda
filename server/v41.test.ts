import { describe, it, expect } from "vitest";

import {
  profileOperation, getEnergyBudget, getEnergyReport, initEnergyProfiler,
} from "./energyProfiler";

import {
  allocateMemory, accessMemory, optimizeMemory, getMemoryReport, initMemoryOptimizer,
} from "./memoryOptimizer";

import {
  recordLatency, predictLatency, getLatencyReport, initLatencyPredictor,
} from "./latencyPredictor";

import {
  configureThroughput, recordBatch, getOptimalBatchSize, getThroughputReport, initThroughputMaximizer,
} from "./throughputMaximizer";

import {
  estimateCost, recordActualCost, addCostModel, getCostReport, initCostEstimator,
} from "./costEstimator";

import {
  runResourceAuction, getAuctionReport, initResourceAuctioneer,
} from "./resourceAuctioneer";

describe("v41 Resource Oracle Enhancements", () => {

  // ─── Energy Profiler ──────────────────────────────────────────────────────────
  describe("Energy Profiler", () => {
    it("should initialize without errors", () => {
      expect(() => initEnergyProfiler()).not.toThrow();
    });

    it("should profile an operation", () => {
      const profile = profileOperation("llm_inference", 1000);
      expect(profile.operationType).toBe("llm_inference");
      expect(profile.energyJoules).toBeGreaterThan(0);
      expect(profile.carbonGrams).toBeGreaterThan(0);
    });

    it("should track energy budget", () => {
      profileOperation("embedding", 500);
      const budget = getEnergyBudget();
      expect(budget.usedJoules).toBeGreaterThan(0);
      expect(budget.remainingJoules).toBeGreaterThanOrEqual(0);
      expect(budget.utilizationRate).toBeGreaterThan(0);
    });

    it("should compute efficiency", () => {
      const profile = profileOperation("training_step", 10000);
      expect(profile.efficiency).toBeGreaterThan(0);
    });

    it("should return energy report", () => {
      const report = getEnergyReport();
      expect(typeof report.totalOperations).toBe("number");
      expect(typeof report.totalEnergyJoules).toBe("number");
      expect(typeof report.totalCarbonGrams).toBe("number");
    });
  });

  // ─── Memory Optimizer ─────────────────────────────────────────────────────────
  describe("Memory Optimizer", () => {
    it("should initialize without errors", () => {
      expect(() => initMemoryOptimizer()).not.toThrow();
    });

    it("should allocate memory", () => {
      const alloc = allocateMemory("model_weights", 1024 * 1024 * 100);
      expect(alloc.id).toBeTruthy();
      expect(alloc.sizeBytes).toBe(1024 * 1024 * 100);
      expect(alloc.tier).toBe("warm");
    });

    it("should access memory and increase frequency", () => {
      const alloc = allocateMemory("kv_cache", 1024 * 1024 * 50, "warm");
      const result = accessMemory(alloc.id);
      expect(result).toBe(true);
    });

    it("should return false for unknown allocation", () => {
      const result = accessMemory("non-existent-id");
      expect(result).toBe(false);
    });

    it("should run optimization", () => {
      allocateMemory("temp_buffer", 1024 * 100, "warm");
      const result = optimizeMemory();
      expect(typeof result.promotedCount).toBe("number");
      expect(typeof result.bytesFreed).toBe("number");
    });

    it("should return memory report", () => {
      const report = getMemoryReport();
      expect(typeof report.totalAllocations).toBe("number");
      expect(typeof report.totalBytesAllocated).toBe("number");
      expect(["low", "medium", "high", "critical"]).toContain(report.pressureLevel);
    });
  });

  // ─── Latency Predictor ────────────────────────────────────────────────────────
  describe("Latency Predictor", () => {
    it("should initialize without errors", () => {
      expect(() => initLatencyPredictor()).not.toThrow();
    });

    it("should record latency observations", () => {
      recordLatency("inference", 120);
      recordLatency("inference", 135);
      recordLatency("inference", 110);
      const prediction = predictLatency("inference");
      expect(prediction.sampleCount).toBeGreaterThanOrEqual(3);
    });

    it("should predict P50 and P99", () => {
      for (let i = 0; i < 20; i++) recordLatency("embedding", 50 + i * 5);
      const prediction = predictLatency("embedding");
      expect(prediction.predictedP50Ms).toBeGreaterThan(0);
      expect(prediction.predictedP99Ms).toBeGreaterThanOrEqual(prediction.predictedP50Ms);
    });

    it("should return low confidence for unknown operation", () => {
      const prediction = predictLatency("unknown_op_xyz");
      expect(prediction.confidence).toBeLessThan(0.5);
    });

    it("should return latency report", () => {
      const report = getLatencyReport();
      expect(typeof report.totalObservations).toBe("number");
      expect(Array.isArray(report.operationTypes)).toBe(true);
    });
  });

  // ─── Throughput Maximizer ─────────────────────────────────────────────────────
  describe("Throughput Maximizer", () => {
    it("should initialize without errors", () => {
      expect(() => initThroughputMaximizer()).not.toThrow();
    });

    it("should configure throughput settings", () => {
      expect(() => configureThroughput({ maxConcurrency: 16, targetThroughputOpsPerSec: 2000 })).not.toThrow();
    });

    it("should record a batch and return metrics", () => {
      const metrics = recordBatch(100, 50);
      expect(metrics.currentOpsPerSec).toBeGreaterThan(0);
      expect(metrics.peakOpsPerSec).toBeGreaterThan(0);
    });

    it("should track peak throughput", () => {
      recordBatch(1000, 100);
      recordBatch(500, 200);
      const report = getThroughputReport();
      expect(report.peakThroughput).toBeGreaterThan(0);
    });

    it("should return optimal batch size", () => {
      const batchSize = getOptimalBatchSize();
      expect(batchSize).toBeGreaterThan(0);
    });

    it("should return throughput report", () => {
      const report = getThroughputReport();
      expect(typeof report.totalOpsProcessed).toBe("number");
      expect(Array.isArray(report.bottlenecks)).toBe(true);
    });
  });

  // ─── Cost Estimator ───────────────────────────────────────────────────────────
  describe("Cost Estimator", () => {
    it("should initialize without errors", () => {
      expect(() => initCostEstimator()).not.toThrow();
    });

    it("should estimate cost for LLM inference", () => {
      const estimate = estimateCost("llm_inference", 1_000_000);
      expect(estimate.estimatedCost).toBeGreaterThan(0);
      expect(estimate.operationType).toBe("llm_inference");
    });

    it("should record actual cost and compute ROI", () => {
      const estimate = estimateCost("api_call", 1_000_000);
      recordActualCost(estimate.operationId, 0.001, 0.005);
      const report = getCostReport();
      expect(report.totalActualCost).toBeGreaterThan(0);
    });

    it("should add custom cost model", () => {
      addCostModel({ operationType: "custom_op", costPerUnit: 0.005, unitType: "api_calls" });
      const estimate = estimateCost("custom_op", 1_000_000);
      expect(estimate.estimatedCost).toBeGreaterThan(0);
    });

    it("should return cost report", () => {
      const report = getCostReport();
      expect(typeof report.totalEstimatedCost).toBe("number");
      expect(typeof report.budgetUtilization).toBe("number");
    });
  });

  // ─── Resource Auctioneer ──────────────────────────────────────────────────────
  describe("Resource Auctioneer", () => {
    it("should initialize without errors", () => {
      expect(() => initResourceAuctioneer()).not.toThrow();
    });

    it("should run a CPU auction and allocate to highest bidder", () => {
      const result = runResourceAuction("cpu", [
        { bidderId: "agent1", resourceType: "cpu", quantity: 20, maxWillingnessToPay: 0.5, priority: 1, deadline: Date.now() + 1000 },
        { bidderId: "agent2", resourceType: "cpu", quantity: 30, maxWillingnessToPay: 0.3, priority: 2, deadline: Date.now() + 2000 },
      ]);
      expect(result.winners.length).toBeGreaterThan(0);
      expect(result.winners[0]!.bidderId).toBe("agent1");
    });

    it("should compute efficiency > 0", () => {
      const result = runResourceAuction("memory", [
        { bidderId: "agentA", resourceType: "memory", quantity: 100, maxWillingnessToPay: 1.0, priority: 1, deadline: Date.now() },
        { bidderId: "agentB", resourceType: "memory", quantity: 200, maxWillingnessToPay: 0.8, priority: 2, deadline: Date.now() },
      ]);
      expect(result.efficiency).toBeGreaterThan(0);
    });

    it("should handle empty bids", () => {
      const result = runResourceAuction("gpu", []);
      expect(result.winners.length).toBe(0);
      expect(result.totalAllocated).toBe(0);
    });

    it("should return auction report", () => {
      const report = getAuctionReport();
      expect(typeof report.totalAuctions).toBe("number");
      expect(typeof report.avgEfficiency).toBe("number");
    });
  });
});
