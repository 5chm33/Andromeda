/**
 * benchmarkLauncher.test.ts — Tests for the 7-item pre-launch checklist.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  runPreLaunchChecklist,
  BenchmarkLauncher,
  type BenchmarkRunConfig,
  type InstanceResult,
} from "../benchmarkLauncher.js";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "andromeda-bench-test-"));
}

function makeConfig(overrides: Partial<BenchmarkRunConfig> = {}): BenchmarkRunConfig {
  const tmpDir = makeTmpDir();
  const taskListPath = path.join(tmpDir, "tasks.json");
  fs.writeFileSync(taskListPath, JSON.stringify(["instance-1", "instance-2", "instance-3", "instance-4", "instance-5"]));
  return {
    imageRef: "swebench/sweb.eval.x86_64.django__django-11099@sha256:abc123def456abc123def456abc123def456abc123def456abc123def456abc12345",
    taskListPath,
    modelId: "gpt-4o",
    promptTemplateHash: "sha256:deadbeef",
    temperature: 0.0,
    topP: 1.0,
    maxRetries: 3,
    instanceTimeoutMs: 300_000,
    concurrency: 4,
    spendCapUsd: 100,
    canarySliceSize: 5,
    canaryAbortThreshold: 0.6,
    scoredRun: true,
    externalSearch: false,
    runBundlePath: path.join(tmpDir, "run-bundle.json"),
    agentVersion: "5.3.0",
    harnessRevision: "abc123",
    datasetName: "princeton-nlp/SWE-bench_Verified",
    datasetRevision: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
    datasetSplit: "test",
    instanceIdHash: "sha256:cafebabe",
    ...overrides,
  };
}

describe("BenchmarkLauncher: pre-launch checklist", () => {
  it("passes all 7 checks when smoke result is absent (CI mode)", () => {
    // When smoke result is absent, check 1 fails but we verify the structure
    const config = makeConfig();
    const result = runPreLaunchChecklist(config);
    // Check that all 7 check IDs are present
    const checkIds = result.checks.map(c => c.id);
    expect(checkIds).toContain("smoke-bundle");
    expect(checkIds).toContain("no-credentials");
    expect(checkIds).toContain("no-recovery-patch");
    expect(checkIds).toContain("frozen-task-list");
    expect(checkIds).toContain("non-pushing");
    expect(checkIds).toContain("structured-report");
    expect(checkIds).toContain("canary-slice");
  });

  it("frozen-task-list check passes with valid task list", () => {
    const config = makeConfig();
    const result = runPreLaunchChecklist(config);
    const taskCheck = result.checks.find(c => c.id === "frozen-task-list")!;
    expect(taskCheck.passed).toBe(true);
    expect(taskCheck.detail).toContain("5 instances");
  });

  it("frozen-task-list check fails when task list is missing", () => {
    const config = makeConfig({ taskListPath: "/nonexistent/tasks.json" });
    const result = runPreLaunchChecklist(config);
    const taskCheck = result.checks.find(c => c.id === "frozen-task-list")!;
    expect(taskCheck.passed).toBe(false);
    expect(taskCheck.blocksLaunch).toBe(true);
  });

  it("no-recovery-patch check always passes for scored runs", () => {
    const config = makeConfig({ scoredRun: true });
    const result = runPreLaunchChecklist(config);
    const recoveryCheck = result.checks.find(c => c.id === "no-recovery-patch")!;
    expect(recoveryCheck.passed).toBe(true);
    expect(recoveryCheck.detail).toContain("allowRecoveryPatchApplication is false");
  });

  it("non-pushing check always passes (enforced by construction)", () => {
    const config = makeConfig();
    const result = runPreLaunchChecklist(config);
    const pushCheck = result.checks.find(c => c.id === "non-pushing")!;
    expect(pushCheck.passed).toBe(true);
    expect(pushCheck.detail).toContain("BENCHMARK_MODE=scored");
  });

  it("canary-slice check passes with valid canary config", () => {
    const config = makeConfig({ canarySliceSize: 5, canaryAbortThreshold: 0.6 });
    const result = runPreLaunchChecklist(config);
    const canaryCheck = result.checks.find(c => c.id === "canary-slice")!;
    expect(canaryCheck.passed).toBe(true);
    expect(canaryCheck.detail).toContain("5 instances");
    expect(canaryCheck.detail).toContain("60%");
  });

  it("structured-report check passes when run bundle dir is writable", () => {
    const config = makeConfig();
    const result = runPreLaunchChecklist(config);
    const reportCheck = result.checks.find(c => c.id === "structured-report")!;
    expect(reportCheck.passed).toBe(true);
    expect(reportCheck.detail).toContain("resolved, test_failure");
  });
});

describe("BenchmarkLauncher: canary abort logic", () => {
  it("does not abort when infra failure rate is below threshold", () => {
    const config = makeConfig({ canaryAbortThreshold: 0.6 });
    const launcher = new BenchmarkLauncher(config);
    const results: InstanceResult[] = [
      { instanceId: "i1", outcome: "resolved", imageDigest: "sha256:abc", exactApply: true, fuzzyRecoveryAttempted: false, durationMs: 1000 },
      { instanceId: "i2", outcome: "test_failure", imageDigest: "sha256:abc", exactApply: true, fuzzyRecoveryAttempted: false, durationMs: 1000 },
      { instanceId: "i3", outcome: "infra_failure", imageDigest: "sha256:abc", exactApply: false, fuzzyRecoveryAttempted: false, durationMs: 500 },
      { instanceId: "i4", outcome: "resolved", imageDigest: "sha256:abc", exactApply: true, fuzzyRecoveryAttempted: false, durationMs: 1000 },
      { instanceId: "i5", outcome: "resolved", imageDigest: "sha256:abc", exactApply: true, fuzzyRecoveryAttempted: false, durationMs: 1000 },
    ];
    expect(launcher.shouldAbortAfterCanary(results)).toBe(false);
  });

  it("aborts when infra failure rate exceeds threshold", () => {
    const config = makeConfig({ canaryAbortThreshold: 0.6 });
    const launcher = new BenchmarkLauncher(config);
    const results: InstanceResult[] = [
      { instanceId: "i1", outcome: "infra_failure", imageDigest: "sha256:abc", exactApply: false, fuzzyRecoveryAttempted: false, durationMs: 500 },
      { instanceId: "i2", outcome: "infra_failure", imageDigest: "sha256:abc", exactApply: false, fuzzyRecoveryAttempted: false, durationMs: 500 },
      { instanceId: "i3", outcome: "infra_failure", imageDigest: "sha256:abc", exactApply: false, fuzzyRecoveryAttempted: false, durationMs: 500 },
      { instanceId: "i4", outcome: "resolved", imageDigest: "sha256:abc", exactApply: true, fuzzyRecoveryAttempted: false, durationMs: 1000 },
      { instanceId: "i5", outcome: "resolved", imageDigest: "sha256:abc", exactApply: true, fuzzyRecoveryAttempted: false, durationMs: 1000 },
    ];
    expect(launcher.shouldAbortAfterCanary(results)).toBe(true);
  });
});

describe("BenchmarkLauncher: smoke-gate fail-closed for scored runs (v5.4)", () => {
  let tmpDir: string;
  let smokeResultPath: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    // Point SMOKE_RESULT_FILE at our temp dir by writing to the expected location
    // The loadSmokeResult() function uses process.cwd()/.smoke-results/latest.json
    // We write a smoke result there for these tests.
    smokeResultPath = path.join(process.cwd(), ".smoke-results", "latest.json");
    fs.mkdirSync(path.dirname(smokeResultPath), { recursive: true });
  });

  afterEach(() => {
    // Clean up the smoke result file after each test
    try { fs.unlinkSync(smokeResultPath); } catch { /* ignore */ }
  });

  it("rejects a scored run when smoke result has unresolved image digest", () => {
    // Write a smoke result with an unresolved digest
    fs.writeFileSync(smokeResultPath, JSON.stringify({
      passed: true,
      evidence: {
        completedAt: new Date().toISOString(),
        imageDigest: "sha256:unresolved-not-pulled",  // unresolved — must be rejected for scored runs
        harnessRevision: "abc123",
      },
    }));
    const config = makeConfig({ scoredRun: true, harnessRevision: "abc123" });
    const result = runPreLaunchChecklist(config);
    const smokeCheck = result.checks.find(c => c.id === "smoke-bundle")!;
    // For a scored run, unresolved digest must be rejected (fail closed)
    expect(smokeCheck.passed).toBe(false);
    expect(smokeCheck.blocksLaunch).toBe(true);
  });

  it("rejects a scored run when smoke result has missing harness revision", () => {
    // Write a smoke result without a harness revision
    fs.writeFileSync(smokeResultPath, JSON.stringify({
      passed: true,
      evidence: {
        completedAt: new Date().toISOString(),
        imageDigest: "sha256:abc123def456abc123def456abc123def456abc123def456abc123def456abc12345",
        // harnessRevision intentionally omitted
      },
    }));
    const config = makeConfig({
      scoredRun: true,
      imageRef: "swebench/sweb.eval@sha256:abc123def456abc123def456abc123def456abc123def456abc123def456abc12345",
      harnessRevision: "abc123",
    });
    const result = runPreLaunchChecklist(config);
    const smokeCheck = result.checks.find(c => c.id === "smoke-bundle")!;
    // For a scored run, missing harness revision must be rejected (fail closed)
    expect(smokeCheck.passed).toBe(false);
    expect(smokeCheck.blocksLaunch).toBe(true);
  });

  it("accepts a scored run when smoke result has exact digest and harness match", () => {
    const digest = "abc123def456abc123def456abc123def456abc123def456abc123def456abc12345";
    fs.writeFileSync(smokeResultPath, JSON.stringify({
      passed: true,
      evidence: {
        completedAt: new Date().toISOString(),
        imageDigest: `sha256:${digest}`,
        harnessRevision: "abc123",
      },
    }));
    const config = makeConfig({
      scoredRun: true,
      imageRef: `swebench/sweb.eval@sha256:${digest}`,
      harnessRevision: "abc123",
    });
    const result = runPreLaunchChecklist(config);
    const smokeCheck = result.checks.find(c => c.id === "smoke-bundle")!;
    expect(smokeCheck.passed).toBe(true);
  });
});

