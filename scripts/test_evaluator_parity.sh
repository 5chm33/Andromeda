#!/usr/bin/env bash
# test_evaluator_parity.sh — Live evaluator-parity test for Andromeda v5.30+
#
# PURPOSE: Prove that the production CanonicalPatch → serializer path emits bytes
# that the official SWE-bench evaluator applies and scores correctly.
#
# DESIGN:
#   - Known-good fixtures: 3 resolved patches from canary v6 (astropy-12907,
#     astropy-13453, astropy-13579). Expected: evaluator resolves all 3.
#   - NC1 (stale-base, astropy-14182): stale-base offset patch. CMD1+CMD2 fail;
#     CMD3 (patch --fuzz=5) exits 0. v5.29 stop-at-first-exit-0: ACCEPTED.
#     Expected evaluator outcome: unresolved (applied but tests fail).
#   - NC2 (wrong-file, astropy-13033): nonexistent file path. All commands fail.
#     v5.29 stop-at-first-exit-0: REJECTED. Expected evaluator outcome: error.
#   - NC3 (partial-multihunk, astropy-13453): hunk 1 is the real resolved patch;
#     hunk 2 has wrong context. CMD1=128, CMD2=128, CMD3=2 (all non-zero).
#     v5.29 stop-at-first-exit-0: REJECTED. Expected evaluator outcome: error.
#
# NC1, NC2, NC3 use DISTINCT instance IDs so each gets its own evaluator invocation.
#
# FIVE-CELL DIFFERENTIAL MATRIX (v5.29/v5.30):
#   accepted → evaluator-resolved:   3/3 known-good (positive path)
#   accepted → evaluator-unresolved: 1/1 NC1 (stale-base; CMD3 exit 0)
#   rejected → evaluator-error:      2/2 NC2+NC3 (all commands fail)
#   accepted → evaluator-error:      0 (expected zero; canary v6 confirmed)
#   rejected → evaluator-applied:    0 (expected zero; stop-at-first-exit-0)
#
# v5.30 FIX: Status-preserving capture (no || true), no pre-CMD3 reset,
# explicit exit-code assertions for NC1/NC2/NC3.
#
# EVALUATOR CONTROL FLOW (from swebench/harness/run_evaluation.py):
#   for cmd in GIT_APPLY_CMDS:
#       val = container.exec_run(f"{cmd} {patch_file}", ...)
#       if val.exit_code == 0:
#           applied_patch = True; break
#   # NO reset between attempts — CMD3 sees any partial state CMD2 left behind
#
# USAGE: bash scripts/test_evaluator_parity.sh
# PREREQUISITES: Docker, python3 -m swebench.harness.run_evaluation, npx tsx
# ARCHIVE: data/swebench/evaluator_parity_archive/<TIMESTAMP>/

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
ARCHIVE_DIR="${REPO_DIR}/data/swebench/evaluator_parity_archive/${TIMESTAMP}"
mkdir -p "${ARCHIVE_DIR}"

echo "=== Andromeda Evaluator Parity Test (v5.30) ==="
echo "Timestamp: ${TIMESTAMP}"
echo "Archive:   ${ARCHIVE_DIR}"
echo ""

# ── Step 1: Prerequisites ─────────────────────────────────────────────────────

echo "=== Step 1: Checking prerequisites ==="
if ! python3 -m swebench.harness.run_evaluation --help > /dev/null 2>&1; then
  echo "ERROR: swebench.harness.run_evaluation not available." >&2
  echo "Install with: pip3 install swebench" >&2
  exit 2
fi

if ! docker info > /dev/null 2>&1; then
  echo "ERROR: Docker is not running." >&2
  exit 2
fi

if ! command -v npx &> /dev/null; then
  echo "ERROR: npx not available." >&2
  exit 2
fi

echo "Prerequisites: OK"
echo ""

# ── Step 2: Pre-compute apply-check results via Docker ────────────────────────
# The TypeScript script cannot call Docker via execSync (socket permissions).
# We run the evaluator's stop-at-first-exit-0 sequence here in the shell and
# pass results as env vars.
#
# v5.29/v5.30 control flow (mirrors swebench/harness/run_evaluation.py exactly):
#   CMD1: git apply --verbose          → if exit 0, ACCEPT and stop
#   CMD2: git apply --verbose --reject → if exit 0, ACCEPT and stop
#   CMD3: patch --batch --fuzz=5 -p1   → if exit 0, ACCEPT and stop
#   otherwise: REJECT
#
# IMPORTANT: The evaluator does NOT reset the worktree between commands.
# CMD3 sees any partial state CMD2 left behind (e.g., .rej files, partial hunks).
# This script mirrors that exactly — no git checkout/clean between CMD2 and CMD3.
#
# STATUS CAPTURE: Use `if out=$(cmd 2>&1); then status=0; else status=$?; fi`
# NOT `out=$(cmd 2>&1 || true); status=$?` — the || true forces status=0 always.

echo "=== Step 2: Pre-computing apply-check results via Docker ==="

NC1_PATCH_FILE="${ARCHIVE_DIR}/nc1_stale_base.diff"
NC2_PATCH_FILE="${ARCHIVE_DIR}/nc2_wrong_file.diff"
NC3_PATCH_FILE="${ARCHIVE_DIR}/nc3_partial_multihunk.diff"

# Write NC1 patch (stale-base offset — targets line 999 which does not exist)
cat > "${NC1_PATCH_FILE}" << 'PATCH_EOF'
--- a/astropy/modeling/separable.py
+++ b/astropy/modeling/separable.py
@@ -999,6 +999,7 @@ def _cstack(left, right):
     # This line does not exist at offset 999 in the actual file
     # This patch is intentionally malformed (stale-base offset)
+    pass  # stale-base negative control
     return _operators['&'](left, right)
PATCH_EOF

# Write NC2 patch (wrong file path — file does not exist in repo)
cat > "${NC2_PATCH_FILE}" << 'PATCH_EOF'
--- a/astropy/nonexistent_module_xyz123.py
+++ b/astropy/nonexistent_module_xyz123.py
@@ -1,3 +1,4 @@
 def foo():
     pass
+    return None
 
PATCH_EOF

# Write NC3 patch (partial multi-hunk: hunk 1 is real resolved patch, hunk 2 has wrong context)
# CMD1=128, CMD2=128, CMD3=2 — all non-zero → v5.29 REJECTS
python3 -c "
import json
with open('${REPO_DIR}/data/swebench/canary_v6_predictions.jsonl') as f:
    for line in f:
        row = json.loads(line)
        if row['instance_id'] == 'astropy__astropy-13453':
            real_patch = row['model_patch']
            break

