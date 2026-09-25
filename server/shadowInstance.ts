/**
 * shadowInstance.ts — v11.291.1
 *
 * Shadow Instance Testing for Andromeda RSI.
 *
 * Before applying a proposal to the live codebase, run tests inside an isolated
 * Docker container. Without Docker or usable test evidence, reject the proposal.
 * The old in-place swap helper below is retained temporarily for migration
 * context but is not called by runShadowTest; it must not be re-enabled as an
 * autonomous validation path because it mutates the real source tree.
 *
 * The former temp-directory approach failed on pnpm's virtual-store symlinks;
 * the interim in-place fallback is now disabled rather than treated as isolation.
 */
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
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
  /**
   * Full proposed file content (not a unified diff).
   * Written directly to targetFile for testing.
   */
  patchContent: string;
  /**
   * Absolute or server-relative path of the file to replace.
   */
  targetFile?: string;
  /** Timeout in ms for the test run (default 5 minutes) */
  timeoutMs?: number;
  /** Docker image to use (default: node:22-alpine) */
  dockerImage?: string;
}

function rejectedShadowTest(proposalId: string, reason: string, startTime: number): ShadowTestResult {
  return {
    proposalId,
    passed: false,
    testsPassed: 0,
    testsFailed: 1,
    stdout: `rejected: ${reason}`,
    stderr: "",
    durationMs: Date.now() - startTime,
  };
}

