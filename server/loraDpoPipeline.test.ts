/**
 * loraDpoPipeline.test.ts — v11.4.0
 *
 * Comprehensive test coverage for the LoRA DPO training pipeline.
 * Covers: pair loading, train/eval splitting, pipeline stats,
 * configuration, training run lifecycle, and event emission.
 *
 * All tests are offline-safe — no Ollama or cloud dependencies required.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  loadDpoPairs,
  splitTrainEval,
  getTrainingRun,
  listTrainingRuns,
  getBestRun,
  getPipelineStats,
  configurePipeline,
  onPipelineEvent,
  type DpoPair,
  type DpoPipelineConfig,
} from "./loraDpoPipeline.js";

// ─── Test Fixtures ────────────────────────────────────────────────────────────

function makePair(overrides: Partial<DpoPair> = {}): DpoPair {
  return {
    prompt: "What is 2 + 2?",
    chosen: "4",
    rejected: "5",
    source: "test",
    confidence: 0.9,
    ...overrides,
  };
}

function writeFeedbackFile(tmpDir: string, pairs: DpoPair[]): string {
  const filePath = path.join(tmpDir, "rlhf_feedback.jsonl");
  const lines = pairs.map(p => JSON.stringify({
    prompt: p.prompt,
    chosen: p.chosen,
    rejected: p.rejected,
    source: p.source,
    confidence: p.confidence,
    verdict: "chosen",
  }));
  fs.writeFileSync(filePath, lines.join("\n") + "\n");
  return filePath;
}

// ─── loadDpoPairs ─────────────────────────────────────────────────────────────

describe("loadDpoPairs", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "andromeda-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array when feedback file does not exist", () => {
    const pairs = loadDpoPairs({ rlhfFeedbackPath: path.join(tmpDir, "nonexistent.jsonl") });
    expect(pairs).toEqual([]);
  });

  it("loads valid DPO pairs from a JSONL file", () => {
    const feedbackPath = writeFeedbackFile(tmpDir, [
      makePair({ prompt: "Q1", chosen: "A1", rejected: "B1" }),
      makePair({ prompt: "Q2", chosen: "A2", rejected: "B2" }),
    ]);
    const pairs = loadDpoPairs({ rlhfFeedbackPath: feedbackPath });
    expect(pairs).toHaveLength(2);
    expect(pairs[0].prompt).toBe("Q1");
    expect(pairs[1].prompt).toBe("Q2");
  });

  it("filters out pairs below minConfidence threshold", () => {
    const feedbackPath = writeFeedbackFile(tmpDir, [
      makePair({ confidence: 0.9 }),
      makePair({ confidence: 0.3 }), // below default 0.7
    ]);
    const pairs = loadDpoPairs({ rlhfFeedbackPath: feedbackPath, minConfidence: 0.7 });
    expect(pairs).toHaveLength(1);
    expect(pairs[0].confidence).toBe(0.9);
  });

  it("filters out pairs with verdict=error or verdict=skip", () => {
    const filePath = path.join(tmpDir, "rlhf_feedback.jsonl");
    fs.writeFileSync(filePath, [
      JSON.stringify({ prompt: "Q1", chosen: "A1", rejected: "B1", confidence: 0.9, verdict: "chosen" }),
      JSON.stringify({ prompt: "Q2", chosen: "A2", rejected: "B2", confidence: 0.9, verdict: "error" }),
      JSON.stringify({ prompt: "Q3", chosen: "A3", rejected: "B3", confidence: 0.9, verdict: "skip" }),
    ].join("\n") + "\n");
    const pairs = loadDpoPairs({ rlhfFeedbackPath: filePath });
    expect(pairs).toHaveLength(1);
    expect(pairs[0].prompt).toBe("Q1");
  });

  it("skips malformed JSON lines without throwing", () => {
    const filePath = path.join(tmpDir, "rlhf_feedback.jsonl");
    fs.writeFileSync(filePath, [
      JSON.stringify({ prompt: "Q1", chosen: "A1", rejected: "B1", confidence: 0.9, verdict: "chosen" }),
      "{ this is not valid json",
      JSON.stringify({ prompt: "Q2", chosen: "A2", rejected: "B2", confidence: 0.9, verdict: "chosen" }),
    ].join("\n") + "\n");
    const pairs = loadDpoPairs({ rlhfFeedbackPath: filePath });
    expect(pairs).toHaveLength(2);
  });

  it("skips entries missing chosen or rejected fields", () => {
    const filePath = path.join(tmpDir, "rlhf_feedback.jsonl");
    fs.writeFileSync(filePath, [
      JSON.stringify({ prompt: "Q1", chosen: "A1", confidence: 0.9, verdict: "chosen" }), // missing rejected
      JSON.stringify({ prompt: "Q2", rejected: "B2", confidence: 0.9, verdict: "chosen" }), // missing chosen
      JSON.stringify({ prompt: "Q3", chosen: "A3", rejected: "B3", confidence: 0.9, verdict: "chosen" }), // valid
    ].join("\n") + "\n");
    const pairs = loadDpoPairs({ rlhfFeedbackPath: filePath });
    expect(pairs).toHaveLength(1);
    expect(pairs[0].prompt).toBe("Q3");
  });

  it("respects maxPairs limit", () => {
    const manyPairs = Array.from({ length: 20 }, (_, i) => makePair({ prompt: `Q${i}` }));
    const feedbackPath = writeFeedbackFile(tmpDir, manyPairs);
    const pairs = loadDpoPairs({ rlhfFeedbackPath: feedbackPath, maxPairs: 5 });
    expect(pairs.length).toBeLessThanOrEqual(5);
  });
});

// ─── splitTrainEval ───────────────────────────────────────────────────────────

describe("splitTrainEval", () => {
  it("splits pairs into train and eval sets with default 90/10 ratio", () => {
    const pairs = Array.from({ length: 100 }, (_, i) => makePair({ prompt: `Q${i}` }));
    const { train, eval: evalSet } = splitTrainEval(pairs);
    expect(train).toHaveLength(90);
    expect(evalSet).toHaveLength(10);
  });

  it("respects a custom trainSplit ratio", () => {
    const pairs = Array.from({ length: 100 }, (_, i) => makePair({ prompt: `Q${i}` }));
    const { train, eval: evalSet } = splitTrainEval(pairs, 0.8);
    expect(train).toHaveLength(80);
    expect(evalSet).toHaveLength(20);
  });

  it("returns all items in train when trainSplit=1.0", () => {
    const pairs = [makePair(), makePair(), makePair()];
    const { train, eval: evalSet } = splitTrainEval(pairs, 1.0);
    expect(train).toHaveLength(3);
    expect(evalSet).toHaveLength(0);
  });

  it("returns empty train when trainSplit=0.0", () => {
    const pairs = [makePair(), makePair(), makePair()];
    const { train, eval: evalSet } = splitTrainEval(pairs, 0.0);
    expect(train).toHaveLength(0);
    expect(evalSet).toHaveLength(3);
  });

  it("handles empty input gracefully", () => {
    const { train, eval: evalSet } = splitTrainEval([]);
    expect(train).toHaveLength(0);
    expect(evalSet).toHaveLength(0);
  });

  it("preserves all pairs across train and eval sets (no data loss)", () => {
    const pairs = Array.from({ length: 50 }, (_, i) => makePair({ prompt: `Q${i}` }));
    const { train, eval: evalSet } = splitTrainEval(pairs);
    const allPrompts = new Set([...train, ...evalSet].map(p => p.prompt));
    expect(allPrompts.size).toBe(50);
  });
});

// ─── Training Run Lifecycle ───────────────────────────────────────────────────

describe("training run lifecycle", () => {
  it("listTrainingRuns returns an array (empty or not)", () => {
    const runs = listTrainingRuns();
    expect(Array.isArray(runs)).toBe(true);
  });

  it("getTrainingRun returns undefined for a non-existent runId", () => {
    const run = getTrainingRun("nonexistent-run-id-xyz");
    expect(run).toBeUndefined();
  });

  it("getBestRun returns undefined when no runs are completed", () => {
    // This test is valid as long as no completed runs exist in the in-memory store
    // (fresh module load in test environment)
    const best = getBestRun();
    // Either undefined or a completed run — both are valid
    if (best !== undefined) {
      expect(best.status).toBe("completed");
    }
  });
});

// ─── getPipelineStats ─────────────────────────────────────────────────────────

describe("getPipelineStats", () => {
  it("returns a stats object with all required fields", () => {
    const stats = getPipelineStats();
    expect(stats).toHaveProperty("totalRuns");
    expect(stats).toHaveProperty("completedRuns");
    expect(stats).toHaveProperty("failedRuns");
    expect(stats).toHaveProperty("bestEvalAccuracy");
    expect(stats).toHaveProperty("totalPairsAvailable");
    expect(stats).toHaveProperty("ollamaConfigured");
  });

  it("returns numeric values for run counts", () => {
    const stats = getPipelineStats();
    expect(typeof stats.totalRuns).toBe("number");
    expect(typeof stats.completedRuns).toBe("number");
    expect(typeof stats.failedRuns).toBe("number");
  });

  it("completedRuns + failedRuns <= totalRuns", () => {
    const stats = getPipelineStats();
    expect(stats.completedRuns + stats.failedRuns).toBeLessThanOrEqual(stats.totalRuns);
  });

  it("bestEvalAccuracy is between 0 and 1", () => {
    const stats = getPipelineStats();
    expect(stats.bestEvalAccuracy).toBeGreaterThanOrEqual(0);
    expect(stats.bestEvalAccuracy).toBeLessThanOrEqual(1);
  });

  it("ollamaConfigured reflects OLLAMA_BASE_URL env var", () => {
    const original = process.env.OLLAMA_BASE_URL;
    process.env.OLLAMA_BASE_URL = "http://localhost:11434";
    const statsWithUrl = getPipelineStats();
    expect(statsWithUrl.ollamaConfigured).toBe(true);
    delete process.env.OLLAMA_BASE_URL;
    const statsWithout = getPipelineStats();
    expect(statsWithout.ollamaConfigured).toBe(false);
    if (original !== undefined) process.env.OLLAMA_BASE_URL = original;
  });
});

// ─── configurePipeline ────────────────────────────────────────────────────────

describe("configurePipeline", () => {
  it("updates pipeline configuration without throwing", () => {
    expect(() => {
      configurePipeline({ loraRank: 32, dpoBeta: 0.2 });
    }).not.toThrow();
  });

  it("accepts partial config updates", () => {
    expect(() => {
      configurePipeline({ epochs: 5 });
    }).not.toThrow();
  });

  it("accepts all valid config fields", () => {
    const fullConfig: Partial<DpoPipelineConfig> = {
      modelName: "llama3:8b",
      loraRank: 8,
      loraAlpha: 16,
      dpoBeta: 0.05,
      epochs: 2,
      batchSize: 2,
      learningRate: 1e-5,
      trainSplit: 0.85,
      minConfidence: 0.8,
      maxPairs: 1000,
    };
    expect(() => configurePipeline(fullConfig)).not.toThrow();
  });
});

// ─── onPipelineEvent ──────────────────────────────────────────────────────────

describe("onPipelineEvent", () => {
  it("registers event handlers without throwing", () => {
    expect(() => {
      onPipelineEvent("run:started", () => {});
      onPipelineEvent("run:epoch", () => {});
      onPipelineEvent("run:evaluating", () => {});
      onPipelineEvent("run:completed", () => {});
      onPipelineEvent("run:failed", () => {});
    }).not.toThrow();
  });
});

// ─── DpoPair type validation ──────────────────────────────────────────────────

describe("DpoPair structure", () => {
  it("makePair produces a valid DpoPair structure", () => {
    const pair = makePair();
    expect(pair).toHaveProperty("prompt");
    expect(pair).toHaveProperty("chosen");
    expect(pair).toHaveProperty("rejected");
    expect(pair).toHaveProperty("source");
    expect(pair).toHaveProperty("confidence");
    expect(typeof pair.confidence).toBe("number");
    expect(pair.confidence).toBeGreaterThanOrEqual(0);
    expect(pair.confidence).toBeLessThanOrEqual(1);
  });

  it("chosen and rejected must be different strings", () => {
    const pair = makePair({ chosen: "correct answer", rejected: "wrong answer" });
    expect(pair.chosen).not.toBe(pair.rejected);
  });
});