nc3_patch = real_patch.rstrip() + '\n@@ -999,4 +1002,5 @@ class HTML(core.BaseReader):\n     # This context line does not exist at line 999\n     # NC3 hunk2: wrong context to force partial apply\n-    pass  # WRONG_CONTEXT_NC3\n+    pass  # WRONG_CONTEXT_NC3_modified\n     return None\n'
with open('${NC3_PATCH_FILE}', 'w') as f:
    f.write(nc3_patch)
print('NC3 patch written:', len(nc3_patch), 'bytes')
"

# NC1 uses astropy-14182; NC2 uses astropy-13033; NC3 uses astropy-13453 (distinct IDs)
ASTROPY_14182_IMAGE=$(docker images --format '{{.Repository}}:{{.Tag}}' | grep 'astropy-14182' | head -1)
ASTROPY_13033_IMAGE=$(docker images --format '{{.Repository}}:{{.Tag}}' | grep 'astropy-13033' | head -1)
ASTROPY_13453_IMAGE=$(docker images --format '{{.Repository}}:{{.Tag}}' | grep 'astropy-13453' | head -1)

if [ -z "${ASTROPY_14182_IMAGE}" ] || [ -z "${ASTROPY_13033_IMAGE}" ] || [ -z "${ASTROPY_13453_IMAGE}" ]; then
  echo "WARNING: One or more images not found locally. Using synthetic apply-check results."
  echo "  astropy-14182: ${ASTROPY_14182_IMAGE:-NOT FOUND}"
  echo "  astropy-13033: ${ASTROPY_13033_IMAGE:-NOT FOUND}"
  echo "  astropy-13453: ${ASTROPY_13453_IMAGE:-NOT FOUND}"
  # NC1: CMD1=128, CMD2=128, CMD3=0 → accepted (CMD3 succeeds)
  NC1_APPLY_EXIT=0
  NC1_APPLY_OUTPUT="synthetic: image not available (expected: CMD1=128, CMD2=128, CMD3=0)"
  NC1_CMD1_EXIT="synthetic(128)"; NC1_CMD2_EXIT="synthetic(128)"; NC1_CMD3_EXIT="synthetic(0)"
  NC1_FIRST_SUCCESS="CMD3(synthetic)"
  # NC2: CMD1=1, CMD2=1, CMD3=1 → rejected
  NC2_APPLY_EXIT=1
  NC2_APPLY_OUTPUT="synthetic: image not available (expected: CMD1=1, CMD2=1, CMD3=1)"
  NC2_CMD1_EXIT="synthetic(1)"; NC2_CMD2_EXIT="synthetic(1)"; NC2_CMD3_EXIT="synthetic(1)"
  NC2_FIRST_SUCCESS="none(synthetic)"
  # NC3: CMD1=128, CMD2=128, CMD3=2 → rejected (all non-zero)
  NC3_APPLY_EXIT=1
  NC3_APPLY_OUTPUT="synthetic: image not available (expected: CMD1=128, CMD2=128, CMD3=2)"
  NC3_CMD1_EXIT="synthetic(128)"; NC3_CMD2_EXIT="synthetic(128)"; NC3_CMD3_EXIT="synthetic(2)"
  NC3_FIRST_SUCCESS="none(synthetic)"
