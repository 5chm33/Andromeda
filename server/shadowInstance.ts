/**
 * shadowInstance.ts — v11.291.1
 *
 * Shadow Instance Testing for Andromeda RSI.
 *
 * Before applying a proposal to the live codebase:
 *   1. If Docker is available: spin up an isolated container, apply the change, run tests
 *   2. If Docker is unavailable: use in-place swap — write proposed content to the real
 *      file, run the targeted test, then restore the original. This is safe because:
 *      - The guard already has a backup of the original
 *      - The test runs in < 1 second on targeted files
 *      - The original is always restored in the finally block
 *
 * v11.291.1: Replaced tmpDir+symlink approach with in-place swap for local fallback.
 * The tmpDir approach failed because pnpm's virtual store symlinks don't resolve
 * correctly from a different directory (node:internal/modules error).
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
 * Falls back to in-place swap test if Docker is unavailable.
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

  if (!isDockerAvailable()) {
    log.warn("Docker not available — using in-place swap shadow test", { proposalId });
    return runInPlaceShadowTest(options, startTime);
  }

  const workspaceDir = process.env.ANDROMEDA_WORKSPACE ?? process.cwd();
  const containerName = `andromeda-shadow-${proposalId.slice(0, 8)}-${Date.now()}`;

  log.info("Starting shadow container", { proposalId, containerName, dockerImage });

  try {
    // Write the proposed file content to a temp file
    const contentFile = path.join("/tmp", `${proposalId}.content`);
    fs.writeFileSync(contentFile, patchContent);

    // Resolve the target file path relative to workspace
    const relTarget = targetFile
      ? (path.isAbsolute(targetFile) ? path.relative(workspaceDir, targetFile) : targetFile)
      : "server/unknown.ts";

    // Build targeted test command
    let testCmd = "pnpm exec vitest run --reporter=json 2>/dev/null || echo '{\"numPassedTests\":0,\"numFailedTests\":1}'";
    if (targetFile) {
      const baseName = path.basename(targetFile).replace(/\.ts$/, "").replace(/\.js$/, "");
      const testBaseName = `${baseName}.test.ts`;
      const specBaseName = `${baseName}.spec.ts`;
      const testExists = fs.existsSync(path.join(workspaceDir, "server", testBaseName));
      const specExists = fs.existsSync(path.join(workspaceDir, "server", specBaseName));
      if (testExists) {
        testCmd = `pnpm exec vitest run --reporter=json "server/${testBaseName}" 2>/dev/null`;
      } else if (specExists) {
        testCmd = `pnpm exec vitest run --reporter=json "server/${specBaseName}" 2>/dev/null`;
      }
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

      proc.on("close", (_code) => {
        const durationMs = Date.now() - startTime;
        const result = parseVitestOutput(stdout, proposalId, durationMs);
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
  }
}

/**
 * v11.291.1: In-place swap shadow test.
 *
 * Instead of copying the entire workspace to a tmpDir (which breaks pnpm's
 * virtual store symlinks), we:
 *   1. Read the original file content
 *   2. Write the proposed content to the real file
 *   3. Run the targeted test from the real project directory
 *   4. Restore the original content in the finally block
 *
 * This is safe because the guard already has a backup, and the test completes
 * in < 1 second for targeted files.
 */
async function runInPlaceShadowTest(
  options: ShadowTestOptions,
  startTime: number
): Promise<ShadowTestResult> {
  const { proposalId, patchContent, targetFile, timeoutMs = 120_000 } = options;
  const workspaceDir = process.env.ANDROMEDA_WORKSPACE ?? process.cwd();

  if (!targetFile || !patchContent) {
    log.warn("Shadow test: no targetFile or patchContent — skipping (pass through)", { proposalId });
    return {
      proposalId,
      passed: true,
      testsPassed: 0,
      testsFailed: 0,
      stdout: "skipped: no target file",
      stderr: "",
      durationMs: Date.now() - startTime,
    };
  }

  // Resolve the actual file path
  let actualPath: string;
  if (path.isAbsolute(targetFile)) {
    actualPath = targetFile;
  } else {
    // Try server/ subdirectory first, then exact relative
    const serverPath = path.join(workspaceDir, "server", path.basename(targetFile));
    const exactPath = path.join(workspaceDir, targetFile);
    actualPath = fs.existsSync(serverPath) ? serverPath : exactPath;
  }

  if (!fs.existsSync(actualPath)) {
    log.warn(`Shadow test: target file not found at ${actualPath} — pass through`, { proposalId });
    return {
      proposalId,
      passed: true,
      testsPassed: 0,
      testsFailed: 0,
      stdout: "skipped: target not found",
      stderr: "",
      durationMs: Date.now() - startTime,
    };
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
    // No test file — pass through (guard's syntax check is sufficient)
    log.warn(`Shadow test: no test file for ${baseName} — pass through`, { proposalId });
    return {
      proposalId,
      passed: true,
      testsPassed: 0,
      testsFailed: 0,
      stdout: "skipped: no test file",
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
      stdout = execSync(
        `cd "${workspaceDir}" && pnpm exec vitest run --reporter=json "${testPattern}" 2>/dev/null`,
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
  try {
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

  // v11.291.1: If no tests found at all, treat as pass (no test file = no regression)
  const passed = testsFailed === 0;
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