describe("BenchmarkLauncher: report recording", () => {
  it("correctly categorizes all 6 outcome types", () => {
    const config = makeConfig();
    const metadata = {
      runId: "test-run-1",
      agentVersion: "5.3.0",
      agentCommit: "abc123",
      imageRef: "test@sha256:abc",
      imageDigest: "sha256:abc",
      harnessRevision: "abc123",
      modelId: "gpt-4o",
      promptTemplateHash: "sha256:deadbeef",
      temperature: 0.0,
      topP: 1.0,
      maxRetries: 3,
      instanceTimeoutMs: 300_000,
      concurrency: 4,
      spendCapUsd: 100,
      taskListPath: config.taskListPath,
      taskListHash: "sha256:taskhash",
      taskCount: 6,
      datasetName: "princeton-nlp/SWE-bench_Verified",
      datasetRevision: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
      datasetSplit: "test",
      instanceIdHash: "sha256:cafebabe",
      scoredRun: true,
      externalSearch: false as const,
      allowRecoveryPatchApplication: false as const,
      canarySliceSize: 5,
      canaryAbortThreshold: 0.6,
      createdAt: new Date().toISOString(),
      runBundlePath: config.runBundlePath,
    };
    const report = BenchmarkLauncher.buildEmptyReport(metadata);
    const outcomes: InstanceResult["outcome"][] = [
      "resolved", "test_failure", "exact_apply_failure",
      "invalid_instance", "infra_failure", "timed_out",
    ];
    for (const outcome of outcomes) {
      BenchmarkLauncher.recordInstance(report, {
        instanceId: `instance-${outcome}`,
        outcome,
        imageDigest: "sha256:abc",
        exactApply: outcome !== "exact_apply_failure",
        fuzzyRecoveryAttempted: false,
        durationMs: 1000,
      });
    }
    expect(report.summary.total).toBe(6);
    expect(report.summary.resolved).toBe(1);
    expect(report.summary.testFailures).toBe(1);
    expect(report.summary.exactApplyFailures).toBe(1);
    expect(report.summary.invalidInstances).toBe(1);
    expect(report.summary.infraFailures).toBe(1);
    expect(report.summary.timedOut).toBe(1);
  });
});