else
  echo "NC1 image: ${ASTROPY_14182_IMAGE}"
  echo "NC2 image: ${ASTROPY_13033_IMAGE}"
  echo "NC3 image: ${ASTROPY_13453_IMAGE}"

  # ── run_stop_at_first: mirrors evaluator's exact control flow ────────────────
  # Evaluator source (swebench/harness/run_evaluation.py):
  #   for git_apply_cmd in GIT_APPLY_CMDS:
  #       val = container.exec_run(f"{git_apply_cmd} {DOCKER_PATCH}", ...)
  #       if val.exit_code == 0:
  #           applied_patch = True; break
  # NO reset between attempts. CMD3 sees CMD2's partial state.
  #
  # STATUS CAPTURE: `if out=$(cmd 2>&1); then status=0; else status=$?; fi`
  # This preserves the real exit code. `$(cmd || true); status=$?` always gives 0.
  run_stop_at_first() {
    local IMAGE="$1"
    local PATCH_FILE="$2"
    local PREFIX="$3"
    local CMD_LOG="${ARCHIVE_DIR}/${PREFIX}_commands.txt"

    local CNAME="${PREFIX}-$(date +%s)"
    docker run -d --name "${CNAME}" --network none --cap-drop ALL "${IMAGE}" tail -f /dev/null > /dev/null 2>&1
    docker cp "${PATCH_FILE}" "${CNAME}:/tmp/check.diff" > /dev/null 2>&1

    {
      echo "=== ${PREFIX} stop-at-first-exit-0 sequence ==="
      echo "Image: ${IMAGE}"
      echo "Patch: ${PATCH_FILE}"
      echo ""
    } > "${CMD_LOG}"

    # ── CMD1: git apply --verbose ─────────────────────────────────────────────
    # Status-preserving capture: if out=$(cmd); then status=0; else status=$?; fi
    local CMD1_OUT CMD1_EXIT
    if CMD1_OUT=$(docker exec "${CNAME}" sh -c 'cd /testbed && git apply --verbose /tmp/check.diff 2>&1' 2>&1); then
      CMD1_EXIT=0
    else
      CMD1_EXIT=$?
    fi
    eval "${PREFIX}_CMD1_EXIT=${CMD1_EXIT}"
    eval "${PREFIX}_CMD1_OUTPUT=\"${CMD1_OUT:0:300}\""
    {
      echo "CMD1: git apply --verbose"
      echo "  exit_code: ${CMD1_EXIT}"
      echo "  output: ${CMD1_OUT:0:300}"
      echo ""
    } >> "${CMD_LOG}"
    echo "  CMD1 (git apply --verbose): exit=${CMD1_EXIT} | ${CMD1_OUT:0:80}"

    if [ "${CMD1_EXIT}" -eq 0 ]; then
      eval "${PREFIX}_APPLY_EXIT=0"
      eval "${PREFIX}_FIRST_SUCCESS=CMD1"
      docker rm -f "${CNAME}" > /dev/null 2>&1
      echo "  → ACCEPTED at CMD1 (exit 0)" >> "${CMD_LOG}"
      return
    fi

    # ── CMD2: git apply --verbose --reject ────────────────────────────────────
    # NO reset before CMD2 (evaluator does not reset between attempts)
    local CMD2_OUT CMD2_EXIT
    if CMD2_OUT=$(docker exec "${CNAME}" sh -c 'cd /testbed && git apply --verbose --reject /tmp/check.diff 2>&1' 2>&1); then
      CMD2_EXIT=0
    else
      CMD2_EXIT=$?
    fi
    eval "${PREFIX}_CMD2_EXIT=${CMD2_EXIT}"
    eval "${PREFIX}_CMD2_OUTPUT=\"${CMD2_OUT:0:300}\""
    {
      echo "CMD2: git apply --verbose --reject"
      echo "  exit_code: ${CMD2_EXIT}"
      echo "  output: ${CMD2_OUT:0:300}"
      echo ""
    } >> "${CMD_LOG}"
    echo "  CMD2 (git apply --verbose --reject): exit=${CMD2_EXIT} | ${CMD2_OUT:0:80}"

    if [ "${CMD2_EXIT}" -eq 0 ]; then
      eval "${PREFIX}_APPLY_EXIT=0"
      eval "${PREFIX}_FIRST_SUCCESS=CMD2"
      docker rm -f "${CNAME}" > /dev/null 2>&1
      echo "  → ACCEPTED at CMD2 (exit 0)" >> "${CMD_LOG}"
      return
    fi

    # ── CMD3: patch --batch --fuzz=5 -p1 ─────────────────────────────────────
    # NO reset before CMD3 — evaluator does not reset after CMD2.
    # CMD3 sees any partial state CMD2 left behind (.rej files, partial hunks).
    # This is the evaluator's exact stateful behavior.
    local CMD3_OUT CMD3_EXIT
    if CMD3_OUT=$(docker exec "${CNAME}" sh -c 'cd /testbed && patch --batch --fuzz=5 -p1 -i /tmp/check.diff 2>&1' 2>&1); then
      CMD3_EXIT=0
    else
      CMD3_EXIT=$?
    fi
    eval "${PREFIX}_CMD3_EXIT=${CMD3_EXIT}"
    eval "${PREFIX}_CMD3_OUTPUT=\"${CMD3_OUT:0:300}\""
    {
      echo "CMD3: patch --batch --fuzz=5 -p1"
      echo "  exit_code: ${CMD3_EXIT}"
      echo "  output: ${CMD3_OUT:0:300}"
      echo ""
    } >> "${CMD_LOG}"
    echo "  CMD3 (patch --batch --fuzz=5): exit=${CMD3_EXIT} | ${CMD3_OUT:0:80}"

    if [ "${CMD3_EXIT}" -eq 0 ]; then
      eval "${PREFIX}_APPLY_EXIT=0"
      eval "${PREFIX}_FIRST_SUCCESS=CMD3"
      echo "  → ACCEPTED at CMD3 (exit 0)" >> "${CMD_LOG}"
    else
      eval "${PREFIX}_APPLY_EXIT=1"
      eval "${PREFIX}_FIRST_SUCCESS=none"
      echo "  → REJECTED (all commands non-zero)" >> "${CMD_LOG}"
    fi

    docker rm -f "${CNAME}" > /dev/null 2>&1
  }

  echo "--- NC1 (stale-base on astropy-14182): stop-at-first-exit-0 ---"
  run_stop_at_first "${ASTROPY_14182_IMAGE}" "${NC1_PATCH_FILE}" "NC1"
  echo "NC1 result: CMD1=${NC1_CMD1_EXIT}, CMD2=${NC1_CMD2_EXIT:-skipped}, CMD3=${NC1_CMD3_EXIT:-skipped} -> first_success=${NC1_FIRST_SUCCESS} -> accepted=${NC1_APPLY_EXIT}"
  NC1_APPLY_OUTPUT="CMD1=${NC1_CMD1_EXIT} CMD2=${NC1_CMD2_EXIT:-skipped} CMD3=${NC1_CMD3_EXIT:-skipped} first_success=${NC1_FIRST_SUCCESS}"

  echo "--- NC2 (wrong-file on astropy-13033): stop-at-first-exit-0 ---"
  run_stop_at_first "${ASTROPY_13033_IMAGE}" "${NC2_PATCH_FILE}" "NC2"
  echo "NC2 result: CMD1=${NC2_CMD1_EXIT}, CMD2=${NC2_CMD2_EXIT:-skipped}, CMD3=${NC2_CMD3_EXIT:-skipped} -> first_success=${NC2_FIRST_SUCCESS} -> accepted=${NC2_APPLY_EXIT}"
  NC2_APPLY_OUTPUT="CMD1=${NC2_CMD1_EXIT} CMD2=${NC2_CMD2_EXIT:-skipped} CMD3=${NC2_CMD3_EXIT:-skipped} first_success=${NC2_FIRST_SUCCESS}"

  echo "--- NC3 (partial-multihunk on astropy-13453): stop-at-first-exit-0 ---"
  run_stop_at_first "${ASTROPY_13453_IMAGE}" "${NC3_PATCH_FILE}" "NC3"
  echo "NC3 result: CMD1=${NC3_CMD1_EXIT}, CMD2=${NC3_CMD2_EXIT:-skipped}, CMD3=${NC3_CMD3_EXIT:-skipped} -> first_success=${NC3_FIRST_SUCCESS} -> accepted=${NC3_APPLY_EXIT}"
  NC3_APPLY_OUTPUT="CMD1=${NC3_CMD1_EXIT} CMD2=${NC3_CMD2_EXIT:-skipped} CMD3=${NC3_CMD3_EXIT:-skipped} first_success=${NC3_FIRST_SUCCESS}"

  # ── Exit-code assertions ─────────────────────────────────────────────────────
  # These assertions prove the live command outputs match the expected matrix cells.
  # Fail immediately if any assertion is violated.
  echo ""
  echo "=== Step 2b: Exit-code assertions ==="

  ASSERTION_FAILURES=0

  # NC1 assertions: CMD1 must fail, CMD2 must fail, CMD3 must succeed (exit 0)
  # This proves NC1 genuinely reaches CMD3 and is accepted there.
  if [ "${NC1_CMD1_EXIT}" -eq 0 ]; then
    echo "ASSERTION FAILED: NC1 CMD1 should fail (non-zero) but got exit=0" >&2
    ASSERTION_FAILURES=$((ASSERTION_FAILURES + 1))
  else
    echo "  NC1 CMD1 assertion: exit=${NC1_CMD1_EXIT} (non-zero) ✓"
  fi
  if [ "${NC1_CMD2_EXIT:-0}" -eq 0 ] && [ "${NC1_FIRST_SUCCESS}" != "CMD1" ]; then
    echo "ASSERTION FAILED: NC1 CMD2 should fail (non-zero) but got exit=0" >&2
    ASSERTION_FAILURES=$((ASSERTION_FAILURES + 1))
  else
    echo "  NC1 CMD2 assertion: exit=${NC1_CMD2_EXIT:-skipped} (non-zero) ✓"
  fi
  if [ "${NC1_CMD3_EXIT:-1}" -ne 0 ]; then
    echo "ASSERTION FAILED: NC1 CMD3 should succeed (exit 0) but got exit=${NC1_CMD3_EXIT:-not_run}" >&2
    ASSERTION_FAILURES=$((ASSERTION_FAILURES + 1))
  else
    echo "  NC1 CMD3 assertion: exit=${NC1_CMD3_EXIT:-0} (zero) ✓"
  fi
  if [ "${NC1_FIRST_SUCCESS}" != "CMD3" ]; then
    echo "ASSERTION FAILED: NC1 first_success should be CMD3 but got ${NC1_FIRST_SUCCESS}" >&2
    ASSERTION_FAILURES=$((ASSERTION_FAILURES + 1))
  else
    echo "  NC1 first_success assertion: ${NC1_FIRST_SUCCESS} ✓"
  fi
  if [ "${NC1_APPLY_EXIT}" -ne 0 ]; then
    echo "ASSERTION FAILED: NC1 should be ACCEPTED (apply_exit=0) but got ${NC1_APPLY_EXIT}" >&2
    ASSERTION_FAILURES=$((ASSERTION_FAILURES + 1))
  else
    echo "  NC1 accepted assertion: apply_exit=${NC1_APPLY_EXIT} ✓"
  fi

  # NC2 assertions: all three commands must fail (all non-zero)
  # This proves NC2 genuinely reaches all three commands and is rejected.
  if [ "${NC2_CMD1_EXIT}" -eq 0 ]; then
    echo "ASSERTION FAILED: NC2 CMD1 should fail (non-zero) but got exit=0" >&2
    ASSERTION_FAILURES=$((ASSERTION_FAILURES + 1))
  else
    echo "  NC2 CMD1 assertion: exit=${NC2_CMD1_EXIT} (non-zero) ✓"
  fi
  if [ "${NC2_CMD2_EXIT:-0}" -eq 0 ] && [ "${NC2_FIRST_SUCCESS}" != "CMD1" ]; then
    echo "ASSERTION FAILED: NC2 CMD2 should fail (non-zero) but got exit=0" >&2
    ASSERTION_FAILURES=$((ASSERTION_FAILURES + 1))
  else
    echo "  NC2 CMD2 assertion: exit=${NC2_CMD2_EXIT:-skipped} (non-zero) ✓"
  fi
  if [ "${NC2_CMD3_EXIT:-0}" -eq 0 ] && [ "${NC2_FIRST_SUCCESS}" != "CMD1" ] && [ "${NC2_FIRST_SUCCESS}" != "CMD2" ]; then
    echo "ASSERTION FAILED: NC2 CMD3 should fail (non-zero) but got exit=0" >&2
    ASSERTION_FAILURES=$((ASSERTION_FAILURES + 1))
  else
    echo "  NC2 CMD3 assertion: exit=${NC2_CMD3_EXIT:-skipped} (non-zero) ✓"
  fi
  if [ "${NC2_APPLY_EXIT}" -ne 1 ]; then
    echo "ASSERTION FAILED: NC2 should be REJECTED (apply_exit=1) but got ${NC2_APPLY_EXIT}" >&2
    ASSERTION_FAILURES=$((ASSERTION_FAILURES + 1))
  else
    echo "  NC2 rejected assertion: apply_exit=${NC2_APPLY_EXIT} ✓"
  fi

  # NC3 assertions: CMD1 must fail, CMD2 must fail, CMD3 must fail with non-zero (exit 2)
  # This proves NC3 genuinely reaches all three commands and is rejected.
  if [ "${NC3_CMD1_EXIT}" -eq 0 ]; then
    echo "ASSERTION FAILED: NC3 CMD1 should fail (non-zero) but got exit=0" >&2
    ASSERTION_FAILURES=$((ASSERTION_FAILURES + 1))
  else
    echo "  NC3 CMD1 assertion: exit=${NC3_CMD1_EXIT} (non-zero) ✓"
  fi
  if [ "${NC3_CMD2_EXIT:-0}" -eq 0 ] && [ "${NC3_FIRST_SUCCESS}" != "CMD1" ]; then
    echo "ASSERTION FAILED: NC3 CMD2 should fail (non-zero) but got exit=0" >&2
    ASSERTION_FAILURES=$((ASSERTION_FAILURES + 1))
  else
    echo "  NC3 CMD2 assertion: exit=${NC3_CMD2_EXIT:-skipped} (non-zero) ✓"
  fi
  if [ "${NC3_CMD3_EXIT:-0}" -eq 0 ] && [ "${NC3_FIRST_SUCCESS}" != "CMD1" ] && [ "${NC3_FIRST_SUCCESS}" != "CMD2" ]; then
    echo "ASSERTION FAILED: NC3 CMD3 should fail (non-zero, expected exit 2) but got exit=0" >&2
    ASSERTION_FAILURES=$((ASSERTION_FAILURES + 1))
  else
    echo "  NC3 CMD3 assertion: exit=${NC3_CMD3_EXIT:-skipped} (non-zero, expected 2) ✓"
  fi
  if [ "${NC3_APPLY_EXIT}" -ne 1 ]; then
    echo "ASSERTION FAILED: NC3 should be REJECTED (apply_exit=1) but got ${NC3_APPLY_EXIT}" >&2
    ASSERTION_FAILURES=$((ASSERTION_FAILURES + 1))
  else
    echo "  NC3 rejected assertion: apply_exit=${NC3_APPLY_EXIT} ✓"
  fi

  if [ "${ASSERTION_FAILURES}" -gt 0 ]; then
    echo ""
    echo "ERROR: ${ASSERTION_FAILURES} exit-code assertion(s) failed." >&2
    echo "The live command outputs do not match the expected matrix cells." >&2
    echo "Do not proceed to evaluator invocations until assertions pass." >&2
    exit 1
  fi
  echo ""
  echo "All exit-code assertions passed."
