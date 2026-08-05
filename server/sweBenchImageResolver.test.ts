/**
 * sweBenchImageResolver.test.ts
 *
 * Tests for the image resolution module.
 * All Docker calls are mocked — no real Docker daemon required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resolveImageDigest,
  resolveImageDigestTrusted,
  validatePinnedRef,
  ImageResolutionError,
} from "./sweBenchImageResolver";

// Mock child_process.spawnSync
vi.mock("child_process", () => ({
  spawnSync: vi.fn(),
}));

import { spawnSync } from "child_process";
const mockSpawn = vi.mocked(spawnSync);

const FAKE_DIGEST = "sha256:" + "a".repeat(64);
const FAKE_IMAGE = "swebench/sweb.eval.x86_64.django__django-11099";
const FAKE_TAG = `${FAKE_IMAGE}:latest`;
const FAKE_PINNED = `${FAKE_IMAGE}@${FAKE_DIGEST}`;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveImageDigest — untrusted_repair mode", () => {
  it("accepts an already-pinned digest reference without calling Docker", () => {
    const result = resolveImageDigest(FAKE_PINNED, "untrusted_repair");
    expect(result.alreadyPinned).toBe(true);
    expect(result.digest).toBe(FAKE_DIGEST);
    expect(result.resolvedRef).toBe(FAKE_PINNED);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("rejects a tag-only reference in untrusted_repair mode", () => {
    expect(() => resolveImageDigest(FAKE_TAG, "untrusted_repair"))
      .toThrow(ImageResolutionError);
    expect(() => resolveImageDigest(FAKE_TAG, "untrusted_repair"))
      .toThrow(/tag-only image references are not permitted/);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("rejects a bare name (no tag, no digest) in untrusted_repair mode", () => {
    expect(() => resolveImageDigest(FAKE_IMAGE, "untrusted_repair"))
      .toThrow(ImageResolutionError);
  });

  it("records the digest in the returned ResolvedImage", () => {
    const result = resolveImageDigest(FAKE_PINNED, "untrusted_repair");
    expect(result.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.resolvedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.inputRef).toBe(FAKE_PINNED);
  });
});

describe("resolveImageDigest — trusted_local mode", () => {
  it("resolves a tag via docker inspect in trusted_local mode", () => {
    mockSpawn.mockReturnValueOnce({
      status: 0,
      stdout: FAKE_PINNED + "\n",
      stderr: "",
      pid: 1,
      output: [],
      signal: null,
    } as any);

    const result = resolveImageDigest(FAKE_TAG, "trusted_local");
    expect(result.alreadyPinned).toBe(false);
    expect(result.resolvedRef).toBe(FAKE_PINNED);
    expect(result.digest).toBe(FAKE_DIGEST);
    expect(mockSpawn).toHaveBeenCalledWith(
      "docker",
      ["inspect", "--format", "{{index .RepoDigests 0}}", FAKE_TAG],
      expect.any(Object),
    );
  });

  it("throws when Docker inspect fails in trusted_local mode", () => {
    mockSpawn.mockReturnValue({
      status: 1,
      stdout: "",
      stderr: "Error: No such image",
      pid: 1,
      output: [],
      signal: null,
    } as any);

    expect(() => resolveImageDigest(FAKE_TAG, "trusted_local"))
      .toThrow(ImageResolutionError);
    expect(() => resolveImageDigest(FAKE_TAG, "trusted_local"))
      .toThrow(/docker inspect failed/);
  });

  it("throws when docker inspect returns <no value> (locally built image)", () => {
    mockSpawn.mockReturnValueOnce({
      status: 0,
      stdout: "<no value>\n",
      stderr: "",
      pid: 1,
      output: [],
      signal: null,
    } as any);

    expect(() => resolveImageDigest(FAKE_TAG, "trusted_local"))
      .toThrow(/no RepoDigest/);
  });

  it("throws when docker inspect returns unexpected format", () => {
    mockSpawn.mockReturnValueOnce({
      status: 0,
      stdout: "not-a-valid-digest-format\n",
      stderr: "",
      pid: 1,
      output: [],
      signal: null,
    } as any);

    expect(() => resolveImageDigest(FAKE_TAG, "trusted_local"))
      .toThrow(/unexpected format/);
  });
});

describe("resolveImageDigestTrusted — pull on miss", () => {
  it("pulls the image and retries inspect when not present locally", () => {
    // First inspect fails (not present)
    mockSpawn
      .mockReturnValueOnce({ status: 1, stdout: "", stderr: "No such image", pid: 1, output: [], signal: null } as any)
      // docker pull succeeds
      .mockReturnValueOnce({ status: 0, stdout: "latest: Pulling from...", stderr: "", pid: 1, output: [], signal: null } as any)
      // second inspect succeeds
      .mockReturnValueOnce({ status: 0, stdout: FAKE_PINNED + "\n", stderr: "", pid: 1, output: [], signal: null } as any);

    const result = resolveImageDigestTrusted(FAKE_TAG, true);
    expect(result.resolvedRef).toBe(FAKE_PINNED);
    expect(mockSpawn).toHaveBeenCalledTimes(3);
  });

  it("throws when docker pull fails", () => {
    mockSpawn
      .mockReturnValueOnce({ status: 1, stdout: "", stderr: "No such image", pid: 1, output: [], signal: null } as any)
      .mockReturnValueOnce({ status: 1, stdout: "", stderr: "pull access denied", pid: 1, output: [], signal: null } as any);

    expect(() => resolveImageDigestTrusted(FAKE_TAG, true))
      .toThrow(/docker pull failed/);
  });
});

describe("validatePinnedRef", () => {
  it("accepts a valid pinned reference", () => {
    expect(() => validatePinnedRef(FAKE_PINNED)).not.toThrow();
  });

  it("rejects a tag-only reference", () => {
    expect(() => validatePinnedRef(FAKE_TAG)).toThrow(ImageResolutionError);
  });

  it("rejects a bare name", () => {
    expect(() => validatePinnedRef(FAKE_IMAGE)).toThrow(ImageResolutionError);
  });

  it("rejects a short digest (not 64 hex chars)", () => {
    expect(() => validatePinnedRef(`${FAKE_IMAGE}@sha256:abc123`)).toThrow(ImageResolutionError);
  });
});