/** Resolve an existing target inside the workspace without following a path or symlink escape. */
function resolveShadowTarget(workspaceDir: string, targetFile: string | undefined): string | null {
  if (!targetFile || !targetFile.trim()) return null;
  if (!path.isAbsolute(targetFile) && path.normalize(targetFile).startsWith(`..${path.sep}`)) return null;

  let workspaceRoot: string;
  try {
    workspaceRoot = fs.realpathSync(workspaceDir);
  } catch {
    return null;
  }

  const candidates = path.isAbsolute(targetFile)
    ? [path.resolve(targetFile)]
    : [path.resolve(workspaceRoot, "server", targetFile), path.resolve(workspaceRoot, targetFile)];

  for (const candidate of candidates) {
    try {
      const resolved = fs.realpathSync(candidate);
      const relative = path.relative(workspaceRoot, resolved);
      if (relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
        return resolved;
      }
    } catch {
      // Try the next candidate; missing targets are not validation evidence.
    }
  }
  return null;
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
 * Runs a proposal in an isolated Docker container.
 * Rejects the proposal if Docker is unavailable; there is no autonomous
 * non-isolated fallback.
 */
export async function runShadowTest(options: ShadowTestOptions): Promise<ShadowTestResult> {
  const {
    proposalId,
    patchContent,
    targetFile,
    timeoutMs = 300_000,
    dockerImage = "node:22-alpine",
  } = options;

  const startTime = Date.now();
  // IDs become temp filenames/container names; targets later enter a shell
  // command inside Docker. Reject anything outside a conservative path grammar.
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(proposalId)) {
    return rejectedShadowTest(proposalId, "invalid proposal ID", startTime);
  }
  if (targetFile && !/^[A-Za-z0-9_./-]+$/.test(targetFile)) {
    return rejectedShadowTest(proposalId, "invalid target path syntax", startTime);
  }
  const workspaceDir = path.resolve(process.env.ANDROMEDA_WORKSPACE ?? process.cwd());
  if (!patchContent) {
    log.warn("Shadow test: no patch content — rejecting without validation", { proposalId });
    return rejectedShadowTest(proposalId, "no patch content", startTime);
  }
  const actualTargetPath = resolveShadowTarget(workspaceDir, targetFile);
  if (!actualTargetPath) {
    log.warn("Shadow test: target missing or outside workspace — rejecting without validation", { proposalId });
    return rejectedShadowTest(proposalId, "target missing or outside workspace", startTime);
  }

  if (!isDockerAvailable()) {
    // Never modify the real source tree to simulate an isolated shadow run.
    // A missing sandbox is missing evidence, not permission to apply a patch.
    log.warn("Docker not available — isolated shadow validation required", { proposalId });
    return rejectedShadowTest(proposalId, "Docker unavailable; isolated validation required", startTime);
  }

  const containerName = `andromeda-shadow-${proposalId.slice(0, 8)}-${Date.now()}`;
  const contentFile = path.join(tmpdir(), `andromeda-shadow-${randomUUID()}.content`);
  let createdContentFile = false;

  log.info("Starting shadow container", { proposalId, containerName, dockerImage });

  try {
    // Never overwrite a predictable /tmp path or leave the proposed source
    // readable by other local users after this shadow run finishes.
    const contentFd = fs.openSync(contentFile, "wx", 0o600);
    createdContentFile = true;
    try {
      fs.writeFileSync(contentFd, patchContent);
    } finally {
      fs.closeSync(contentFd);
    }

    // Resolve the target file path relative to workspace
    const relTarget = path.relative(workspaceDir, actualTargetPath);

    // Build targeted test command
    let testCmd = "pnpm exec vitest run --reporter=json 2>/dev/null || echo '{\"numPassedTests\":0,\"numFailedTests\":1}'";
    const baseName = path.basename(actualTargetPath).replace(/\.ts$/, "").replace(/\.js$/, "");
    const testBaseName = `${baseName}.test.ts`;
    const specBaseName = `${baseName}.spec.ts`;
    const testExists = fs.existsSync(path.join(workspaceDir, "server", testBaseName));
    const specExists = fs.existsSync(path.join(workspaceDir, "server", specBaseName));
    if (testExists) {
      testCmd = `pnpm exec vitest run --reporter=json "server/${testBaseName}" 2>/dev/null`;
    } else if (specExists) {
      testCmd = `pnpm exec vitest run --reporter=json "server/${specBaseName}" 2>/dev/null`;
    } else {
      log.warn(`Shadow test: no test file for ${baseName} — rejecting without validation`, { proposalId });
      return rejectedShadowTest(proposalId, "no test file", startTime);
    }

    const dockerCmd = [
      "docker", "run",
      "--rm",
      "--name", containerName,
      "--network", "none",
      "--memory", "2g",
      "--cpus", "2",
      "-v", `${workspaceDir}:/workspace:ro`,
      "-v", `${contentFile}:/proposed.content:ro`,
      dockerImage,
      "sh", "-c",
      [
        "set -e",
        "mkdir -p /app",
        "cp -r /workspace/server /app/server",
        "cp -r /workspace/client /app/client",
        "cp /workspace/package.json /app/package.json",
        "cp /workspace/tsconfig.json /app/tsconfig.json 2>/dev/null || true",
        "cp /workspace/vitest.config.ts /app/vitest.config.ts 2>/dev/null || true",
        "ln -s /workspace/node_modules /app/node_modules",
        "cd /app",
        `cp /proposed.content "${relTarget}"`,
        testCmd,
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
        if (code !== 0) {
          // A passing-looking JSON payload is not evidence if Docker or Vitest
          // exited unsuccessfully after producing it.
          result.passed = false;
          result.testsFailed = Math.max(result.testsFailed, 1);
          stderr += `\nShadow container exited with code ${String(code)}`;
        }
        result.stdout = stdout.slice(-4000);
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
  } finally {
    if (createdContentFile) {
      try {
        fs.rmSync(contentFile, { force: true });
      } catch (cleanupErr) {
        log.warn("Shadow patch temp-file cleanup failed", { proposalId, error: String(cleanupErr) });
      }
    }
  }
}

/**
 * Legacy in-place swap shadow test — UNUSED by the autonomous validation path.
 *
 * Instead of copying the entire workspace to a tmpDir (which breaks pnpm's
 * virtual store symlinks), we:
 *   1. Read the original file content
 *   2. Write the proposed content to the real file
 *   3. Run the targeted test from the real project directory
 *   4. Restore the original content in the finally block
 *
 * Do not call it to authorize an autonomous change: restore may fail and tests
 * can have persistent side effects outside the target file.
 */
async function runInPlaceShadowTest(
  options: ShadowTestOptions,
  startTime: number
): Promise<ShadowTestResult> {
  const { proposalId, patchContent, targetFile, timeoutMs = 120_000 } = options;
  const workspaceDir = path.resolve(process.env.ANDROMEDA_WORKSPACE ?? process.cwd());

  if (!targetFile || !patchContent) {
    log.warn("Shadow test: no targetFile or patchContent — rejecting without validation", { proposalId });
    return rejectedShadowTest(proposalId, "no target file or patch content", startTime);
  }

  const actualPath = resolveShadowTarget(workspaceDir, targetFile);
  if (!actualPath) {
    log.warn("Shadow test: target missing or outside workspace — rejecting without validation", { proposalId });
    return rejectedShadowTest(proposalId, "target missing or outside workspace", startTime);
  }

  // Save original content
  const originalContent = fs.readFileSync(actualPath, "utf-8");

  // Determine test command
  const baseName = path.basename(targetFile).replace(/\.ts$/, "").replace(/\.js$/, "");
  const testBaseName = `${baseName}.test.ts`;
  const specBaseName = `${baseName}.spec.ts`;
  const testExists = fs.existsSync(path.join(workspaceDir, "server", testBaseName));
  const specExists = fs.existsSync(path.join(workspaceDir, "server", specBaseName));

  let testPattern: string | null = null;
  if (testExists) {
    testPattern = `server/${testBaseName}`;
    log.info(`Shadow test (in-place): targeted test ${testPattern}`, { proposalId });
  } else if (specExists) {
    testPattern = `server/${specBaseName}`;
    log.info(`Shadow test (in-place): targeted test ${testPattern}`, { proposalId });
  } else {
    // A syntax check is not independent test evidence for autonomous mutation.
    log.warn(`Shadow test: no test file for ${baseName} — rejecting without validation`, { proposalId });
    return {
      proposalId,
      passed: false,
      testsPassed: 0,
      testsFailed: 1,
      stdout: "rejected: no test file",
      stderr: "",
      durationMs: Date.now() - startTime,
    };
  }

  try {
    // Write proposed content to the real file
    fs.writeFileSync(actualPath, patchContent, "utf-8");
    log.info(`Shadow test (in-place): wrote proposed content to ${actualPath}`, { proposalId });

    // Run targeted test from the real project directory
    let stdout = "";
    let stderr = "";
    try {
      // v14.1.6: Set VITEST_SHADOW_MODE=1 so tests can detect they're running
      // in a shadow context and avoid lock-contending operations (e.g. triggerCycleNow
      // in continuousImprover.test.ts which blocks waiting for the server's lock).
      stdout = execSync(
        `cd "${workspaceDir}" && VITEST_SHADOW_MODE=1 pnpm exec vitest run --reporter=json "${testPattern}" 2>/dev/null`,
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
    log.info(`Shadow test (in-place) complete: passed=${result.passed}, tests=${result.testsPassed}/${result.testsPassed + result.testsFailed}`, { proposalId });
    return result;
  } finally {
    // ALWAYS restore original content
    try {
      fs.writeFileSync(actualPath, originalContent, "utf-8");
      log.info(`Shadow test (in-place): restored original ${actualPath}`, { proposalId });
    } catch (restoreErr) {
      log.error(`Shadow test: FAILED to restore ${actualPath}`, { proposalId, error: String(restoreErr) });
    }
  }
}

/**
 * Parses Vitest JSON output to extract test counts.
 */
function parseVitestOutput(stdout: string, proposalId: string, durationMs: number): ShadowTestResult {
  if (!stdout) {
    return { proposalId, passed: false, testsPassed: 0, testsFailed: 1, stdout: "", stderr: "No parseable test output", durationMs };
  }
  try {
    const jsonMatch = stdout.match(/\{[\s\S]*"numPassedTests"[\s\S]*\}/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]);
      const passed = (data.numPassedTests ?? 0) > 0 && (data.numFailedTests ?? 0) === 0;
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

  // A missing count means validation did not produce usable test evidence.
  const passed = testsPassed > 0 && testsFailed === 0;
  return {
    proposalId,
    passed,
    testsPassed,
    testsFailed,
    stdout: "",
    stderr: "",
    durationMs,
  };
}