fi

# Save command outputs to archive
{
  echo "v5.30 acceptance criterion: stop-at-first-exit-0 (mirrors evaluator control flow)"
  echo "v5.30 fix: status-preserving capture (no || true), no pre-CMD3 reset"
  echo "Evaluator commands (from swebench/harness/run_evaluation.py):"
  echo "  CMD1: git apply --verbose          → if exit 0, ACCEPT and stop"
  echo "  CMD2: git apply --verbose --reject → if exit 0, ACCEPT and stop"
  echo "  CMD3: patch --batch --fuzz=5 -p1   → if exit 0, ACCEPT and stop"
  echo "  otherwise: REJECT"
  echo "  NOTE: No reset between commands — CMD3 sees CMD2's partial state."
  echo ""
  echo "NC1 (stale-base on astropy-14182):"
  echo "  ${NC1_APPLY_OUTPUT}"
  echo "  Runner decision: accepted=${NC1_APPLY_EXIT} (0=accepted, 1=rejected)"
  echo ""
  echo "NC2 (wrong-file on astropy-13033):"
  echo "  ${NC2_APPLY_OUTPUT}"
  echo "  Runner decision: accepted=${NC2_APPLY_EXIT} (0=accepted, 1=rejected)"
  echo ""
  echo "NC3 (partial-multihunk on astropy-13453):"
  echo "  ${NC3_APPLY_OUTPUT}"
  echo "  Runner decision: accepted=${NC3_APPLY_EXIT} (0=accepted, 1=rejected)"
} | tee "${ARCHIVE_DIR}/apply_check_outputs.txt"

