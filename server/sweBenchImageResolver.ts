/**
 * sweBenchImageResolver.ts
 *
 * Resolves Docker image tags to immutable sha256 digests before any container
 * is created in untrusted_repair mode. A mutable tag is never accepted as a
 * valid image reference for untrusted execution.
 *
 * Design:
 *  - resolveImageDigest(image) → { digest, resolvedRef, resolvedAt }
 *  - Fails closed: if Docker is unavailable or the image cannot be inspected,
 *    throws rather than returning a tag-only reference.
 *  - Accepts "image@sha256:..." directly (already pinned).
 *  - Rejects "image:tag" in untrusted_repair mode.
 *  - Records every resolution in a per-run evidence field.
 */

import { spawnSync } from "child_process";

export interface ResolvedImage {
  /** The original reference supplied by the caller. */
  inputRef: string;
  /** The immutable digest, e.g. "swebench/sweb.eval.x86_64.django__django-11099@sha256:abc123..." */
  resolvedRef: string;
  /** The bare sha256 digest string, e.g. "sha256:abc123..." */
  digest: string;
  /** ISO timestamp of resolution. */
  resolvedAt: string;
  /** Whether the image was already pinned (true) or was resolved from a tag (false). */
  alreadyPinned: boolean;
}

export class ImageResolutionError extends Error {
  constructor(
    public readonly inputRef: string,
    public readonly reason: string,
  ) {
    super(`[ImageResolver] Cannot resolve "${inputRef}": ${reason}`);
    this.name = "ImageResolutionError";
  }
}

const DIGEST_RE = /^[a-zA-Z0-9_.\-/]+@sha256:[a-f0-9]{64}$/;
const TAG_ONLY_RE = /^[a-zA-Z0-9_.\-/]+(:[a-zA-Z0-9_.\-]+)?$/;

/**
 * Resolve an image reference to an immutable digest.
 *
 * @param imageRef  The image name/tag/digest to resolve.
 * @param mode      Execution mode. In "untrusted_repair" a tag-only ref is rejected.
 * @param pullIfMissing  If true, attempt `docker pull` before inspect.
 */
export function resolveImageDigest(
  imageRef: string,
  mode: "trusted_local" | "untrusted_repair" = "untrusted_repair",
  pullIfMissing = false,
): ResolvedImage {
  const resolvedAt = new Date().toISOString();

  // Already pinned — accept immediately.
  if (DIGEST_RE.test(imageRef)) {
    const digest = "sha256:" + imageRef.split("@sha256:")[1];
    return {
      inputRef: imageRef,
      resolvedRef: imageRef,
      digest,
      resolvedAt,
      alreadyPinned: true,
    };
  }

  // Tag-only in untrusted_repair mode — fail closed.
  if (mode === "untrusted_repair") {
    throw new ImageResolutionError(
      imageRef,
      `tag-only image references are not permitted in untrusted_repair mode. ` +
      `Resolve to a digest first using "docker inspect --format='{{index .RepoDigests 0}}' ${imageRef}" ` +
      `or pass the image as "name@sha256:<digest>".`,
    );
  }

  // trusted_local: attempt to resolve via docker inspect.
  return _resolveViaDocker(imageRef, resolvedAt, pullIfMissing);
}

/**
 * Resolve an image to a digest via `docker inspect`.
 * Used in trusted_local mode and by the pre-flight resolver.
 */
export function resolveImageDigestTrusted(
  imageRef: string,
  pullIfMissing = true,
): ResolvedImage {
  const resolvedAt = new Date().toISOString();

  if (DIGEST_RE.test(imageRef)) {
    const digest = "sha256:" + imageRef.split("@sha256:")[1];
    return { inputRef: imageRef, resolvedRef: imageRef, digest, resolvedAt, alreadyPinned: true };
  }

  return _resolveViaDocker(imageRef, resolvedAt, pullIfMissing);
}

function _resolveViaDocker(imageRef: string, resolvedAt: string, pullIfMissing: boolean): ResolvedImage {
  // Try docker inspect first.
  let result = spawnSync("docker", [
    "inspect",
    "--format", "{{index .RepoDigests 0}}",
    imageRef,
  ], { encoding: "utf-8", timeout: 30_000 });

  if (result.status !== 0 && pullIfMissing) {
    // Image not present locally — pull it.
    const pull = spawnSync("docker", ["pull", imageRef], {
      encoding: "utf-8",
      timeout: 300_000,
      stdio: "pipe",
    });
    if (pull.status !== 0) {
      throw new ImageResolutionError(
        imageRef,
        `docker pull failed (exit ${pull.status}): ${(pull.stderr || "").slice(0, 300)}`,
      );
    }
    // Re-inspect after pull.
    result = spawnSync("docker", [
      "inspect",
      "--format", "{{index .RepoDigests 0}}",
      imageRef,
    ], { encoding: "utf-8", timeout: 30_000 });
  }

  if (result.status !== 0 || !result.stdout.trim()) {
    throw new ImageResolutionError(
      imageRef,
      `docker inspect failed (exit ${result.status ?? "null"}): ${(result.stderr || "").slice(0, 300)}`,
    );
  }

  const resolvedRef = result.stdout.trim();
  if (!resolvedRef || resolvedRef === "<no value>") {
    throw new ImageResolutionError(
      imageRef,
      `docker inspect returned no RepoDigest for "${imageRef}". ` +
      `The image may not have been pulled from a registry (locally built images have no digest). ` +
      `Push the image to a registry and pull it back to obtain a digest.`,
    );
  }

  if (!DIGEST_RE.test(resolvedRef)) {
    throw new ImageResolutionError(
      imageRef,
      `docker inspect returned an unexpected format: "${resolvedRef}". Expected "name@sha256:<64-hex>".`,
    );
  }

  const digest = "sha256:" + resolvedRef.split("@sha256:")[1];
  return {
    inputRef: imageRef,
    resolvedRef,
    digest,
    resolvedAt,
    alreadyPinned: false,
  };
}

/**
 * Validate that a resolved image reference meets the untrusted_repair contract:
 *  - Must contain "@sha256:" with a 64-hex digest.
 *  - Must not be a tag-only reference.
 */
export function validatePinnedRef(ref: string): void {
  if (!DIGEST_RE.test(ref)) {
    throw new ImageResolutionError(
      ref,
      `image reference does not contain a pinned sha256 digest. ` +
      `Untrusted repair requires "name@sha256:<64-hex>".`,
    );
  }
}
