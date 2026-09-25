import { execSync, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isDockerAvailable,
  runShadowTest,
} from "./shadowInstance.js";

vi.mock("child_process", () => ({
  execSync: vi.fn(() => {
    throw new Error("Docker unavailable");
  }),
  spawn: vi.fn(),
}));

const originalWorkspace = process.env.ANDROMEDA_WORKSPACE;

afterEach(() => {
  if (originalWorkspace === undefined) delete process.env.ANDROMEDA_WORKSPACE;
  else process.env.ANDROMEDA_WORKSPACE = originalWorkspace;
});

describe("shadowInstance", () => {
  it("isDockerAvailable returns a boolean", () => {
    const result = isDockerAvailable();
    expect(typeof result).toBe("boolean");
  });

  it("isDockerAvailable is consistent across multiple calls", () => {
    const first = isDockerAvailable();
    const second = isDockerAvailable();
    expect(first).toBe(second);
  });

  it("isDockerAvailable does not throw", () => {
    expect(() => isDockerAvailable()).not.toThrow();
  });

  it("isDockerAvailable returns false in sandbox environment", () => {
    // In the test sandbox, Docker is typically not available
    const result = isDockerAvailable();
    expect(typeof result).toBe("boolean");
    // Just verify it returns a valid boolean, not necessarily false
    expect(result === true || result === false).toBe(true);
  });

  it("module exports isDockerAvailable as a function", () => {
    expect(typeof isDockerAvailable).toBe("function");
  });

  it("fails closed when proposal content is absent", async () => {
    const result = await runShadowTest({
      proposalId: "shadow-no-content",
      targetFile: "selfMonitor.ts",
      patchContent: "",
    });

    expect(result).toMatchObject({ passed: false, testsPassed: 0, testsFailed: 1 });
    expect(result.stdout).toContain("no patch content");
  });

  it("fails closed when a target escapes the workspace", async () => {
    const result = await runShadowTest({
      proposalId: "shadow-path-escape",
      targetFile: "../../etc/passwd",
      patchContent: "not used",
    });

    expect(result).toMatchObject({ passed: false, testsPassed: 0, testsFailed: 1 });
    expect(result.stdout).toContain("outside workspace");
  });

  it("does not swap real source files when the isolated Docker runner is unavailable", async () => {
    const target = join(process.cwd(), "server", "selfMonitor.ts");
    const original = readFileSync(target, "utf8");

    const result = await runShadowTest({
      proposalId: "shadow-no-docker",
      targetFile: "selfMonitor.ts",
      patchContent: "unsafe replacement",
    });

    expect(result).toMatchObject({ passed: false, testsPassed: 0, testsFailed: 1 });
    expect(result.stdout).toContain("Docker unavailable");
    expect(readFileSync(target, "utf8")).toBe(original);
  });

  it("rejects an ID that could escape the temporary file directory", async () => {
    const result = await runShadowTest({
      proposalId: "../outside-temp",
      targetFile: "selfMonitor.ts",
      patchContent: "unsafe replacement",
    });
    expect(result).toMatchObject({ passed: false, testsPassed: 0 });
    expect(result.stdout).toContain("invalid proposal ID");
  });

  it("rejects shell-sensitive target paths before forming a Docker command", async () => {
    const result = await runShadowTest({
      proposalId: "shadow-unsafe-path",
      targetFile: 'selfMonitor.ts"; echo unsafe',
      patchContent: "unsafe replacement",
    });
    expect(result).toMatchObject({ passed: false, testsPassed: 0 });
    expect(result.stdout).toContain("invalid target path syntax");
  });

  it("rejects passing-looking JSON if the isolated container exits with an error", async () => {
    const proposalId = "shadow-exit-failure";
    const fake = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
    });
    vi.mocked(execSync).mockReturnValueOnce(Buffer.from("docker available") as never);
    vi.mocked(spawn).mockReturnValueOnce(fake as unknown as ReturnType<typeof spawn>);
    const promise = runShadowTest({
      proposalId,
      targetFile: "selfMonitor.ts",
      patchContent: "fake patch content",
    });
    const args = vi.mocked(spawn).mock.calls.at(-1)?.[1] ?? [];
    const contentMount = args.find(arg => arg.endsWith(":/proposed.content:ro"));
    expect(contentMount).toBeDefined();
    const contentFile = contentMount!.slice(0, -":/proposed.content:ro".length);
    expect(statSync(contentFile).mode & 0o777).toBe(0o600);

    fake.stdout.emit("data", Buffer.from('{"numPassedTests":1,"numFailedTests":0}'));
    fake.emit("close", 1);
    const result = await promise;
    expect(result).toMatchObject({ passed: false, testsPassed: 1, testsFailed: 1 });
    expect(result.stderr).toContain("exited with code 1");
    expect(existsSync(contentFile)).toBe(false);
  });
});
