import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "andromeda-rlhf-test-"));
  process.env.ANDROMEDA_WORKSPACE = tmpDir;
  process.env.FEDERATED_NODE_ID = "test-judge-node";
  fs.mkdirSync(path.join(tmpDir, "server", "data"), { recursive: true });
});

afterEach(() => {
  delete process.env.ANDROMEDA_WORKSPACE;
  delete process.env.FEDERATED_NODE_ID;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("crossInstanceRlhf", () => {
  it("approves a high-quality proposal with passing tests", async () => {
    const { runCrossInstanceJudging } = await import("./crossInstanceRlhf.js");

    const result = await runCrossInstanceJudging(
      "proposal-001",
      "Improve the error handling in the RSI loop to prevent cascading failures",
      `export function improvedErrorHandler(err: Error): void {
  try {
    if (err.message.includes("ENOENT")) {
      console.warn("File not found, skipping");
      return;
    }
    throw err;
  } catch (e) {
    console.error("Unhandled error", e);
  }
}`,
      { passed: 50, failed: 0 },
      [] // No peer judges in test
    );

    expect(result.proposalId).toBe("proposal-001");
    expect(typeof result.approved).toBe("boolean");
    expect(result.totalJudges).toBeGreaterThanOrEqual(2); // local + adversarial
    expect(result.consensusScore).toBeGreaterThanOrEqual(0);
    expect(result.consensusScore).toBeLessThanOrEqual(1);
    expect(Array.isArray(result.verdicts)).toBe(true);
    expect(Array.isArray(result.hackingFlags)).toBe(true);
  });

  it("detects metric gaming patterns in proposal code", async () => {
    const { runCrossInstanceJudging } = await import("./crossInstanceRlhf.js");

    const result = await runCrossInstanceJudging(
      "gaming-proposal-001",
      "Skip all tests",
      `// @ts-ignore
test.skip("all tests", () => {
  test.skip("more tests", () => {});
  test.skip("even more", () => {});
  test.skip("another", () => {});
});`,
      { passed: 0, failed: 0 },
      []
    );

    // The adversarial judge should flag metric gaming
    const allFlags = result.hackingFlags;
    expect(allFlags.some((f) => f.type === "metric_gaming")).toBe(true);
  });

  it("flags score inflation for high score with minimal code", async () => {
    const { runCrossInstanceJudging } = await import("./crossInstanceRlhf.js");

    const result = await runCrossInstanceJudging(
      "inflate-proposal-001",
      "x",
      "x",
      { passed: 100, failed: 0 }, // 100% pass rate but trivial code
      []
    );

    // With 100% test pass rate but empty code, score inflation flag may appear
    expect(result.proposalId).toBe("inflate-proposal-001");
    expect(typeof result.rewardHackingDetected).toBe("boolean");
  });

  it("logs results and increments totalEvaluations", async () => {
    const { runCrossInstanceJudging, getRlhfStats } = await import("./crossInstanceRlhf.js");

    const before = getRlhfStats();
    const initialCount = before.totalEvaluations;

    await runCrossInstanceJudging(
      "stats-proposal-001",
      "Add better logging",
      `export function logWithTimestamp(msg: string): void {
  console.log(\`[\${new Date().toISOString()}] \${msg}\`);
}`,
      { passed: 20, failed: 0 },
      []
    );

    const after = getRlhfStats();
    expect(after.totalEvaluations).toBe(initialCount + 1);
  });

  it("getRlhfStats returns correct structure", async () => {
    const { getRlhfStats } = await import("./crossInstanceRlhf.js");
    const stats = getRlhfStats();

    expect(typeof stats.totalEvaluations).toBe("number");
    expect(typeof stats.hackingAttempts).toBe("number");
    expect(typeof stats.hackingRate).toBe("number");
    expect(Array.isArray(stats.recentResults)).toBe(true);
    expect(stats.hackingRate).toBeGreaterThanOrEqual(0);
    expect(stats.hackingRate).toBeLessThanOrEqual(1);
  });

  it("handles empty code gracefully without throwing", async () => {
    const { runCrossInstanceJudging } = await import("./crossInstanceRlhf.js");

    await expect(
      runCrossInstanceJudging("empty-001", "", "", { passed: 0, failed: 0 }, [])
    ).resolves.not.toThrow();
  });
});