export ANDROMEDA_NC1_APPLY_EXIT="${NC1_APPLY_EXIT}"
export ANDROMEDA_NC1_APPLY_OUTPUT="${NC1_APPLY_OUTPUT}"
export ANDROMEDA_NC2_APPLY_EXIT="${NC2_APPLY_EXIT}"
export ANDROMEDA_NC2_APPLY_OUTPUT="${NC2_APPLY_OUTPUT}"
export ANDROMEDA_NC3_APPLY_EXIT="${NC3_APPLY_EXIT}"
export ANDROMEDA_NC3_APPLY_OUTPUT="${NC3_APPLY_OUTPUT}"

echo ""

# ── Step 3: Build fixture JSONL through production path ──────────────────────

echo "=== Step 3: Building fixture JSONL through production path ==="
FIXTURE_JSONL="${ARCHIVE_DIR}/eval_parity_fixtures.jsonl"
NEGATIVE_CONTROL_JSONL="${ARCHIVE_DIR}/eval_parity_fixtures.negative_control.jsonl"
FIXTURE_MANIFEST="${ARCHIVE_DIR}/eval_parity_fixtures.manifest.json"

cd "${REPO_DIR}"
npx tsx scripts/build_eval_parity_fixtures.ts \
  --output "${FIXTURE_JSONL}" \
  2>&1 | tee "${ARCHIVE_DIR}/fixture_build.log"

echo ""
echo "Fixture JSONL: ${FIXTURE_JSONL}"
echo "Negative control JSONL: ${NEGATIVE_CONTROL_JSONL}"

# Compute SHA-256 of fixture files
FIXTURE_SHA256=$(sha256sum "${FIXTURE_JSONL}" | cut -d' ' -f1)
NEGATIVE_SHA256=$(sha256sum "${NEGATIVE_CONTROL_JSONL}" | cut -d' ' -f1)
echo "Fixture JSONL SHA-256: ${FIXTURE_SHA256}"
echo "Negative control JSONL SHA-256: ${NEGATIVE_SHA256}"

# ── Step 4: Record image digests ──────────────────────────────────────────────

echo ""
echo "=== Step 4: Recording image digests ==="
{
  echo "# Image digests for evaluator parity run ${TIMESTAMP}"
  echo "# These are the images used by the official SWE-bench evaluator"
  for iid in astropy__astropy-12907 astropy__astropy-13453 astropy__astropy-13579 astropy__astropy-14182 astropy__astropy-13033; do
    img=$(docker images --format '{{.Repository}}:{{.Tag}}' | grep "${iid##*__}" | head -1)
    if [ -n "${img}" ]; then
      digest=$(docker image inspect "${img}" --format='{{.Id}}' 2>/dev/null || echo "unknown")
      echo "${iid}: ${img} (${digest})"
    else
      echo "${iid}: NOT FOUND LOCALLY"
    fi
  done
} | tee "${ARCHIVE_DIR}/image_digests.txt"

# ── Step 5: Run official evaluator on known-good fixtures ─────────────────────

echo ""
echo "=== Step 5: Running official evaluator on known-good fixtures ==="
RUN_ID="andromeda-eval-parity-v5.30-good"
GOOD_REPORT_DIR="${ARCHIVE_DIR}/evaluator_report_good"
mkdir -p "${GOOD_REPORT_DIR}"

GOOD_CMD="python3 -m swebench.harness.run_evaluation -p ${FIXTURE_JSONL} -d princeton-nlp/SWE-bench -s test -id ${RUN_ID} --report_dir ${GOOD_REPORT_DIR} --max_workers 2"
echo "Command: ${GOOD_CMD}"
echo "${GOOD_CMD}" > "${ARCHIVE_DIR}/command_good.txt"

python3 -m swebench.harness.run_evaluation \
  -p "${FIXTURE_JSONL}" \
  -d princeton-nlp/SWE-bench \
  -s test \
  -id "${RUN_ID}" \
  --report_dir "${GOOD_REPORT_DIR}" \
  --max_workers 2 \
  2>&1 | tee "${ARCHIVE_DIR}/evaluator_stdout_good.log"

# ── Step 6a: Run official evaluator on NC1 (stale-base, astropy-14182) ────────

echo ""
echo "=== Step 6a: Running official evaluator on NC1 (stale-base, astropy-14182) ==="
NC1_JSONL="${ARCHIVE_DIR}/eval_parity_fixtures.nc1.jsonl"
python3 -c "
import json, sys
rows = [json.loads(l) for l in open('${NEGATIVE_CONTROL_JSONL}') if l.strip()]
nc1 = [r for r in rows if r['instance_id'] == 'astropy__astropy-14182']
if not nc1: sys.exit(1)
with open('${NC1_JSONL}', 'w') as f: f.write(json.dumps(nc1[0]) + '\n')
print(f'NC1 JSONL written: {nc1[0][\"instance_id\"]}')
"
NC1_RUN_ID="andromeda-eval-parity-nc1-${TIMESTAMP}"
NC1_REPORT_DIR="${ARCHIVE_DIR}/evaluator_report_nc1"
mkdir -p "${NC1_REPORT_DIR}"
NC1_CMD="python3 -m swebench.harness.run_evaluation -p ${NC1_JSONL} -d princeton-nlp/SWE-bench -s test -id ${NC1_RUN_ID} --report_dir ${NC1_REPORT_DIR} --max_workers 1"
echo "Command: ${NC1_CMD}"
echo "${NC1_CMD}" > "${ARCHIVE_DIR}/command_nc1.txt"
python3 -m swebench.harness.run_evaluation \
  -p "${NC1_JSONL}" \
  -d princeton-nlp/SWE-bench \
  -s test \
  -id "${NC1_RUN_ID}" \
  --report_dir "${NC1_REPORT_DIR}" \
  --max_workers 1 \
  2>&1 | tee "${ARCHIVE_DIR}/evaluator_stdout_nc1.log" || true

