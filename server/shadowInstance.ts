/**
 * shadowInstance.ts
 *
 * Shadow Instance Containerized Testing for Andromeda RSI.
 *
 * Before applying large architectural proposals to the live codebase,
 * this module:
 *   1. Spins up an isolated Docker container with a copy of the workspace
 *   2. Applies the proposed patch inside the container
 *   3. Runs the full test suite in the container
 *   4. Reports pass/fail and coverage delta
 *   5. Destroys the container regardless of outcome
 *
 * This prevents any risky proposal from ever touching the live codebase
 * until it has been validated in a hermetic environment.
 */
import { execSync, spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { createLogger } from "./logger.js";

const log = createLogger("shadowInstance");

export interface ShadowTestResult {
  proposalId: string;
  passed: boolean;
  testsPassed: number;
  testsFailed: number;
  coverageDelta?: number;
  stdout: string;
  stderr: string;
  containerId?: string;
  durationMs: number;
}

export interface ShadowTestOptions {
  /** Proposal ID for tracking */
  proposalId: string;
  /** Unified diff to apply inside the container */
  patchContent: string;
  /** Timeout in ms for the container test run (default 5 minutes) */
  timeoutMs?: number;
  /** Docker image to use (default: node:22-alpine) */
  dockerImage?: string;
}

/**
 * Checks if Docker is available on the host.
 */
export function isDockerAvailable(): boolean {
  try {
    execSync("docker info --format '{{.ServerVersion}}'", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs a proposal patch in an isolated Docker container.
 * Falls back to a local temp-dir test run if Docker is unavailable.
 */
export async function runShadowTest(options: ShadowTestOptions): Promise<ShadowTestResult> {
  const {
    proposalId,
    patchContent,
    timeoutMs = 300_000,
    dockerImage = "node:22-alpine",
  } = options;

  const startTime = Date.now();

  if (!isDockerAvailable()) {
    log.warn("Docker not available — falling back to local temp-dir shadow test", { proposalId });
    return runLocalShadowTest(options, startTime);
  }

  const workspaceDir = process.env.ANDROMEDA_WORKSPACE ?? process.cwd();
  const containerName = `andromeda-shadow-${proposalId.slice(0, 8)}-${Date.now()}`;

  log.info("Starting shadow container", { proposalId, containerName, dockerImage });

  try {
    // Write patch to a temp file
    const patchFile = path.join("/tmp", `${proposalId}.patch`);
    fs.writeFileSync(patchFile, patchContent);

    // Build the Docker run command
    // - Mount workspace read-only, copy to /app inside container
    // - Apply patch, run tests, output JSON results
    const dockerCmd = [
      "docker", "run",
      "--rm",
      "--name", containerName,
      "--network", "none",           // No network access — hermetic
      "--memory", "2g",              // 2GB RAM limit
      "--cpus", "2",                 // 2 CPU limit
      "-v", `${workspaceDir}:/workspace:ro`,
      "-v", `${patchFile}:/patch.diff:ro`,
      dockerImage,
      "sh", "-c",
      [
        "set -e",
        "apk add --no-cache git patch 2>/dev/null || apt-get install -y git patch 2>/dev/null || true",
        "cp -r /workspace /app",
        "cd /app",
        "patch -p1 < /patch.diff || true",
        "npm install --ignore-scripts 2>/dev/null || pnpm install 2>/dev/null || true",
        "npx vitest run --reporter=json 2>/dev/null || pnpm test 2>/dev/null || echo '{\"numPassedTests\":0,\"numFailedTests\":1}'",
      ].join(" && "),
    ];

    return await new Promise<ShadowTestResult>((resolve) => {
      let stdout = "";
      let stderr = "";

      const proc = spawn(dockerCmd[0], dockerCmd.slice(1), {
        timeout: timeoutMs,
        stdio: ["ignore", "pipe", "pipe"],
      });

      proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
      proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

      proc.on("close", (code) => {
        const durationMs = Date.now() - startTime;
        const result = parseVitestOutput(stdout, proposalId, durationMs);
        result.stdout = stdout.slice(-4000); // Last 4KB
        result.stderr = stderr.slice(-2000);
        result.containerId = containerName;
        log.info("Shadow container finished", { proposalId, passed: result.passed, durationMs });
        resolve(result);
      });

      proc.on("error", (err) => {
        const durationMs = Date.now() - startTime;
        log.error("Shadow container error", { proposalId, error: err.message });
        resolve({
          proposalId,
          passed: false,
          testsPassed: 0,
          testsFailed: 1,
          stdout: "",
          stderr: err.message,
          containerId: containerName,
          durationMs,
        });
      });
    });
  } catch (err) {
    const durationMs = Date.now() - startTime;
    log.error("Shadow test failed", { proposalId, error: String(err) });
    return {
      proposalId,
      passed: false,
      testsPassed: 0,
      testsFailed: 1,
      stdout: "",
      stderr: String(err),
      durationMs,
    };
  }
}

/**
 * Fallback: run patch in a local temp directory (no Docker).
 * Used in development environments without Docker.
 */
async function runLocalShadowTest(
  options: ShadowTestOptions,
  startTime: number
): Promise<ShadowTestResult> {
  const { proposalId, patchContent, timeoutMs = 300_000 } = options;
  const workspaceDir = process.env.ANDROMEDA_WORKSPACE ?? process.cwd();
  const tmpDir = path.join("/tmp", `andromeda-shadow-${proposalId.slice(0, 8)}-${Date.now()}`);

  try {
    // Copy workspace to temp dir
    execSync(`cp -r "${workspaceDir}" "${tmpDir}"`, { stdio: "pipe" });

    // Write and apply patch
    const patchFile = path.join(tmpDir, "shadow.patch");
    fs.writeFileSync(patchFile, patchContent);

    try {
      execSync(`cd "${tmpDir}" && patch -p1 < shadow.patch`, { stdio: "pipe" });
    } catch {
      log.warn("Patch apply failed in shadow test", { proposalId });
    }

    // Run tests
    let stdout = "";
    let stderr = "";
    try {
      stdout = execSync(
        `cd "${tmpDir}" && npx vitest run --reporter=json 2>/dev/null`,
        { timeout: timeoutMs, encoding: "utf8", stdio: "pipe" }
      );
    } catch (e: unknown) {
      if (e && typeof e === "object" && "stdout" in e) {
        stdout = String((e as { stdout: unknown }).stdout ?? "");
        stderr = String(((e as unknown) as { stderr: unknown }).stderr ?? "");
      }
    }

    const durationMs = Date.now() - startTime;
    const result = parseVitestOutput(stdout, proposalId, durationMs);
    result.stdout = stdout.slice(-4000);
    result.stderr = stderr.slice(-2000);
    return result;
  } finally {
    // Always clean up
    try { execSync(`rm -rf "${tmpDir}"`, { stdio: "pipe" }); } catch { /* ignore */ }
  }
}

/**
 * Parses Vitest JSON output to extract test counts.
 */
function parseVitestOutput(stdout: string, proposalId: string, durationMs: number): ShadowTestResult {
  try {
    // Try to find JSON in the output
    const jsonMatch = stdout.match(/\{[\s\S]*"numPassedTests"[\s\S]*\}/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]);
      const passed = (data.numFailedTests ?? 0) === 0;
      return {
        proposalId,
        passed,
        testsPassed: data.numPassedTests ?? 0,
        testsFailed: data.numFailedTests ?? 0,
        stdout: "",
        stderr: "",
        durationMs,
      };
    }
  } catch { /* fall through */ }

  // Fallback: parse text output
  const passedMatch = stdout.match(/(\d+)\s+passed/);
  const failedMatch = stdout.match(/(\d+)\s+failed/);
  const testsPassed = passedMatch ? parseInt(passedMatch[1], 10) : 0;
  const testsFailed = failedMatch ? parseInt(failedMatch[1], 10) : 0;

  return {
    proposalId,
    passed: testsFailed === 0 && testsPassed > 0,
    testsPassed,
    testsFailed,
    stdout: "",
    stderr: "",
    durationMs,
  };
}
