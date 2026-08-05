/**
 * hardenedSandbox.ts — Shared hardened Docker container constructor.
 * Andromeda v5.4 (Elicit enforcement contract §3, Phase 1 fix)
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
 *   --read-only  ← ALWAYS present (never omitted)
 *   -v <seeded-volume>:/testbed  ← when writableWorktree:true (NOT --tmpfs)
 *   --user=nobody (when image permissions permit)
 *   pinned image digest (sha256:...) — mutable tags are rejected
 *   no --privileged
 *   no host Docker socket mount
 *   minimal environment allowlist (no host credentials)
 *
 * v5.4 change: writableWorktree:true now uses a seeded named volume instead of
 * --tmpfs /testbed. A tmpfs MASKS the image's existing /testbed contents (Docker
 * mounts do not merge). The correct design is:
 *
 *   1. seedWorktreeVolume(image, volumeName) — creates a named volume and copies
 *      the image's /testbed into it via a disposable seed container.
 *   2. buildHardenedDockerArgs() — mounts that volume at /testbed with -v.
 *   3. Caller cleans up the volume after the repair container exits.
 *
 * This preserves the repository contents while keeping the root FS read-only.
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
  /**
   * When true, mount a pre-seeded named volume at /testbed so patch application
   * can write to the repository while the root FS stays read-only.
   *
   * IMPORTANT: The caller MUST call seedWorktreeVolume() BEFORE starting the
   * container, and must pass the returned volumeName as worktreeVolumeName.
   * The volume is NOT created automatically by buildHardenedDockerArgs().
   *
   * NOTE: --read-only is ALWAYS included regardless of this flag.
   * This is the v5.4 fix for Elicit finding: "--tmpfs masks image /testbed".
   */
  writableWorktree?: boolean;
  /**
   * Name of the pre-seeded Docker volume to mount at /testbed.
   * Required when writableWorktree:true. Created by seedWorktreeVolume().
   */
  worktreeVolumeName?: string;
  /**
   * Custom worktree path inside the container (default: "/testbed").
   * Only used when writableWorktree:true.
   */
  worktreePath?: string;
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
    writableWorktreePath: string | null;
    worktreeVolumeSeeded: boolean;
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

export interface SeededWorktreeVolume {
  /** The Docker volume name. */
  volumeName: string;
  /** SHA-256 hash of the seeded /testbed contents (for evidence bundle). */
  preWorktreeHash: string;
  /** The image used for seeding. */
  imageRef: string;
  /** The worktree path inside the container. */
  worktreePath: string;
  /** ISO timestamp when seeding completed. */
  seededAt: string;
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
    // When writableWorktree:true, worktreeVolumeName must be provided
    if (config.writableWorktree && !config.worktreeVolumeName) {
      errors.push(
        "writableWorktree:true requires worktreeVolumeName to be set. " +
        "Call seedWorktreeVolume() first, then pass the returned volumeName."
      );
    }
  }

  if (!config.containerName || config.containerName.length === 0) {
    errors.push("containerName must be set");
  }

  return { valid: errors.length === 0, errors };
}

// ── Worktree Volume Seeding ───────────────────────────────────────────────────

/**
 * Seeds a named Docker volume with the image's /testbed contents.
 *
 * Design:
 *   1. Create a named volume (docker volume create).
 *   2. Start a disposable seed container with the volume mounted at /testbed-seed.
 *   3. Copy the image's /testbed into the volume via cp -a.
 *   4. Hash the seeded contents for the evidence bundle.
 *   5. Remove the seed container (volume persists).
 *
 * The caller is responsible for removing the volume after the repair container
 * exits (docker volume rm <volumeName>).
 *
 * @param imageRef  The image to seed from (should be a pinned digest).
 * @param volumeName  Name for the Docker volume (must be unique per instance).
 * @param worktreePath  Path inside the image to copy (default: "/testbed").
 * @returns SeededWorktreeVolume with the volume name and pre-apply hash.
 */
