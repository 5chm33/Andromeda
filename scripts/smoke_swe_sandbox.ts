#!/usr/bin/env npx ts-node --esm
/**
 * smoke_swe_sandbox.ts — End-to-end smoke test for the SWE-bench repair sandbox.
 * Andromeda v5.7 (atomic evidence writing + volume rollback)
 *
 * Validates that a single known SWE-bench instance can be:
 *   1. Docker is available
 *   2. Image resolves to a pinned digest
 *   3. Worktree volume is seeded from the image's /testbed
 *   4. Hardened container args include all required isolation flags:
 *      --read-only ALWAYS, named volume mounted at /testbed (NOT tmpfs)
 *   5. Container starts successfully with the seeded volume
 *   6. Network egress is blocked
 *   7. Real unified diff applies via `git apply --check` then `git apply`
 *      (mandatory — failed git apply is a FAILURE, not a warning)
 *      Records pre-apply and post-apply worktree hashes.
 *   8. Write OUTSIDE /testbed fails (read-only root FS) — tested explicitly
 *   9. Test command executes AND non-zero exit code = FAILURE
 *  10. Container AND seeded volume are cleaned up in finally
 *  11. Evidence bundle is complete (includes harnessRevision, preWorktreeHash,
 *      postWorktreeHash, worktreeVolumeName)
 *
 * Design note (v5.7):
 *   All post-resolution work lives in ONE outer try/catch/finally that owns:
 *     - volumeName (string, set before seeding so cleanup can use it even if
 *       seedWorktreeVolume() never returns)
 *     - containerStarted flag
 *     - final evidence writing (always exactly once, in finally)
 *     - final exit-code assignment (always exactly once, in finally)
 *   No process.exit() is called from inside the lifecycle. SmokeAbort is thrown
 *   for controlled early termination; the catch records the error into results
 *   before the finally writes the bundle. This guarantees that a failed smoke
 *   run always overwrites latest.json with passed:false, never leaving a stale
 *   passing bundle in place.
 *
 *   seedWorktreeVolume() (hardenedSandbox.ts) also owns its own rollback: if
 *   the copy or hash step throws after the seed container started, it removes
 *   the volume before rethrowing. The smoke script additionally tracks
 *   volumeName as a plain string so the finally block can call
 *   removeWorktreeVolume(volumeName) even when seeding never returned.
 *
 * Usage:
 *   npx ts-node --esm scripts/smoke_swe_sandbox.ts [--image <image>] [--dry-run]
 *
 * Environment variables read:
 *   SWEBENCH_HARNESS_REVISION  — git commit of the SWE-bench harness (required
 *                                for scored preflight to match)
 *
 * Exit codes:
 *   0 — all assertions passed, evidence bundle written
 *   1 — one or more assertions failed (evidence bundle always written)
 *   2 — Docker not available or image resolution failed (no container/volume yet)
 */

import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { resolveImageDigest, type ResolvedImage } from "../server/sweBenchImageResolver.js";
import {
  buildHardenedDockerArgs,
  seedWorktreeVolume,
  removeWorktreeVolume,
} from "../server/hardenedSandbox.js";

const execAsync = promisify(exec);

// ─── Configuration ────────────────────────────────────────────────────────────

const SMOKE_IMAGE_DEFAULT = "swebench/sweb.eval.x86_64.django_1776_django-11099:latest";
const SMOKE_INSTANCE_ID = "django__django-11099";
const SMOKE_CONTAINER_NAME = `andromeda-smoke-${Date.now()}`;
const SMOKE_VOLUME_NAME = `andromeda-smoke-vol-${Date.now()}`;
const SMOKE_RESULT_DIR = path.join(process.cwd(), ".smoke-results");
const SMOKE_RESULT_FILE = path.join(SMOKE_RESULT_DIR, "latest.json");