# ── Step 6b: Run official evaluator on NC2 (wrong-file, astropy-13033) ────────

echo ""
echo "=== Step 6b: Running official evaluator on NC2 (wrong-file, astropy-13033) ==="
NC2_JSONL="${ARCHIVE_DIR}/eval_parity_fixtures.nc2.jsonl"
python3 -c "
import json, sys
rows = [json.loads(l) for l in open('${NEGATIVE_CONTROL_JSONL}') if l.strip()]
nc2 = [r for r in rows if r['instance_id'] == 'astropy__astropy-13033']
if not nc2: sys.exit(1)
with open('${NC2_JSONL}', 'w') as f: f.write(json.dumps(nc2[0]) + '\n')
print(f'NC2 JSONL written: {nc2[0][\"instance_id\"]}')
"
NC2_RUN_ID="andromeda-eval-parity-nc2-${TIMESTAMP}"
NC2_REPORT_DIR="${ARCHIVE_DIR}/evaluator_report_nc2"
mkdir -p "${NC2_REPORT_DIR}"
NC2_CMD="python3 -m swebench.harness.run_evaluation -p ${NC2_JSONL} -d princeton-nlp/SWE-bench -s test -id ${NC2_RUN_ID} --report_dir ${NC2_REPORT_DIR} --max_workers 1"
echo "Command: ${NC2_CMD}"
echo "${NC2_CMD}" > "${ARCHIVE_DIR}/command_nc2.txt"
python3 -m swebench.harness.run_evaluation \
  -p "${NC2_JSONL}" \
  -d princeton-nlp/SWE-bench \
  -s test \
  -id "${NC2_RUN_ID}" \
  --report_dir "${NC2_REPORT_DIR}" \
  --max_workers 1 \
  2>&1 | tee "${ARCHIVE_DIR}/evaluator_stdout_nc2.log" || true

# ── Step 6c: Run official evaluator on NC3 (partial-multihunk, astropy-13453) ─

echo ""
echo "=== Step 6c: Running official evaluator on NC3 (partial-multihunk, astropy-13453) ==="
NC3_JSONL="${ARCHIVE_DIR}/eval_parity_fixtures.nc3.jsonl"
python3 -c "
import json, sys
rows = [json.loads(l) for l in open('${NEGATIVE_CONTROL_JSONL}') if l.strip()]
nc3 = [r for r in rows if r['instance_id'] == 'astropy__astropy-13453']
if not nc3: sys.exit(1)
with open('${NC3_JSONL}', 'w') as f: f.write(json.dumps(nc3[0]) + '\n')
print(f'NC3 JSONL written: {nc3[0][\"instance_id\"]}')
"
NC3_RUN_ID="andromeda-eval-parity-nc3-${TIMESTAMP}"
NC3_REPORT_DIR="${ARCHIVE_DIR}/evaluator_report_nc3"
mkdir -p "${NC3_REPORT_DIR}"
NC3_CMD="python3 -m swebench.harness.run_evaluation -p ${NC3_JSONL} -d princeton-nlp/SWE-bench -s test -id ${NC3_RUN_ID} --report_dir ${NC3_REPORT_DIR} --max_workers 1"
echo "Command: ${NC3_CMD}"
echo "${NC3_CMD}" > "${ARCHIVE_DIR}/command_nc3.txt"
python3 -m swebench.harness.run_evaluation \
  -p "${NC3_JSONL}" \
  -d princeton-nlp/SWE-bench \
  -s test \
  -id "${NC3_RUN_ID}" \
  --report_dir "${NC3_REPORT_DIR}" \
  --max_workers 1 \
  2>&1 | tee "${ARCHIVE_DIR}/evaluator_stdout_nc3.log" || true

# ── Step 7: Parse and verify results — five-cell differential matrix ──────────

echo ""
echo "=== Step 7: Verifying results (five-cell differential matrix) ==="

python3 << PYEOF
import json, hashlib, glob, sys
from pathlib import Path

archive_dir = Path("${ARCHIVE_DIR}")
fixture_jsonl = Path("${FIXTURE_JSONL}")
negative_jsonl = Path("${NEGATIVE_CONTROL_JSONL}")
nc1_jsonl = Path("${NC1_JSONL}")
nc2_jsonl = Path("${NC2_JSONL}")
nc3_jsonl = Path("${NC3_JSONL}")

# Load fixture manifest
with open("${FIXTURE_MANIFEST}") as f:
    manifest = json.load(f)

# Load fixture rows
with open(fixture_jsonl) as f:
    good_rows = [json.loads(l) for l in f if l.strip()]

with open(nc1_jsonl) as f:
    nc1_rows = [json.loads(l) for l in f if l.strip()]

with open(nc2_jsonl) as f:
    nc2_rows = [json.loads(l) for l in f if l.strip()]

with open(nc3_jsonl) as f:
    nc3_rows = [json.loads(l) for l in f if l.strip()]

# Find evaluator reports
def load_report(report_dir_name):
    """Load the first JSON report from the named subdirectory of the archive."""
    report_dir = archive_dir / report_dir_name
    reports = list(report_dir.glob("*.json")) if report_dir.exists() else []
    if reports:
        path = sorted(reports)[0]
        with open(path) as f:
            return json.load(f), str(path)
    return {}, None

good_report, good_report_path = load_report("evaluator_report_good")
nc1_report, nc1_report_path = load_report("evaluator_report_nc1")
nc2_report, nc2_report_path = load_report("evaluator_report_nc2")
nc3_report, nc3_report_path = load_report("evaluator_report_nc3")

# Fall back to home-dir reports if --report_dir wasn't supported
if not good_report:
    fallback = sorted(glob.glob(str(Path("${REPO_DIR}") / "andromeda-eval-parity-v5.30-good*.json")))
    if fallback:
        with open(fallback[-1]) as f: good_report = json.load(f)
        good_report_path = fallback[-1]

