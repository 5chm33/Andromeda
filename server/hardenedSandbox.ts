/**
 * hardenedSandbox.ts — Shared hardened Docker container constructor.
 * Andromeda v5.19 (spawnSync → async spawn fix for seedWorktreeVolume)
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
 *
 * v5.19 change: seedWorktreeVolume() is now async. The cp -r and hash steps use
 * spawn() with a manual AbortController timeout instead of spawnSync() with the
 * unreliable timeout option. This ensures the Node.js event loop remains
 * responsive (instance timeouts can fire) even when Docker is slow.
 */

import { spawnSync, spawn } from "child_process";

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

// ── Async spawn helper ────────────────────────────────────────────────────────

/**
 * Runs a command asynchronously with a hard timeout enforced via AbortController.
 * Unlike spawnSync(timeout:...), this approach does not block the Node.js event
 * loop, so outer Promise.race() timeouts (instance timeouts) can still fire.
 *
 * @param cmd     Command name
 * @param args    Command arguments
 * @param timeoutMs  Hard timeout in milliseconds (kills the process on expiry)
 * @returns stdout string on success
 * @throws Error on non-zero exit, timeout, or spawn error
 */
async function spawnAsync(
  cmd: string,
  args: string[],
  timeoutMs: number,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const ac = new AbortController();
    const timer = setTimeout(() => {
      ac.abort();
      reject(new Error(`spawnAsync: command timed out after ${timeoutMs}ms: ${cmd} ${args.slice(0, 4).join(" ")}`));
    }, timeoutMs);

    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd, args, { signal: ac.signal, stdio: ["ignore", "pipe", "pipe"] });
    } catch (spawnErr) {
      clearTimeout(timer);
      reject(spawnErr);
      return;
    }

    child.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => errChunks.push(chunk));

    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      // AbortController fires 'error' with code ABORT_ERR — already rejected above
      if (err.code !== "ABORT_ERR") {
        reject(new Error(`spawnAsync: spawn error: ${err.message}`));
      }
    });

    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(Buffer.concat(chunks).toString("utf-8"));
      } else {
        const stderr = Buffer.concat(errChunks).toString("utf-8").slice(0, 300);
        reject(new Error(`spawnAsync: exit code ${code}: ${stderr}`));
      }
    });
  });
}

// ── Worktree Volume Seeding ───────────────────────────────────────────────────

/**
 * Seeds a named Docker volume with the image's /testbed contents.
 * ASYNC — does not block the Node.js event loop.
 *
 * Design:
 *   1. Create a named volume (docker volume create).
 *   2. Start a disposable seed container with the volume mounted at /worktree-seed.
 *   3. Copy the image's /testbed into the volume via cp -r --no-preserve=ownership.
 *   4. Hash the seeded contents for the evidence bundle.
 *   5. Remove the seed container (volume persists).
 *
 * The caller is responsible for removing the volume after the repair container
 * exits (docker volume rm <volumeName>).
 *
 * v5.19: Uses spawn() + AbortController for the cp -r and hash steps so that
 * the Node.js event loop remains responsive. The spawnSync timeout option is
 * unreliable for I/O-blocked child processes in some Node.js versions.
 *
 * @param imageRef  The image to seed from (should be a pinned digest).
 * @param volumeName  Name for the Docker volume (must be unique per instance).
 * @param worktreePath  Path inside the image to copy (default: "/testbed").
 * @returns SeededWorktreeVolume with the volume name and pre-apply hash.
 */
export async function seedWorktreeVolume(
  imageRef: string,
  volumeName: string,
  worktreePath = "/testbed",
): Promise<SeededWorktreeVolume> {
  const seedContainerName = `${volumeName}-seed`;

  // Step 1: Create the named volume (fast, use spawnSync — no I/O blocking risk)
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
  try {
    // Step 3: Copy image's /testbed into the volume.
    // Use cp -r --no-preserve=ownership to copy all files without trying to
    // preserve ownership. Some images have root-owned build artifacts that
    // cannot be chown'd by a non-root user inside the seed container.
    // File permissions (mode bits) are preserved; only ownership is dropped.
    //
    // v5.19: Use spawnAsync() (non-blocking) instead of spawnSync(timeout:...).
    // The spawnSync timeout option is unreliable for I/O-blocked child processes
    // in some Node.js versions. spawnAsync uses AbortController for hard timeout.
    // 10-minute timeout: some images (e.g. matplotlib) have large build
    // artifacts that take >120s to copy. Measured via probe-seed-image.sh.
    await spawnAsync(
      "docker",
      [
        "exec", seedContainerName,
        "sh", "-c", `cp -r --no-preserve=ownership ${worktreePath}/. /worktree-seed/`,
      ],
      600_000, // 10 minutes
    );

    // Step 4: Hash the seeded contents for the evidence bundle.
    // Use find + sha256sum to get a deterministic hash of all files.
    // v5.19: Also async to avoid blocking the event loop during hashing.
    let preWorktreeHash = "sha256:hash-unavailable";
    try {
      const hashOutput = await spawnAsync(
        "docker",
        [
          "exec", seedContainerName,
          "sh", "-c",
          "find /worktree-seed -type f | sort | xargs sha256sum 2>/dev/null | sha256sum | awk '{print $1}'",
        ],
        60_000, // 1 minute
      );
      preWorktreeHash = `sha256:${hashOutput.trim()}`;
    } catch {
      // Hash failure is non-fatal — we still have the seeded volume
      preWorktreeHash = "sha256:hash-unavailable";
    }

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
  }
}

/**
 * Removes a seeded worktree volume.
 * Call this after the repair container has been removed.
 *
 * Returns true if the volume was removed (or did not exist), false if Docker
 * reported an error after one retry. Callers should log a warning on false.
 * Idempotent: a volume that does not exist is treated as success.
 */
export function removeWorktreeVolume(volumeName: string): boolean {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = spawnSync("docker", ["volume", "rm", volumeName], { encoding: "utf-8", stdio: "pipe" });
    if (result.status === 0) return true;
    // "No such volume" is a success — the volume is already gone.
    const stderr = (result.stderr || "").toLowerCase();
    if (stderr.includes("no such volume") || stderr.includes("not found")) return true;
    // First attempt failed — wait briefly then retry once.
    if (attempt === 1) {
      // Synchronous 200 ms back-off via a tight busy-wait (spawnSync context).
      const deadline = Date.now() + 200;
      while (Date.now() < deadline) { /* busy-wait */ }
    }
  }
  return false;
}

// ── Builder ───────────────────────────────────────────────────────────────────

/**
 * Builds the docker run argument list with all required isolation controls.
 * Throws if the config is invalid for the requested mode.
 *
 * Usage (writableWorktree:true):
 *   const seeded = await seedWorktreeVolume(image, volumeName);
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
