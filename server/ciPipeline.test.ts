import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("child_process", () => ({
  execSync: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock("./redisLock.js", () => ({
  withLock: async <T>(_key: string, fn: () => Promise<T>) => ({
    skipped: false as const,
    result: await fn(),
  }),
}));

vi.mock("./memory.js", () => ({ storeMemory: vi.fn() }));
vi.mock("./ciRegressionGuard.js", () => ({
  recordMetrics: vi.fn(),
  checkForRegressions: vi.fn(() => ({ hasRegression: false, regressions: [] })),
}));

import { execSync } from "child_process";
import { getCiHistory, getCiStatus, runCiPipeline } from "./ciPipeline.js";

const mockedExecSync = vi.mocked(execSync);

describe("runCiPipeline required validation gates", () => {
  beforeEach(() => {
    mockedExecSync.mockReset();
    mockedExecSync.mockReturnValue("");
  });

  it("fails closed when every required repair gate is skipped", async () => {
    const result = await runCiPipeline("repair-skip-all", undefined, {
      skipTypecheck: true,
      skipTests: true,
      skipBuild: true,
      skipReload: true,
      requiredStages: ["typecheck", "test", "build"],
    });

    expect(result.success).toBe(false);
    expect(result.failedStage).toBe("typecheck");
    expect(result.stages).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: "typecheck", executed: false, passed: false }),
      expect.objectContaining({ stage: "test", executed: false, passed: false }),
      expect.objectContaining({ stage: "build", executed: false, passed: false }),
    ]));
    expect(mockedExecSync).not.toHaveBeenCalled();
  });

  it("records test and build as unexecuted when typecheck fails first", async () => {
    mockedExecSync.mockImplementationOnce(() => {
      throw { status: 1, stdout: "", stderr: "type error" };
    });

    const result = await runCiPipeline("repair-typecheck-failed", undefined, {
      skipReload: true,
      requiredStages: ["typecheck", "test", "build"],
    });

    expect(result.success).toBe(false);
    expect(result.failedStage).toBe("typecheck");
    expect(result.stages).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: "typecheck", executed: true, passed: false, exitCode: 1 }),
      expect.objectContaining({ stage: "test", executed: false, passed: false }),
      expect.objectContaining({ stage: "build", executed: false, passed: false }),
    ]));
    expect(result.stages.find((stage) => stage.stage === "test")?.output).toContain("typecheck");
    expect(result.stages.find((stage) => stage.stage === "build")?.output).toContain("typecheck");
    expect(mockedExecSync).toHaveBeenCalledTimes(1);
  });

  it("fails closed when a required targeted test has no test file", async () => {
    const result = await runCiPipeline("repair-no-test", undefined, {
      skipReload: true,
      targetFile: "__missing_required_test_4f5a9.ts",
      requiredStages: ["typecheck", "test", "build"],
    });

    expect(result.success).toBe(false);
    expect(result.failedStage).toBe("test");
    expect(result.stages).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: "typecheck", executed: true, passed: true, exitCode: 0 }),
      expect.objectContaining({ stage: "test", executed: false, passed: false }),
      expect.objectContaining({ stage: "build", executed: true, passed: true, exitCode: 0 }),
    ]));
  });

  it("counts a repair as successful only after every required gate executes and passes", async () => {
    const result = await runCiPipeline("repair-validated", undefined, {
      skipReload: true,
      requiredStages: ["typecheck", "test", "build"],
    });

    expect(result.success).toBe(true);
    expect(result.failedStage).toBeUndefined();
    for (const stage of ["typecheck", "test", "build"] as const) {
      expect(result.stages).toContainEqual(expect.objectContaining({
        stage,
        executed: true,
        passed: true,
        exitCode: 0,
      }));
    }
    expect(mockedExecSync).toHaveBeenCalledTimes(3);
  });
});

describe("CI pipeline status", () => {
  it("exposes the last result and history without executing a pipeline", () => {
    expect(getCiStatus()).toEqual(expect.objectContaining({
      isRunning: false,
      history: expect.any(Array),
    }));
    expect(getCiHistory()).toEqual(expect.any(Array));
  });
});