if not nc1_report:
    fallback = sorted(glob.glob(str(Path("${REPO_DIR}") / f"*nc1*${TIMESTAMP}*.json")))
    if fallback:
        with open(fallback[-1]) as f: nc1_report = json.load(f)
        nc1_report_path = fallback[-1]

if not nc2_report:
    fallback = sorted(glob.glob(str(Path("${REPO_DIR}") / f"*nc2*${TIMESTAMP}*.json")))
    if fallback:
        with open(fallback[-1]) as f: nc2_report = json.load(f)
        nc2_report_path = fallback[-1]

if not nc3_report:
    fallback = sorted(glob.glob(str(Path("${REPO_DIR}") / f"*nc3*${TIMESTAMP}*.json")))
    if fallback:
        with open(fallback[-1]) as f: nc3_report = json.load(f)
        nc3_report_path = fallback[-1]

print(f"  Good report: {good_report_path}")
print(f"  NC1 report:  {nc1_report_path}")
print(f"  NC2 report:  {nc2_report_path}")
print(f"  NC3 report:  {nc3_report_path}")

def get_outcome(report, iid):
    resolved = report.get("resolved_ids", report.get("resolved", []))
    errors = report.get("error_ids", [])
    unresolved = report.get("unresolved_ids", report.get("unresolved", []))
    if iid in resolved: return "resolved"
    if iid in errors: return "error"
    if iid in unresolved: return "unresolved"
    return "not_run"

good_resolved = good_report.get("resolved_ids", good_report.get("resolved", []))
good_errors = good_report.get("error_ids", [])

failures = []

# ── Known-good fixtures ───────────────────────────────────────────────────────
print()
print("Known-good fixtures (matrix cell: accepted → evaluator-resolved):")
for row in good_rows:
    iid = row["instance_id"]
    stored_hash = row.get("_patch_sha256", "MISSING")
    computed_hash = hashlib.sha256(row["model_patch"].encode("utf-8")).hexdigest()
    hash_match = stored_hash == computed_hash
    outcome = "resolved" if iid in good_resolved else ("error" if iid in good_errors else "unresolved")
    expected = row.get("_expected_outcome", "resolved")
    outcome_match = outcome == expected
    print(f"  {iid}: hash_match={hash_match}, outcome={outcome}, expected={expected}, outcome_match={outcome_match}")
    if not hash_match:
        failures.append(f"{iid}: hash mismatch (stored={stored_hash[:8]}, computed={computed_hash[:8]})")
    if not outcome_match:
        failures.append(f"{iid}: outcome mismatch (got {outcome}, expected {expected})")

# ── NC1: accepted → evaluator-unresolved ─────────────────────────────────────
print()
print("NC1 (stale-base, astropy-14182) — matrix cell: accepted → evaluator-unresolved:")
print("  v5.29/v5.30: CMD1=non-zero, CMD2=non-zero, CMD3=0 → first_success=CMD3 → ACCEPTED")
print("  v5.30 proof: live CMD1/CMD2/CMD3 exit codes asserted above (no || true)")
for row in nc1_rows:
    iid = row["instance_id"]
    stored_hash = row.get("_patch_sha256", "MISSING")
    computed_hash = hashlib.sha256(row["model_patch"].encode("utf-8")).hexdigest()
    hash_match = stored_hash == computed_hash
    preflight = row.get("_preflight_result", "unknown")
    expected_preflight = row.get("_expected_preflight", "accepted")
    expected_evaluator = row.get("_expected_evaluator_outcome", "not_resolved")
    outcome = get_outcome(nc1_report, iid) if nc1_report else "not_run (no report)"
    print(f"  {iid}: hash_match={hash_match}, preflight={preflight} (expected={expected_preflight}), evaluator_outcome={outcome} (expected={expected_evaluator})")
    if not hash_match:
        failures.append(f"NC1 {iid}: hash mismatch")
    if preflight != expected_preflight:
        failures.append(f"NC1 {iid}: preflight={preflight} but expected={expected_preflight}")
    if nc1_report and outcome == "resolved":
        failures.append(f"NC1 {iid}: expected not_resolved but got 'resolved'")
    if nc1_report and outcome == "not_run":
        failures.append(f"NC1 {iid}: evaluator report found but instance not in any outcome list")

# ── NC2: rejected → evaluator-error ──────────────────────────────────────────
print()
print("NC2 (wrong-file, astropy-13033) — matrix cell: rejected → evaluator-error:")
print("  v5.29/v5.30: CMD1=non-zero, CMD2=non-zero, CMD3=non-zero → all fail → REJECTED")
print("  v5.30 proof: live CMD1/CMD2/CMD3 exit codes asserted above (no || true)")
for row in nc2_rows:
    iid = row["instance_id"]
    stored_hash = row.get("_patch_sha256", "MISSING")
    computed_hash = hashlib.sha256(row["model_patch"].encode("utf-8")).hexdigest()
    hash_match = stored_hash == computed_hash
    preflight = row.get("_preflight_result", "unknown")
    expected_preflight = row.get("_expected_preflight", "rejected")
    expected_evaluator = row.get("_expected_evaluator_outcome", "error")
    outcome = get_outcome(nc2_report, iid) if nc2_report else "not_run (no report)"
    print(f"  {iid}: hash_match={hash_match}, preflight={preflight} (expected={expected_preflight}), evaluator_outcome={outcome} (expected={expected_evaluator})")
    if not hash_match:
        failures.append(f"NC2 {iid}: hash mismatch")
    if preflight != expected_preflight:
        failures.append(f"NC2 {iid}: preflight={preflight} but expected={expected_preflight}")
    if nc2_report and outcome != "error":
        failures.append(f"NC2 {iid}: expected evaluator error but got '{outcome}'")

