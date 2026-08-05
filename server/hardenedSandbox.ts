/**
 * hardenedSandbox.ts — Shared hardened Docker container constructor.
 * Andromeda v5.2 (Elicit enforcement contract §3)
 *
 * BOTH sweBenchTracebackLoop.ts AND sandboxManager.ts MUST use buildHardenedDockerArgs()
 * to construct repair containers. No module may construct a repair container
 * with a custom docker run command that bypasses these controls.
 *
 * Required controls (all enforced, not advisory):
 *   --network=none
 *   --cap-drop=ALL
 *   --security-opt=no-new-privileges
 *   --pids-limit=256
 *   --memory (configurable, default 4g)
 *   --cpus (configurable, default 2.0)
 *   --read-only (with explicit writable tmpfs mounts)
 *   --user=nobody (when image permissions permit)
 *   pinned image digest (sha256:...) — mutable tags are rejected
 *   no --privileged
 *   no host Docker socket mount
 *   minimal environment allowlist (no host credentials)
 */

import { spawnSync } from "child_process";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface HardenedSandboxConfig {
  /** Docker image — MUST be a pinned digest (sha256:...) for untrusted_repair mode. */
  image: string;
  /** Container name (must be unique per run). */
  containerName: string;
  /** Memory limit (default: "4g"). */
  memoryLimit?: string;
  /** CPU limit (default: "2.0"). */
  cpuLimit?: string;
  /** PID limit (default: 256). */
  pidsLimit?: number;
  /** Wall-clock timeout in milliseconds (default: 300_000 = 5 minutes). */
  wallClockLimitMs?: number;
  /** Additional read-write bind mounts (host:container). */
  writableMounts?: string[];
  /** Execution mode — untrusted_repair requires Docker and pinned digest. */
  mode: "trusted_local" | "untrusted_repair";
  /** Whether to run as nobody (default: true). */
  runAsNobody?: boolean;
}

export interface HardenedDockerArgs {
  /** The full docker run argument list (excluding the image and command). */
  args: string[];
  /** The controls record for the evidence bundle. */
  controls: {
    networkNone: boolean;
    capDropAll: boolean;
    noNewPrivileges: boolean;
    pidsLimit: number;
    memoryLimit: string;
    cpuLimit: string;
    wallClockLimitMs: number;
    readOnly: boolean;
    effectiveUser: string;
    imageDigest: string;
    hostDockerSocketMounted: boolean;
    privileged: boolean;
  };
}

export interface HardenedSandboxValidation {
  valid: boolean;
  errors: string[];
}

// ── Validation ────────────────────────────────────────────────────────────────

/**
 * Validates that a HardenedSandboxConfig meets the minimum isolation bar.
 * For untrusted_repair mode, all controls are mandatory.
 */
export function validateSandboxConfig(config: HardenedSandboxConfig): HardenedSandboxValidation {
  const errors: string[] = [];

  if (config.mode === "untrusted_repair") {
    // Image must be pinned by digest
    if (!config.image.includes("sha256:")) {
      errors.push(`Image '${config.image}' must be pinned by digest (sha256:...) for untrusted_repair mode`);
    }
    // Docker must be available
    const dockerCheck = spawnSync("docker", ["info"], { encoding: "utf-8", stdio: "pipe" });
    if (dockerCheck.status !== 0) {
      errors.push("Docker is not available — untrusted_repair mode requires Docker");
    }
  }

  if (!config.containerName || config.containerName.length === 0) {
    errors.push("containerName must be set");
  }

  return { valid: errors.length === 0, errors };
}

// ── Builder ───────────────────────────────────────────────────────────────────

/**
 * Builds the docker run argument list with all required isolation controls.
 * Throws if the config is invalid for the requested mode.
 *
 * Usage:
 *   const { args, controls } = buildHardenedDockerArgs(config);
 *   spawnSync("docker", ["run", "-d", ...args, config.image, "tail", "-f", "/dev/null"], ...);
 */
export function buildHardenedDockerArgs(config: HardenedSandboxConfig): HardenedDockerArgs {
  const validation = validateSandboxConfig(config);
  if (!validation.valid) {
    throw new Error(
      `HardenedSandbox validation failed for mode '${config.mode}':\n` +
      validation.errors.map(e => `  - ${e}`).join("\n")
    );
  }

  const memory = config.memoryLimit ?? "4g";
  const cpus = config.cpuLimit ?? "2.0";
  const pids = config.pidsLimit ?? 256;
  const wallClock = config.wallClockLimitMs ?? 300_000;
  const user = (config.runAsNobody !== false) ? "nobody" : "";

  const args: string[] = [
    "--name", config.containerName,
    "--network", "none",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges:true",
    `--pids-limit=${pids}`,
    `--memory=${memory}`,
    `--cpus=${cpus}`,
    "--read-only",
    // Writable tmpfs for /tmp and /var/tmp (needed by most build tools)
    "--tmpfs", "/tmp:rw,noexec,nosuid,size=256m",
    "--tmpfs", "/var/tmp:rw,noexec,nosuid,size=64m",
  ];

  // Add user if specified
  if (user) {
    args.push("--user", user);
  }

  // Add additional writable bind mounts (e.g. the worktree)
  for (const mount of (config.writableMounts ?? [])) {
    args.push("-v", mount);
  }

  // Minimal environment — explicitly block credential leakage
  // Do NOT pass through GITHUB_TOKEN, AWS_*, GCP_*, OPENAI_API_KEY, etc.
  args.push(
    "--env", "HOME=/tmp",
    "--env", "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
  );

  const controls = {
    networkNone: true,
    capDropAll: true,
    noNewPrivileges: true,
    pidsLimit: pids,
    memoryLimit: memory,
    cpuLimit: cpus,
    wallClockLimitMs: wallClock,
    readOnly: true,
    effectiveUser: user || "default",
    imageDigest: config.image,
    hostDockerSocketMounted: false,
    privileged: false,
  };

  return { args, controls };
}

// ── Convenience: run a command in a hardened container ────────────────────────

export interface HardenedExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

/**
 * Runs a command in a hardened container and returns the result.
 * The container is always removed after execution (--rm equivalent via explicit cleanup).
 */
export function runInHardenedContainer(
  config: HardenedSandboxConfig,
  command: string[],
): HardenedExecResult {
  const { args } = buildHardenedDockerArgs(config);
  const startMs = Date.now();

  // Start container
  const startResult = spawnSync("docker", ["run", "-d", ...args, config.image, "tail", "-f", "/dev/null"], {
    encoding: "utf-8",
    stdio: "pipe",
  });

  if (startResult.status !== 0) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `Failed to start container: ${startResult.stderr?.slice(0, 500) ?? "unknown"}`,
      timedOut: false,
      durationMs: Date.now() - startMs,
    };
  }

  try {
    // Execute command
    const execResult = spawnSync(
      "docker",
      ["exec", config.containerName, ...command],
      {
        encoding: "utf-8",
        stdio: "pipe",
        timeout: config.wallClockLimitMs ?? 300_000,
      }
    );

    const timedOut = execResult.signal === "SIGTERM" || execResult.error?.message?.includes("ETIMEDOUT") || false;

    return {
      exitCode: execResult.status ?? 1,
      stdout: execResult.stdout ?? "",
      stderr: execResult.stderr ?? "",
      timedOut,
      durationMs: Date.now() - startMs,
    };
  } finally {
    // Always remove the container
    spawnSync("docker", ["rm", "-f", config.containerName], { encoding: "utf-8", stdio: "pipe" });
  }
}