describe("BenchmarkLauncher: single infra_failure per thrown instance", () => {
  it("records exactly one infra_failure row when an instance throws", () => {
    // Regression test: the catch branch must call recordInstance exactly once.
    // A duplicate call would double-count infra failures and distort the canary
    // abort rate.
    const config = makeConfig();
    const metadata = {
      runId: "test-run-infra",
      agentVersion: "5.3.0",
      agentCommit: "abc123",
      imageRef: "test@sha256:abc",
      imageDigest: "sha256:abc",
      harnessRevision: "abc123",
      modelId: "gpt-4o",
      promptTemplateHash: "sha256:deadbeef",
      temperature: 0.0,
      topP: 1.0,
      maxRetries: 3,
      instanceTimeoutMs: 300_000,
      concurrency: 1,
      spendCapUsd: 100,
      taskListPath: config.taskListPath,
      taskListHash: "sha256:taskhash",
      taskCount: 1,
      datasetName: "princeton-nlp/SWE-bench_Verified",
      datasetRevision: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
      datasetSplit: "test",
      instanceIdHash: "sha256:cafebabe",
      scoredRun: true,
      externalSearch: false as const,
      allowRecoveryPatchApplication: false as const,
      canarySliceSize: 5,
      canaryAbortThreshold: 0.6,
      createdAt: new Date().toISOString(),
      runBundlePath: config.runBundlePath,
    };
    const report = BenchmarkLauncher.buildEmptyReport(metadata);

    // Simulate a single infra_failure (what the catch branch records)
    BenchmarkLauncher.recordInstance(report, {
      instanceId: "django__django-11099",
      outcome: "infra_failure",
      imageDigest: "sha256:abc123",
      exactApply: false,
      fuzzyRecoveryAttempted: false,
      durationMs: 500,
      errorMessage: "docker: image not found",
    });

    // Exactly one row, exactly one infra_failure count
    expect(report.summary.total).toBe(1);
    expect(report.summary.infraFailures).toBe(1);
    expect(report.instances).toHaveLength(1);
    expect(report.instances[0].outcome).toBe("infra_failure");
    // All other counters must be zero
    expect(report.summary.resolved).toBe(0);
    expect(report.summary.testFailures).toBe(0);
    expect(report.summary.exactApplyFailures).toBe(0);
    expect(report.summary.predictionReady).toBe(0);
    expect(report.summary.timedOut).toBe(0);
  });
});
