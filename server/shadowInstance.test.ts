import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Mock child_process so we don't actually run Docker or shell commands
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return {
    ...actual,
    execSync: vi.fn((cmd: string) => {
      if (cmd.includes("docker info")) return "24.0.0";
      if (cmd.includes("df -BG")) return "/dev/sda1   100G   20G   80G   20% /";
      if (cmd.includes("cp -r")) return "";
      if (cmd.includes("patch")) return "";
      if (cmd.includes("rm -rf")) return "";
      if (cmd.includes("vitest")) return JSON.stringify({ numPassedTests: 10, numFailedTests: 0 });
      return "";
    }),
    spawn: vi.fn(() => {
      const EventEmitter = require("events");
      const proc = new EventEmitter();
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      // Simulate successful test run
      setTimeout(() => {
        proc.stdout.emit("data", Buffer.from(JSON.stringify({ numPassedTests: 15, numFailedTests: 0 })));
        proc.emit("close", 0);
      }, 10);
      return proc;
    }),
  };
});

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "andromeda-shadow-test-"));
  process.env.ANDROMEDA_WORKSPACE = tmpDir;
});

afterEach(() => {
  delete process.env.ANDROMEDA_WORKSPACE;
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe("shadowInstance", () => {
  it("isDockerAvailable returns true when docker is available", async () => {
    const { isDockerAvailable } = await import("./shadowInstance.js");
    expect(isDockerAvailable()).toBe(true);
  });

  it("runShadowTest returns a result with proposalId", async () => {
    const { runShadowTest } = await import("./shadowInstance.js");
    const result = await runShadowTest({
      proposalId: "test-proposal-001",
      patchContent: "--- a/foo.ts\n+++ b/foo.ts\n@@ -1 +1 @@\n-const x = 1;\n+const x = 2;",
    });

    expect(result.proposalId).toBe("test-proposal-001");
    expect(typeof result.passed).toBe("boolean");
    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("runShadowTest with Docker available uses spawn", async () => {
    const { runShadowTest } = await import("./shadowInstance.js");
    const { spawn } = await import("child_process");

    const result = await runShadowTest({
      proposalId: "docker-test-001",
      patchContent: "--- a/foo.ts\n+++ b/foo.ts\n@@ -1 +1 @@\n-const x = 1;\n+const x = 2;",
      dockerImage: "node:22-alpine",
    });

    expect(result.proposalId).toBe("docker-test-001");
    expect(spawn).toHaveBeenCalled();
  });

  it("runShadowTest parses vitest JSON output correctly", async () => {
    const { runShadowTest } = await import("./shadowInstance.js");
    const result = await runShadowTest({
      proposalId: "parse-test-001",
      patchContent: "",
    });

    // The mock returns numPassedTests: 15, numFailedTests: 0
    expect(result.testsPassed).toBe(15);
    expect(result.testsFailed).toBe(0);
    expect(result.passed).toBe(true);
  });
});