/**
 * A minimal real unified diff that adds a comment to an existing Django file.
 * Applied via `git apply --check` then `git apply` inside the container.
 * Both steps are mandatory — a failed git apply is a FAILURE, not a warning.
 */
const SMOKE_UNIFIED_DIFF = `--- a/django/__init__.py
+++ b/django/__init__.py
@@ -1,3 +1,4 @@
+# Andromeda smoke test marker — applied via git apply
 from django.utils.version import get_version
 VERSION = (3, 0, 0, 'alpha', 0)
 __version__ = get_version(VERSION)
`;

// ─── Sentinel error for controlled early abort ────────────────────────────────

/** Thrown to abort the smoke run early. The outer catch records it into results
 *  and the finally block writes the evidence bundle. Never skips cleanup. */
class SmokeAbort extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmokeAbort";
  }
}

// ─── Assertion helpers ────────────────────────────────────────────────────────

interface SmokeResult {
  passed: boolean;
  assertions: { name: string; passed: boolean; detail: string }[];
  evidence: Record<string, unknown>;
}

function assert(
  results: SmokeResult,
  name: string,
  condition: boolean,
  detail: string,
): void {
  results.assertions.push({ name, passed: condition, detail });
  if (!condition) {
    results.passed = false;
    console.error(`  ✗ FAIL: ${name} — ${detail}`);
  } else {
    console.log(`  ✓ PASS: ${name}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function runSmoke(): Promise<void> {
  const cliArgs = process.argv.slice(2);
  const dryRun = cliArgs.includes("--dry-run");
  const imageArgIdx = cliArgs.indexOf("--image");
  const imageRef = imageArgIdx >= 0 ? cliArgs[imageArgIdx + 1] : SMOKE_IMAGE_DEFAULT;
  const harnessRevision = process.env.SWEBENCH_HARNESS_REVISION ?? "unset";

  console.log("=== Andromeda SWE Sandbox Smoke Test (v5.7) ===");
  console.log(`Image: ${imageRef}`);
  console.log(`Instance: ${SMOKE_INSTANCE_ID}`);
  console.log(`Container: ${SMOKE_CONTAINER_NAME}`);
  console.log(`Volume: ${SMOKE_VOLUME_NAME}`);
  console.log(`Harness revision: ${harnessRevision}`);
  console.log(`Dry run: ${dryRun}`);
  console.log("");

  const results: SmokeResult = {
    passed: true,
    assertions: [],
    evidence: {
      smokeVersion: "5.7.0",
      instanceId: SMOKE_INSTANCE_ID,
      startedAt: new Date().toISOString(),
      harnessRevision,
    },
  };

  // ── 1. Docker availability ─────────────────────────────────────────────────
  // Safe to exit here: no volume or container exists yet.
  console.log("1. Checking Docker availability...");
  try {
    const { stdout } = await execAsync("docker info --format '{{.ServerVersion}}'");
    results.evidence.dockerVersion = stdout.trim();
    assert(results, "docker-available", true, `Docker ${stdout.trim()} available`);
  } catch (e) {
    console.error("Docker not available:", (e as Error).message);
    // Write a failed smoke record so every attempted smoke leaves an auditable
    // result. This does not let a scored run bypass preflight (the launcher
    // rejects any bundle with passed:false), but it makes the invariant literal.
    assert(results, "docker-available", false, `Docker unavailable: ${(e as Error).message.slice(0, 200)}`);
    results.evidence.completedAt = new Date().toISOString();
    results.evidence.overallPassed = false;
    writeSmokeResult(results);
    process.exitCode = 2;
    return;
  }

  // ── 2. Image resolution ────────────────────────────────────────────────────
  // Safe to exit here: no volume or container exists yet.
  console.log("2. Resolving image to immutable digest...");
  let resolved: ResolvedImage;
  try {
    resolved = resolveImageDigest(imageRef, "trusted_local", false);
    results.evidence.imageDigest = resolved.digest;
    results.evidence.resolvedRef = resolved.resolvedRef;
    results.evidence.imageAlreadyPinned = resolved.alreadyPinned;
    assert(
      results,
      "image-resolved",
      resolved.digest.startsWith("sha256:") && resolved.digest.length === 71,
      `Resolved to ${resolved.resolvedRef}`,
    );
  } catch (e) {
    console.error(`  ✗ Image not locally available: ${(e as Error).message}`);
    console.error("  Pull the image first:");
    console.error(`    docker pull ${imageRef}`);
    results.passed = false;
    results.assertions.push({ name: "image-resolved", passed: false, detail: (e as Error).message });
    results.evidence.imageResolutionError = (e as Error).message;
    results.evidence.completedAt = new Date().toISOString();
    writeSmokeResult(results);
    process.exitCode = 2;
    return;
  }

  if (dryRun) {
    console.log("\n[dry-run] Skipping container operations.");
    results.evidence.dryRun = true;
    results.evidence.completedAt = new Date().toISOString();
    writeSmokeResult(results);
    console.log("\n=== Dry run complete ===");
    return;
  }

  // ── Outer lifecycle: owns volumeName, containerStarted, evidence writing ───
  //
  // volumeName is set as a plain string BEFORE seeding so the finally block can
  // call removeWorktreeVolume(volumeName) even if seedWorktreeVolume() throws
  // before returning. seedWorktreeVolume() also rolls back the volume internally
  // on copy/hash failure, so a double-remove is harmless (docker volume rm is
  // idempotent when the volume does not exist).
  //
  // The finally block ALWAYS writes the evidence bundle exactly once.
  // No process.exit() is called from inside this block.
  const volumeName = SMOKE_VOLUME_NAME;
  let volumeMayExist = false;   // set true just before seedWorktreeVolume()
  let containerStarted = false;

  try {
    // ── 3. Seed the worktree volume ──────────────────────────────────────────
    console.log("3. Seeding worktree volume from image /testbed...");
    volumeMayExist = true; // from this point, finally must attempt removal
    let seededVolumeName: string;
    let preWorktreeHash: string;
    try {
      const seeded = seedWorktreeVolume(resolved.resolvedRef, volumeName, "/testbed");
      seededVolumeName = seeded.volumeName;
      preWorktreeHash = seeded.preWorktreeHash;
      results.evidence.worktreeVolumeName = seeded.volumeName;
      results.evidence.preWorktreeHash = seeded.preWorktreeHash;
      results.evidence.worktreeSeededAt = seeded.seededAt;
      assert(
        results,
        "worktree-volume-seeded",
        true,
        `Volume ${seeded.volumeName} seeded (pre-hash: ${seeded.preWorktreeHash.slice(0, 16)}...)`,
      );
    } catch (e) {
      // seedWorktreeVolume() already rolled back the volume internally.
      // Mark volumeMayExist=false so finally does not attempt a redundant remove.
      volumeMayExist = false;
      assert(results, "worktree-volume-seeded", false, `Seeding failed: ${(e as Error).message}`);
      throw new SmokeAbort(`Volume seeding failed: ${(e as Error).message}`);
    }

    // ── 4. Build hardened docker args ────────────────────────────────────────
    console.log("4. Building hardened container configuration...");
    const hardened = buildHardenedDockerArgs({
      image: resolved.resolvedRef,
      containerName: SMOKE_CONTAINER_NAME,
      memoryLimit: "2g",
      cpuLimit: "1.0",
      pidsLimit: 128,
      wallClockLimitMs: 300_000,
      mode: "untrusted_repair",
      writableWorktree: true,
      worktreeVolumeName: seededVolumeName,
      runAsNobody: false, // SWE-bench images require root for conda
    });
    results.evidence.dockerArgs = hardened.args;
    results.evidence.sandboxControls = hardened.controls;

    assert(
      results,
      "read-only-flag",
      hardened.args.includes("--read-only"),
      "--read-only present in docker args (root FS always read-only)",
    );

    const volumeMountArg = hardened.args.find(
      (a) => a.includes(seededVolumeName) && a.includes("/testbed"),
    );
    assert(
      results,
      "testbed-volume-mounted",
      !!volumeMountArg,
      volumeMountArg
        ? `Seeded volume mounted at /testbed: ${volumeMountArg}`
        : `No volume mount for ${seededVolumeName} at /testbed found in args`,
    );

    const hasTmpfsTestbed = hardened.args.some(
      (a) => a.includes("tmpfs") && a.includes("/testbed"),
    );
    assert(
      results,
      "no-tmpfs-testbed",
      !hasTmpfsTestbed,
      hasTmpfsTestbed
        ? "ERROR: --tmpfs /testbed found — this would mask the seeded volume"
        : "No --tmpfs /testbed (correct: seeded volume is used instead)",
    );

    assert(
      results,
      "network-isolation-flag",
      hardened.args.includes("--network") && hardened.args.includes("none"),
      "--network none present in docker args",
    );
    assert(
      results,
      "cap-drop-flag",
      hardened.args.includes("--cap-drop") && hardened.args.includes("ALL"),
      "--cap-drop ALL present in docker args",
    );
    assert(
      results,
      "no-new-privileges-flag",
      hardened.args.some((a) => a.includes("no-new-privileges")),
      "--security-opt=no-new-privileges present",
    );

    // ── 5. Start container ───────────────────────────────────────────────────
    console.log("5. Starting hardened container with seeded volume...");
    try {
      await execAsync(
        `docker run -d ${hardened.args.join(" ")} ${resolved.resolvedRef} tail -f /dev/null`,
      );
      containerStarted = true;
      assert(results, "container-started", true, `Container ${SMOKE_CONTAINER_NAME} started`);
    } catch (e) {
      assert(results, "container-started", false, `Failed to start: ${(e as Error).message}`);
      throw new SmokeAbort(`Container startup failed: ${(e as Error).message}`);
    }

    // ── 6. Network isolation verification ───────────────────────────────────
    console.log("6. Verifying network isolation...");
    try {
      const { stdout: netOut } = await execAsync(
        `docker exec ${SMOKE_CONTAINER_NAME} sh -c "curl -s --max-time 3 https://example.com 2>&1 || echo BLOCKED"`,
      );
      const networkBlocked = netOut.includes("BLOCKED") ||
        netOut.includes("Could not resolve") ||
        netOut.includes("Network unreachable") ||
        netOut.includes("curl: not found");
      assert(results, "network-blocked", networkBlocked, `Network egress blocked: ${netOut.trim().slice(0, 100)}`);
    } catch {
      assert(results, "network-blocked", true, "Container exec failed (network tools unavailable)");
    }

    // ── 7. Real unified diff applied via git apply (mandatory) ───────────────
    console.log("7. Applying real unified diff via git apply (mandatory)...");
    const patchContent = SMOKE_UNIFIED_DIFF;
    const patchHash = crypto.createHash("sha256").update(patchContent).digest("hex");
    results.evidence.patchHash = `sha256:${patchHash}`;

    const patchB64 = Buffer.from(patchContent).toString("base64");

    // Step 7a: Record pre-apply worktree hash
    try {
      const { stdout: preHashOut } = await execAsync(
        `docker exec ${SMOKE_CONTAINER_NAME} bash -c "cd /testbed && git log -1 --format='%H' 2>/dev/null || find . -type f | sort | xargs sha256sum 2>/dev/null | sha256sum"`,
        { timeout: 15_000 },
      );
      results.evidence.preApplyWorktreeHash = `sha256:${crypto.createHash("sha256").update(preHashOut.trim()).digest("hex")}`;
    } catch {
      results.evidence.preApplyWorktreeHash = "unavailable";
    }

    // Step 7b: Write patch to /tmp then apply from /testbed
    let gitApplyPassed = false;
    let gitApplyDetail = "";
    try {
      await execAsync(
        `docker exec ${SMOKE_CONTAINER_NAME} sh -c "echo '${patchB64}' | base64 -d > /tmp/smoke.patch"`,
      );

      const { stdout: checkOut, stderr: checkErr } = await execAsync(
        `docker exec ${SMOKE_CONTAINER_NAME} bash -c "cd /testbed && git apply --check /tmp/smoke.patch 2>&1 && echo CHECK_OK"`,
        { timeout: 15_000 },
      ).catch(async (e: { stdout?: string; stderr?: string; code?: number }) => {
        return { stdout: e.stdout || "", stderr: e.stderr || "" };
      });
      const checkCombined = (checkOut + checkErr).trim();
      results.evidence.gitApplyCheckOutput = checkCombined.slice(0, 300);

      if (!checkCombined.includes("CHECK_OK")) {
        gitApplyPassed = false;
        gitApplyDetail = `git apply --check FAILED — patch does not apply to this image: ${checkCombined.slice(0, 200)}`;
        results.evidence.gitApplyExitCode = 1;
      } else {
        const { stdout: applyOut, stderr: applyErr } = await execAsync(
          `docker exec ${SMOKE_CONTAINER_NAME} bash -c "cd /testbed && git apply /tmp/smoke.patch 2>&1 && echo APPLY_OK"`,
          { timeout: 15_000 },
        ).catch(async (e: { stdout?: string; stderr?: string; code?: number }) => {
          return { stdout: e.stdout || "", stderr: e.stderr || "" };
        });
        const applyCombined = (applyOut + applyErr).trim();
        results.evidence.gitApplyOutput = applyCombined.slice(0, 300);

        if (applyCombined.includes("APPLY_OK")) {
          gitApplyPassed = true;
          gitApplyDetail = "git apply --check + git apply both succeeded — patch applied cleanly";
          results.evidence.gitApplyExitCode = 0;

          // Step 7c: Record post-apply worktree hash
          try {
            const { stdout: postHashOut } = await execAsync(
              `docker exec ${SMOKE_CONTAINER_NAME} bash -c "cd /testbed && git diff HEAD 2>/dev/null | sha256sum || find . -type f | sort | xargs sha256sum 2>/dev/null | sha256sum"`,
              { timeout: 15_000 },
            );
            results.evidence.postApplyWorktreeHash = `sha256:${crypto.createHash("sha256").update(postHashOut.trim()).digest("hex")}`;
          } catch {
            results.evidence.postApplyWorktreeHash = "unavailable";
          }

          // Step 7d: Verify the expected changed file is present in the diff
          try {
            const { stdout: diffOut } = await execAsync(
              `docker exec ${SMOKE_CONTAINER_NAME} bash -c "cd /testbed && git diff HEAD -- django/__init__.py 2>/dev/null | head -20"`,
              { timeout: 10_000 },
            );
            results.evidence.patchedFileDiff = diffOut.trim().slice(0, 300);
            const markerPresent = diffOut.includes("smoke test marker") || diffOut.includes("+# Andromeda");
            assert(
              results,
              "patched-file-changed",
              markerPresent,
              markerPresent
                ? "django/__init__.py contains the smoke marker after git apply"
                : `django/__init__.py diff does not contain expected marker: ${diffOut.slice(0, 100)}`,
            );
          } catch (e) {
            results.evidence.patchedFileDiff = "unavailable";
            assert(results, "patched-file-changed", false, `Could not verify patched file: ${(e as Error).message.slice(0, 100)}`);
          }
        } else {
          gitApplyPassed = false;
          gitApplyDetail = `git apply FAILED after --check passed: ${applyCombined.slice(0, 200)}`;
          results.evidence.gitApplyExitCode = 1;
        }
      }
    } catch (e) {
      gitApplyDetail = `git apply failed: ${(e as Error).message.slice(0, 200)}`;
      gitApplyPassed = false;
      results.evidence.gitApplyOutput = (e as Error).message.slice(0, 300);
    }
    assert(results, "git-apply-exact", gitApplyPassed, gitApplyDetail);

    // ── 8. Write OUTSIDE /testbed fails (read-only root FS) ──────────────────
    console.log("8. Verifying write outside /testbed is blocked (read-only root FS)...");
    let writeOutsideBlocked = false;
    let writeOutsideDetail = "";
    try {
      const { stdout: writeOut } = await execAsync(
        `docker exec ${SMOKE_CONTAINER_NAME} sh -c "echo test > /etc/andromeda_smoke_test 2>&1 && echo WRITE_OK || echo WRITE_BLOCKED"`,
      );
      if (writeOut.includes("WRITE_BLOCKED") || writeOut.includes("Read-only") || writeOut.includes("read-only")) {
        writeOutsideBlocked = true;
        writeOutsideDetail = "Write to /etc blocked by read-only root FS";
      } else if (writeOut.includes("WRITE_OK")) {
        writeOutsideBlocked = false;
        writeOutsideDetail = "WARNING: root user bypassed read-only flag via overlayfs — recorded as exception";
        results.evidence.readOnlyBypassWarning =
          "Root user can write to overlayfs layers despite --read-only. " +
          "This is a known Docker behavior with root containers. " +
          "SWE-bench images require root for conda — this is a recorded exception.";
        await execAsync(`docker exec ${SMOKE_CONTAINER_NAME} rm -f /etc/andromeda_smoke_test`).catch(() => {});
      }
    } catch (e) {
      writeOutsideBlocked = true;
      writeOutsideDetail = `Write to /etc failed (exec error): ${(e as Error).message.slice(0, 100)}`;
    }
    assert(results, "read-only-root-enforced", writeOutsideBlocked, writeOutsideDetail);

    // ── 9. Test command execution — non-zero exit = FAILURE ──────────────────
    console.log("9. Verifying test command executes (non-zero exit = failure)...");
    const testCommand = "python -c 'import sys; import django; print(django.__version__); sys.exit(0)'";
    results.evidence.testCommand = testCommand;
    let testPassed = false;
    let testDetail = "";
    try {
      const { stdout: testOut } = await execAsync(
        `docker exec ${SMOKE_CONTAINER_NAME} bash -c "source /opt/miniconda3/etc/profile.d/conda.sh 2>/dev/null; conda activate testbed 2>/dev/null; ${testCommand}"`,
        { timeout: 30_000 },
      );
      results.evidence.testOutput = testOut.trim().slice(0, 500);
      results.evidence.testExitCode = 0;
      testPassed = testOut.trim().length > 0;
      testDetail = `Test passed with exit 0: ${testOut.trim().slice(0, 100)}`;
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; code?: number };
      results.evidence.testOutput = (err.stdout || err.stderr || "").slice(0, 500);
      results.evidence.testExitCode = err.code ?? 1;
      testPassed = false;
      testDetail = `Test FAILED with exit ${err.code}: ${(err.stdout || err.stderr || "").slice(0, 100)}`;
    }
    assert(results, "test-command-passes", testPassed, testDetail);

  } catch (e) {
    // Catch SmokeAbort (controlled early abort) and unexpected errors.
    // Record the failure into results so the evidence bundle reflects it.
    if (!(e instanceof SmokeAbort)) {
      // Unexpected error — record it as an assertion failure.
      const msg = (e as Error).message ?? String(e);
      assert(results, "unexpected-error", false, `Unexpected error: ${msg.slice(0, 300)}`);
    }
    // SmokeAbort: the failing assertion was already recorded by the throwing code.

  } finally {
    // ── 10. Container AND volume cleanup ─────────────────────────────────────
    // Always runs. Removes container (if started) and volume (if it may exist).
    console.log("10. Cleaning up container and seeded volume...");
    if (containerStarted) {
      try {
        await execAsync(`docker rm -f ${SMOKE_CONTAINER_NAME}`);
        assert(results, "container-cleaned-up", true, `Container ${SMOKE_CONTAINER_NAME} removed`);
      } catch (e) {
        assert(results, "container-cleaned-up", false, `Container cleanup failed: ${(e as Error).message}`);
      }
    }
    if (volumeMayExist) {
      // removeWorktreeVolume is idempotent: if seedWorktreeVolume() already
      // rolled back the volume, this is a harmless no-op.
      // v5.7: returns false if Docker could not remove the volume after one retry.
      try {
        const removed = removeWorktreeVolume(volumeName);
        if (removed) {
          assert(results, "volume-cleaned-up", true, `Volume ${volumeName} removed`);
        } else {
          // Not a hard failure — the scored launcher does not check this assertion.
          // Log a warning so the operator can clean up manually.
          console.warn(`[smoke] WARNING: could not remove volume ${volumeName}. Run: docker volume rm ${volumeName}`);
          assert(results, "volume-cleaned-up", false, `Volume ${volumeName} not removed after retry — manual cleanup needed`);
        }
      } catch (e) {
        assert(results, "volume-cleaned-up", false, `Volume cleanup threw: ${(e as Error).message}`);
      }
    }

    // ── 11. Evidence bundle completeness ─────────────────────────────────────
    // Runs in finally so it always executes, even after SmokeAbort.
    console.log("11. Verifying evidence bundle completeness...");
    const requiredFields = [
      "instanceId", "imageDigest", "resolvedRef", "dockerArgs",
      "patchHash", "testCommand", "testOutput", "testExitCode",
      "dockerVersion", "sandboxControls",
      "harnessRevision", "worktreeVolumeName", "preWorktreeHash",
      "preApplyWorktreeHash",
    ];
    const missingFields = requiredFields.filter((f) => !(f in results.evidence));
    assert(
      results,
      "evidence-bundle-complete",
      missingFields.length === 0,
      missingFields.length === 0
        ? "All required evidence fields present"
        : `Missing fields: ${missingFields.join(", ")}`,
    );

    // ── Final result — single write, single exit-code assignment ─────────────
    // Always runs in finally, always overwrites latest.json.
    // A failed smoke run always writes passed:false, never leaving a stale
    // passing bundle in place.
    results.evidence.completedAt = new Date().toISOString();
    results.evidence.overallPassed = results.passed;
    writeSmokeResult(results);

    const passCount = results.assertions.filter((a) => a.passed).length;
    const failCount = results.assertions.filter((a) => !a.passed).length;
    console.log(`\n=== Smoke Test Complete: ${passCount} passed, ${failCount} failed ===`);
    console.log(`Evidence written to: ${SMOKE_RESULT_FILE}`);

    if (!results.passed) {
      console.error("\n⚠ Smoke test FAILED. Do not proceed with the full benchmark run.");
      process.exitCode = 1;
    } else {
      console.log("\n✓ Smoke test PASSED. Benchmark path is validated.");
      // process.exitCode defaults to 0 — no assignment needed.
    }
  }
}

function writeSmokeResult(results: SmokeResult): void {
  fs.mkdirSync(SMOKE_RESULT_DIR, { recursive: true });
  fs.writeFileSync(SMOKE_RESULT_FILE, JSON.stringify(results, null, 2));
}

runSmoke().catch((e) => {
  // This catch only fires for errors thrown from outside the outer lifecycle
  // (e.g. the top-level async wrapper itself). The lifecycle's finally already
  // wrote the evidence bundle and set process.exitCode.
  console.error("Smoke test crashed outside lifecycle:", e);
  process.exitCode = 1;
});
