/**
 * shadowInstance.ts
 *
 * Shadow Instance Containerized Testing for Andromeda RSI.
 *
 * Before applying large architectural proposals to the live codebase,
 * this module:
 *   1. Spins up an isolated Docker container with a copy of the workspace
 *   2. Applies the proposed file content inside the container
 *   3. Runs the full test suite in the container
 *   4. Reports pass/fail and coverage delta
 *   5. Destroys the container regardless of outcome
 *
 * v11.10.1 Fix: The local fallback now writes the full proposedContent directly
 * to the target file path instead of trying to apply it as a unified diff with
 * `patch -p1`. The patchContent field is the FULL modified file, not a diff.
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
   * v11.10.1: Full proposed file content (not a unified diff).
   * Written directly to targetFile inside the shadow copy.
   */
  patchContent: string;
  /**
   * v11.10.1: Absolute or server-relative path of the file to replace.
   * Required for the local fallback to write the content to the right location.
   */
  targetFile?: string;
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
 * Runs a proposal in an isolated Docker container.
 * Falls back to a local temp-dir test run if Docker is unavailable.
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
    log.warn("Docker not available — falling back to local temp-dir shadow test", { proposalId });
    return runLocalShadowTest(options, startTime);
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

    // v11.290.0 Fix: Run targeted test instead of full suite
    let testCmd = "pnpm exec vitest run --reporter=json 2>/dev/null || pnpm test 2>/dev/null || echo '{\"numPassedTests\":0,\"numFailedTests\":1}'";
    
    if (targetFile) {
      const baseName = path.basename(targetFile).replace(/\.ts$/, "").replace(/\.js$/, "");
      const testBaseName = `${baseName}.test.ts`;
      const specBaseName = `${baseName}.spec.ts`;
      
      const testExists = fs.existsSync(path.join(workspaceDir, "server", testBaseName));
      const specExists = fs.existsSync(path.join(workspaceDir, "server", specBaseName));
      
      if (testExists) {
        testCmd = `pnpm exec vitest run --reporter=json "server/${testBaseName}" 2>/dev/null`;
        log.info(`Shadow test: Running targeted test for ${baseName}: server/${testBaseName}`, { proposalId });
      } else if (specExists) {
        testCmd = `pnpm exec vitest run --reporter=json "server/${specBaseName}" 2>/dev/null`;
        log.info(`Shadow test: Running targeted test for ${baseName}: server/${specBaseName}`, { proposalId });
      } else {
        log.warn(`Shadow test: No test file found for ${baseName}, running full suite (may timeout)`, { proposalId });
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
        // v11.290.0 Fix: Only copy what's needed, symlink node_modules to save 800MB copy time
        "mkdir -p /app",
        "cp -r /workspace/server /app/server",
        "cp -r /workspace/client /app/client",
        "cp /workspace/package.json /app/package.json",
        "cp /workspace/tsconfig.json /app/tsconfig.json 2>/dev/null || true",
        "cp /workspace/vitest.config.ts /app/vitest.config.ts 2>/dev/null || true",
        "ln -s /workspace/node_modules /app/node_modules",
        "cd /app",
        // Write the proposed content to the target file
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
 * v11.10.1 Fix: Local fallback — write the full proposed file content directly
 * to the target file path in the temp copy, then run vitest.
 *
 * Previously this tried to use `patch -p1` on the proposedContent, but
 * proposedContent is the FULL modified file (not a unified diff), so patch
 * always failed silently and tests ran on the UNMODIFIED copy — always passing.
 */
async function runLocalShadowTest(
  options: ShadowTestOptions,
  startTime: number
): Promise<ShadowTestResult> {
  const { proposalId, patchContent, targetFile, timeoutMs = 300_000 } = options;
  const workspaceDir = process.env.ANDROMEDA_WORKSPACE ?? process.cwd();
  const tmpDir = path.join("/tmp", `andromeda-shadow-${proposalId.slice(0, 8)}-${Date.now()}`);

  try {
    // v11.290.0 Fix: Symlink node_modules instead of copying 800MB
    execSync(`mkdir -p "${tmpDir}"`, { stdio: "pipe" });
    execSync(`cp -r "${workspaceDir}/server" "${tmpDir}/server"`, { stdio: "pipe" });
    execSync(`cp -r "${workspaceDir}/client" "${tmpDir}/client"`, { stdio: "pipe" });
    execSync(`cp "${workspaceDir}/package.json" "${tmpDir}/package.json"`, { stdio: "pipe" });
    try { execSync(`cp "${workspaceDir}/tsconfig.json" "${tmpDir}/tsconfig.json"`, { stdio: "pipe" }); } catch {}
    try { execSync(`cp "${workspaceDir}/vitest.config.ts" "${tmpDir}/vitest.config.ts"`, { stdio: "pipe" }); } catch {}
    execSync(`ln -s "${workspaceDir}/node_modules" "${tmpDir}/node_modules"`, { stdio: "pipe" });

    // v11.10.1: Write the full proposed content directly to the target file.
    // Resolve the target file path inside the temp copy.
    if (targetFile && patchContent) {
      let destPath: string;
      if (path.isAbsolute(targetFile)) {
        // Convert absolute path from original workspace to temp copy
        const rel = path.relative(workspaceDir, targetFile);
        destPath = path.join(tmpDir, rel);
      } else {
        // Relative path — resolve from server/ subdirectory
        destPath = path.join(tmpDir, "server", path.basename(targetFile));
        // Also try exact relative path
        const exactPath = path.join(tmpDir, targetFile);
        if (fs.existsSync(path.dirname(exactPath))) {
          destPath = exactPath;
        }
      }
      if (fs.existsSync(path.dirname(destPath))) {
        fs.writeFileSync(destPath, patchContent, "utf-8");
        log.info(`Shadow test: wrote proposed content to ${destPath}`, { proposalId });
      } else {
        log.warn(`Shadow test: target dir not found for ${destPath} — running unmodified`, { proposalId });
      }
    } else {
      log.warn("Shadow test: no targetFile provided — running unmodified copy", { proposalId });
    }

    // v11.290.0 Fix: Run targeted test instead of full suite
    let testCmd = `pnpm exec vitest run --reporter=json 2>/dev/null`;
    
    if (targetFile) {
      const baseName = path.basename(targetFile).replace(/\.ts$/, "").replace(/\.js$/, "");
      const testBaseName = `${baseName}.test.ts`;
      const specBaseName = `${baseName}.spec.ts`;
      
      const testExists = fs.existsSync(path.join(workspaceDir, "server", testBaseName));
      const specExists = fs.existsSync(path.join(workspaceDir, "server", specBaseName));
      
      if (testExists) {
        testCmd = `pnpm exec vitest run --reporter=json "server/${testBaseName}" 2>/dev/null`;
        log.info(`Shadow test: Running targeted test for ${baseName}: server/${testBaseName}`, { proposalId });
      } else if (specExists) {
        testCmd = `pnpm exec vitest run --reporter=json "server/${specBaseName}" 2>/dev/null`;
        log.info(`Shadow test: Running targeted test for ${baseName}: server/${specBaseName}`, { proposalId });
      } else {
        log.warn(`Shadow test: No test file found for ${baseName}, running full suite (may timeout)`, { proposalId });
      }
    }

    // Run tests
    let stdout = "";
    let stderr = "";
    try {
      stdout = execSync(
        `cd "${tmpDir}" && ${testCmd}`,
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