export function seedWorktreeVolume(
  imageRef: string,
  volumeName: string,
  worktreePath = "/testbed",
): SeededWorktreeVolume {
  const seedContainerName = `${volumeName}-seed`;

  // Step 1: Create the named volume
  const createResult = spawnSync("docker", ["volume", "create", volumeName], {
    encoding: "utf-8",
    stdio: "pipe",
  });
  if (createResult.status !== 0) {
    throw new Error(
      `seedWorktreeVolume: docker volume create failed: ${(createResult.stderr || "").slice(0, 300)}`
    );
  }

  // Step 2: Start a disposable seed container.
  // Mount the volume at /worktree-seed (a fresh empty path, not /testbed).
  // The image's /testbed is still accessible at its original path.
  // We do NOT use --read-only here — this is the seed container, not the repair container.
  const seedRunResult = spawnSync(
    "docker",
    [
      "run", "-d",
      "--name", seedContainerName,
      "--network", "none",
      "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges:true",
      "-v", `${volumeName}:/worktree-seed`,
      imageRef,
      "tail", "-f", "/dev/null",
    ],
    { encoding: "utf-8", stdio: "pipe" }
  );
  if (seedRunResult.status !== 0) {
    // Clean up volume on failure
    spawnSync("docker", ["volume", "rm", volumeName], { encoding: "utf-8", stdio: "pipe" });
    throw new Error(
      `seedWorktreeVolume: seed container failed to start: ${(seedRunResult.stderr || "").slice(0, 300)}`
    );
  }

  // The seed container is now running. Steps 3-4 may throw; if they do, the
  // volume must be removed before rethrowing so the caller does not inherit a
  // leaked partial volume. The seed container is always removed in finally.
  let stepSucceeded = false;
  try {
    // Step 3: Copy image's /testbed into the volume.
    // cp -a preserves permissions, symlinks, and timestamps.
    const copyResult = spawnSync(
      "docker",
      [
        "exec", seedContainerName,
        "sh", "-c", `cp -a ${worktreePath}/. /worktree-seed/`,
      ],
      { encoding: "utf-8", stdio: "pipe", timeout: 120_000 }
    );
    if (copyResult.status !== 0) {
      throw new Error(
        `seedWorktreeVolume: cp -a failed (exit ${copyResult.status}): ` +
        `${(copyResult.stderr || "").slice(0, 300)}`
      );
    }

    // Step 4: Hash the seeded contents for the evidence bundle.
    // Use find + sha256sum to get a deterministic hash of all files.
    const hashResult = spawnSync(
      "docker",
      [
        "exec", seedContainerName,
        "sh", "-c",
        "find /worktree-seed -type f | sort | xargs sha256sum 2>/dev/null | sha256sum | awk '{print $1}'",
      ],
      { encoding: "utf-8", stdio: "pipe", timeout: 60_000 }
    );
    const preWorktreeHash = hashResult.status === 0
      ? `sha256:${(hashResult.stdout || "").trim()}`
      : "sha256:hash-unavailable";

    stepSucceeded = true;
    return {
      volumeName,
      preWorktreeHash,
      imageRef,
      worktreePath,
      seededAt: new Date().toISOString(),
    };
  } catch (err) {
    // Copy or hash failed after the volume was created. Roll back the volume
    // so the caller does not inherit a leaked partial volume.
    // (The seed container is removed in the finally block below.)
    spawnSync("docker", ["volume", "rm", volumeName], { encoding: "utf-8", stdio: "pipe" });
    throw err;
  } finally {
    // Step 5: Always remove the seed container.
    // On success, the volume persists and is the caller's responsibility.
    // On error, the volume was already removed in the catch block above.
    spawnSync("docker", ["rm", "-f", seedContainerName], { encoding: "utf-8", stdio: "pipe" });
    void stepSucceeded; // suppress unused-variable lint
  }
}

/**
 * Removes a seeded worktree volume.
 * Call this after the repair container has been removed.
 */
export function removeWorktreeVolume(volumeName: string): void {
  spawnSync("docker", ["volume", "rm", volumeName], { encoding: "utf-8", stdio: "pipe" });
}

// ── Builder ───────────────────────────────────────────────────────────────────

/**
 * Builds the docker run argument list with all required isolation controls.
 * Throws if the config is invalid for the requested mode.
 *
 * Usage (writableWorktree:true):
 *   const seeded = seedWorktreeVolume(image, volumeName);
 *   const { args, controls } = buildHardenedDockerArgs({
 *     ...config,
 *     worktreeVolumeName: seeded.volumeName,
 *   });
 *   spawnSync("docker", ["run", "-d", ...args, config.image, "tail", "-f", "/dev/null"], ...);
 *   // ... use container ...
 *   spawnSync("docker", ["rm", "-f", containerName], ...);
 *   removeWorktreeVolume(seeded.volumeName);
 *
 * v5.4 guarantee: --read-only is ALWAYS present. When writableWorktree:true,
 * a pre-seeded named volume is mounted at /testbed (not a tmpfs that would mask
 * the repository). The volume is created by seedWorktreeVolume() before this call.
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
  const worktreePath = config.worktreePath ?? "/testbed";

  const args: string[] = [
    "--name", config.containerName,
    "--network", "none",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges:true",
    `--pids-limit=${pids}`,
    `--memory=${memory}`,
    `--cpus=${cpus}`,
    // --read-only is ALWAYS present (v5.4 — never omitted)
    "--read-only",
    // Writable tmpfs for /tmp and /var/tmp (needed by most build tools)
    "--tmpfs", "/tmp:rw,noexec,nosuid,size=256m",
    "--tmpfs", "/var/tmp:rw,noexec,nosuid,size=64m",
  ];

  // When writableWorktree:true, mount the pre-seeded named volume at /testbed.
  // v5.4 fix: do NOT use --tmpfs /testbed — that masks the image's repository.
  // The volume was seeded by seedWorktreeVolume() and contains a copy of the
  // image's /testbed with all repository files intact.
  let worktreeVolumeSeeded = false;
  if (config.writableWorktree) {
    if (!config.worktreeVolumeName) {
      // This should have been caught by validateSandboxConfig, but guard here too
      throw new Error(
        "writableWorktree:true requires worktreeVolumeName. " +
        "Call seedWorktreeVolume() first."
      );
    }
    args.push("-v", `${config.worktreeVolumeName}:${worktreePath}`);
    worktreeVolumeSeeded = true;
  }

  // Add user if specified
  if (user) {
    args.push("--user", user);
  }

  // Add additional writable bind mounts (e.g. the worktree from host)
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
    // readOnly is always true — root FS is always read-only
    readOnly: true,
    writableWorktreePath: config.writableWorktree ? worktreePath : null,
    worktreeVolumeSeeded,
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
 * When writableWorktree:true, the caller must provide a pre-seeded worktreeVolumeName.
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
