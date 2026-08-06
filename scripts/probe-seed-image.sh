#!/usr/bin/env bash
# probe-seed-image.sh — Measure seeding cost for a SWE-bench Docker image.
#
# Records: image digest, testbed byte count, file count, cp -r duration,
# sha256 hash duration. Results are written to stdout as JSON and optionally
# to a file for the run manifest.
#
# Usage:
#   ./scripts/probe-seed-image.sh <image-tag-or-digest> [/testbed]
#
# Example:
#   ./scripts/probe-seed-image.sh swebench/sweb.eval.x86_64.matplotlib_1776_matplotlib-20488:latest
#
# The script requires Docker to be running and the image to be pulled.
# It creates and removes a temporary volume and container automatically.

set -euo pipefail

IMAGE="${1:-}"
WORKTREE="${2:-/testbed}"

if [[ -z "$IMAGE" ]]; then
  echo "Usage: $0 <image-tag-or-digest> [/testbed]" >&2
  exit 1
fi

# Resolve to immutable digest
echo "[probe] Resolving image digest..." >&2
DIGEST=$(docker inspect --format='{{index .RepoDigests 0}}' "$IMAGE" 2>/dev/null || true)
if [[ -z "$DIGEST" ]]; then
  # Fall back to image ID if no repo digest available
  DIGEST=$(docker inspect --format='{{.Id}}' "$IMAGE" 2>/dev/null || echo "unknown")
fi
echo "[probe] Digest: $DIGEST" >&2

# Create a temporary volume
VOLUME_NAME="probe-seed-$(date +%s)-$$"
docker volume create "$VOLUME_NAME" > /dev/null
echo "[probe] Created volume: $VOLUME_NAME" >&2

# Start a seed container
CONTAINER_NAME="${VOLUME_NAME}-container"
docker run -d \
  --name "$CONTAINER_NAME" \
  --network none \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  -v "${VOLUME_NAME}:/worktree-seed" \
  "$IMAGE" \
  tail -f /dev/null > /dev/null
echo "[probe] Started seed container: $CONTAINER_NAME" >&2

# Measure testbed size
echo "[probe] Measuring testbed size..." >&2
BYTE_COUNT=$(docker exec "$CONTAINER_NAME" sh -c "du -sb ${WORKTREE} 2>/dev/null | cut -f1" || echo "0")
FILE_COUNT=$(docker exec "$CONTAINER_NAME" sh -c "find ${WORKTREE} -type f | wc -l" || echo "0")
echo "[probe] Testbed: ${BYTE_COUNT} bytes, ${FILE_COUNT} files" >&2

# Measure cp -r duration
echo "[probe] Timing cp -r --no-preserve=ownership..." >&2
CP_START=$(date +%s%3N)
docker exec "$CONTAINER_NAME" sh -c "cp -r --no-preserve=ownership ${WORKTREE}/. /worktree-seed/"
CP_END=$(date +%s%3N)
CP_DURATION_MS=$((CP_END - CP_START))
echo "[probe] cp -r took ${CP_DURATION_MS}ms" >&2

# Measure hash duration
echo "[probe] Timing sha256 hash of seeded volume..." >&2
HASH_START=$(date +%s%3N)
CONTENT_HASH=$(docker exec "$CONTAINER_NAME" sh -c \
  "find /worktree-seed -type f | sort | xargs sha256sum 2>/dev/null | sha256sum | awk '{print \$1}'" || echo "hash-failed")
HASH_END=$(date +%s%3N)
HASH_DURATION_MS=$((HASH_END - HASH_START))
echo "[probe] Hash took ${HASH_DURATION_MS}ms, result: sha256:${CONTENT_HASH}" >&2

# Clean up
docker rm -f "$CONTAINER_NAME" > /dev/null
docker volume rm "$VOLUME_NAME" > /dev/null
echo "[probe] Cleaned up container and volume" >&2

# Output JSON result
cat <<EOF
{
  "image": "${IMAGE}",
  "imageDigest": "${DIGEST}",
  "worktreePath": "${WORKTREE}",
  "testbedBytes": ${BYTE_COUNT},
  "testbedFiles": ${FILE_COUNT},
  "cpDurationMs": ${CP_DURATION_MS},
  "hashDurationMs": ${HASH_DURATION_MS},
  "totalSeedDurationMs": $((CP_DURATION_MS + HASH_DURATION_MS)),
  "contentHash": "sha256:${CONTENT_HASH}",
  "probedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