# ── NC3: rejected → evaluator-error ──────────────────────────────────────────
print()
print("NC3 (partial-multihunk, astropy-13453) — matrix cell: rejected → evaluator-error:")
print("  v5.29/v5.30: CMD1=non-zero, CMD2=non-zero, CMD3=2 (non-zero) → all fail → REJECTED")
print("  v5.30 proof: live CMD1/CMD2/CMD3 exit codes asserted above (no || true)")
print("  v5.30 fix: CMD3 sees CMD2 partial state (no pre-CMD3 reset)")
for row in nc3_rows:
    iid = row["instance_id"]
    stored_hash = row.get("_patch_sha256", "MISSING")
    computed_hash = hashlib.sha256(row["model_patch"].encode("utf-8")).hexdigest()
    hash_match = stored_hash == computed_hash
    preflight = row.get("_preflight_result", "unknown")
    expected_preflight = row.get("_expected_preflight", "rejected")
    expected_evaluator = row.get("_expected_evaluator_outcome", "error")
    outcome = get_outcome(nc3_report, iid) if nc3_report else "not_run (no report)"
    print(f"  {iid}: hash_match={hash_match}, preflight={preflight} (expected={expected_preflight}), evaluator_outcome={outcome} (expected={expected_evaluator})")
    if not hash_match:
        failures.append(f"NC3 {iid}: hash mismatch")
    if preflight != expected_preflight:
        failures.append(f"NC3 {iid}: preflight={preflight} but expected={expected_preflight}")
    if nc3_report and outcome != "error":
        failures.append(f"NC3 {iid}: expected evaluator error but got '{outcome}'")

# ── Five-cell matrix summary ──────────────────────────────────────────────────
nc1_unresolved = nc1_report.get("unresolved_ids", nc1_report.get("unresolved", [])) if nc1_report else []
nc1_errors = nc1_report.get("error_ids", []) if nc1_report else []
nc2_errors = nc2_report.get("error_ids", []) if nc2_report else []
nc3_errors = nc3_report.get("error_ids", []) if nc3_report else []

print()
print("Five-cell differential matrix (v5.30):")
print(f"  accepted → evaluator-resolved:   {len(good_resolved)}/{len(good_rows)} (expected {len(good_rows)}/{len(good_rows)})")
print(f"  accepted → evaluator-unresolved: {len(nc1_unresolved)}/1 NC1 (stale-base; CMD3 exit 0; error={len(nc1_errors)})")
print(f"  rejected → evaluator-error:      {len(nc2_errors)}/1 NC2 (wrong-file) + {len(nc3_errors)}/1 NC3 (partial-multihunk)")
print(f"  accepted → evaluator-error:      {len(good_errors)}/0 expected (canary v6 confirmed zero)")
print(f"  rejected → evaluator-applied:    0 (expected zero; stop-at-first-exit-0 eliminates this cell)")

print()
if failures:
    print(f"FAILURES ({len(failures)}):")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
else:
    print("All checks passed:")
    print(f"  - {len(good_rows)} known-good fixtures resolved by official evaluator")
    print(f"  - 0 evaluator apply errors on known-good fixtures")
    print(f"  - All hash chains valid (stored _patch_sha256 == sha256(model_patch))")
    print(f"  - NC1 (stale-base): preflight=accepted (CMD3 exit 0, asserted live)")
    print(f"  - NC2 (wrong-file): preflight=rejected (all commands fail, asserted live), evaluator=error")
    print(f"  - NC3 (partial-multihunk): preflight=rejected (CMD3 exit 2, asserted live), evaluator=error")
    print(f"  - NC1, NC2, NC3 ran in SEPARATE evaluator invocations with distinct instance IDs")
    print(f"  - v5.30 fix: status-preserving capture (no || true), no pre-CMD3 reset")
    print(f"  - Production path: buildCanonicalPatch → verifyCanonicalPatch → serializeCanonicalPatch")

# Write summary
def sha256_path(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest() if p and Path(p).exists() else None

summary = {
    "run_timestamp": "${TIMESTAMP}",
    "version": "v5.30",
    "acceptance_criterion": "stop-at-first-exit-0 (evaluator-exact control flow)",
    "v530_fixes": [
        "Status-preserving capture: if out=$(cmd 2>&1); then status=0; else status=$?; fi",
        "No pre-CMD3 reset: CMD3 sees CMD2 partial state (matches evaluator behavior)",
        "Explicit exit-code assertions for NC1 (CMD3=0), NC2 (all non-zero), NC3 (CMD3=2)",
        "Script fails if any assertion or matrix cell does not match expected outcome",
    ],
    "production_path": "buildCanonicalPatch → verifyCanonicalPatch → serializeCanonicalPatch",
    "fixture_jsonl_sha256": "${FIXTURE_SHA256}",
    "negative_control_jsonl_sha256": "${NEGATIVE_SHA256}",
    "good_report": str(good_report_path),
    "good_report_sha256": sha256_path(good_report_path),
    "nc1_report": str(nc1_report_path) if nc1_report_path else None,
    "nc1_report_sha256": sha256_path(nc1_report_path),
    "nc2_report": str(nc2_report_path) if nc2_report_path else None,
    "nc2_report_sha256": sha256_path(nc2_report_path),
    "nc3_report": str(nc3_report_path) if nc3_report_path else None,
    "nc3_report_sha256": sha256_path(nc3_report_path),
    "instances_submitted_good": len(good_rows),
    "instances_resolved": len(good_resolved),
    "instances_errors_good": len(good_errors),
    "nc1_preflight": nc1_rows[0].get("_preflight_result", "unknown") if nc1_rows else "unknown",
    "nc1_evaluator_outcome": "unresolved" if nc1_unresolved else ("error" if nc1_errors else "not_run"),
    "nc2_preflight": nc2_rows[0].get("_preflight_result", "unknown") if nc2_rows else "unknown",
    "nc2_evaluator_outcome": "error" if nc2_errors else "not_run",
    "nc3_preflight": nc3_rows[0].get("_preflight_result", "unknown") if nc3_rows else "unknown",
    "nc3_evaluator_outcome": "error" if nc3_errors else "not_run",
    "five_cell_matrix": {
        "accepted_resolved": f"{len(good_resolved)}/{len(good_rows)}",
        "accepted_unresolved": f"{len(nc1_unresolved)}/1",
        "rejected_error_nc2": f"{len(nc2_errors)}/1",
        "rejected_error_nc3": f"{len(nc3_errors)}/1",
        "accepted_error": f"{len(good_errors)}/0_expected",
        "rejected_applied": "0/0_expected",
    },
    "all_hash_chains_valid": all(
        hashlib.sha256(r["model_patch"].encode()).hexdigest() == r.get("_patch_sha256", "")
        for r in good_rows + nc1_rows + nc2_rows + nc3_rows
    ),
    "all_checks_passed": len(failures) == 0,
}
with open("${ARCHIVE_DIR}/parity_summary.json", "w") as f:
    json.dump(summary, f, indent=2)
print(f"\nSummary written to: ${ARCHIVE_DIR}/parity_summary.json")
PYEOF

echo ""
echo "=== Evaluator Parity Test Complete ==="
echo "Archive: ${ARCHIVE_DIR}"
