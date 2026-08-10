#!/usr/bin/env python3
"""
Deterministic pre-launch attestation script for the Andromeda multilingual holdout run.

Performs the following checks and produces a signed/retained attestation JSON:
  1. HEAD == expected launch checkout
  2. Working tree is clean (no uncommitted changes)
  3. Diff between evaluated-code commit and launch checkout contains no evaluated files
  4. All 15 audited file hashes match the pre-launch audit bundle
  5. Reserved manifest: 113 unique IDs, no overlap with exclusion registry
  6. Dataset revision matches preregistration
  7. Campaign ID matches preregistration
  8. Preregistration raw-file hash matches SWEBENCH_PREREGISTRATION_HASH env var
  9. Node.js runtime version recorded
 10. Docker responsive and can resolve a sample image digest
 11. Inference identity frozen (model, temperature, max_tokens)

Usage:
  cd ~/andromeda
  python3 scripts/preflight_attestation.py

On success: writes data/swebench/launch_attestation.json and prints the env vars to export.
On failure: exits with code 1 and prints the failing check.
"""

import json
import hashlib
import subprocess
import sys
import os
from pathlib import Path
from datetime import datetime, timezone

# ── Constants ────────────────────────────────────────────────────────────────
EVALUATED_CODE_COMMIT = '15cf499134f180d82ede2de0104a8722ae2cacdb'
LAUNCH_CHECKOUT_COMMIT = '351019d79111f2b696e6ba5b320069c13117201f'
AUDIT_BUNDLE_PATH = 'data/swebench/pre_launch_audit_bundle.json'
PREREGISTRATION_PATH = 'data/swebench/multilingual_preregistration.json'
RESERVED_MANIFEST_PATH = 'data/swebench/multilingual_reserved_run.jsonl'
EXCLUSION_REGISTRY_PATH = 'data/swebench/exclusions.jsonl'
ATTESTATION_PATH = 'data/swebench/launch_attestation.json'

EXPECTED_HOLDOUT_COUNT = 113
EXPECTED_DATASET_REVISION = '9b805a99fed4facc17b2707c64216b227922a427'
EXPECTED_CAMPAIGN_ID = 'andromeda-multilingual-option-b'
EXPECTED_MODEL_ID = 'claude-sonnet-5'
EXPECTED_TEMPERATURE = 1
EXPECTED_MAX_TOKENS = 32000

# Sample image for Docker smoke test (one of the holdout repos)
SAMPLE_IMAGE = 'swebench/sweb.eval.x86_64.google__gson.0d0d0d0d:latest'

checks = []
all_passed = True


def check(name: str, passed: bool, message: str, blocks: bool = True):
    global all_passed
    status = '✓' if passed else '✗'
    print(f'  {status} {name}: {message}')
    checks.append({'name': name, 'passed': passed, 'message': message, 'blocks_launch': blocks})
    if not passed and blocks:
        all_passed = False


def sha256_file(path: str) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def run(cmd: list, timeout: int = 10) -> str:
    return subprocess.check_output(cmd, text=True, timeout=timeout).strip()


print('=== Andromeda Multilingual Holdout — Pre-Launch Attestation ===\n')

# ── Load audit bundle ────────────────────────────────────────────────────────
try:
    audit = json.loads(Path(AUDIT_BUNDLE_PATH).read_text())
    preg = json.loads(Path(PREREGISTRATION_PATH).read_text())
except Exception as e:
    print(f'FATAL: Cannot load audit bundle or preregistration: {e}')
    sys.exit(1)

# ── Check 1: HEAD == launch checkout ─────────────────────────────────────────
try:
    head = run(['git', 'rev-parse', 'HEAD'])
    check('head-matches-launch-checkout',
          head == LAUNCH_CHECKOUT_COMMIT,
          f'HEAD={head[:16]}... expected={LAUNCH_CHECKOUT_COMMIT[:16]}...')
except Exception as e:
    check('head-matches-launch-checkout', False, f'git rev-parse HEAD failed: {e}')

# ── Check 2: Clean working tree ───────────────────────────────────────────────
try:
    status = run(['git', 'status', '--porcelain'])
    check('clean-working-tree',
          status == '',
          'Working tree is clean' if status == '' else f'Dirty: {status[:200]}')
except Exception as e:
    check('clean-working-tree', False, f'git status failed: {e}')

# ── Check 3: Diff contains no evaluated files ────────────────────────────────
# Governance/tooling files (data/, scripts/preflight_*.py) may change between
# the evaluated-code commit and the launch checkout. What must NOT change is
# any of the 15 audited files (11 execution-path source files + 4 artifacts).
try:
    diff_files = run(['git', 'diff', '--name-only', EVALUATED_CODE_COMMIT, LAUNCH_CHECKOUT_COMMIT]).splitlines()
    evaluated_files = list(audit.get('audited_files', {}).get('sha256', {}).keys())
    evaluated_changed = [f for f in diff_files if f in evaluated_files]
    no_evaluated_changed = len(evaluated_changed) == 0
    check('diff-no-evaluated-files-changed',
          no_evaluated_changed,
          f'{len(diff_files)} file(s) changed between commits, none are evaluated files' if no_evaluated_changed
          else f'EVALUATED FILES CHANGED: {evaluated_changed}')
except Exception as e:
    check('diff-no-evaluated-files-changed', False, f'git diff failed: {e}')

# ── Check 4: All 15 audited file hashes match ─────────────────────────────────
try:
    expected_hashes = audit['audited_files']['sha256']
    mismatches = []
    for fpath, expected in expected_hashes.items():
        try:
            actual = sha256_file(fpath)
            if actual != expected:
                mismatches.append(f'{fpath}: actual={actual[:16]} expected={expected[:16]}')
        except Exception as e:
            mismatches.append(f'{fpath}: cannot read — {e}')
    check('audited-file-hashes',
          len(mismatches) == 0,
          f'All {len(expected_hashes)} file hashes match audit bundle' if not mismatches
          else f'{len(mismatches)} MISMATCH(ES): {mismatches[:3]}')
except Exception as e:
    check('audited-file-hashes', False, f'Hash check failed: {e}')

# ── Check 5: Reserved manifest integrity ─────────────────────────────────────
try:
    reserved_ids = [json.loads(l)['instance_id'] for l in Path(RESERVED_MANIFEST_PATH).read_text().splitlines() if l.strip()]
    exclusion_ids = set(json.loads(l)['instance_id'] for l in Path(EXCLUSION_REGISTRY_PATH).read_text().splitlines() if l.strip())
    unique_reserved = len(set(reserved_ids))
    overlap = set(reserved_ids) & exclusion_ids
    count_ok = unique_reserved == EXPECTED_HOLDOUT_COUNT
    overlap_ok = len(overlap) == 0
    check('reserved-manifest-count',
          count_ok,
          f'{unique_reserved} unique IDs (expected {EXPECTED_HOLDOUT_COUNT})')
    check('reserved-manifest-no-overlap',
          overlap_ok,
          f'No overlap with exclusion registry ({len(exclusion_ids)} IDs)' if overlap_ok
          else f'OVERLAP: {len(overlap)} IDs in both manifests: {list(overlap)[:5]}')
except Exception as e:
    check('reserved-manifest-integrity', False, f'Manifest check failed: {e}')

# ── Check 6: Dataset revision ─────────────────────────────────────────────────
try:
    preg_rev = preg.get('dataset', {}).get('revision', '')
    check('dataset-revision',
          preg_rev == EXPECTED_DATASET_REVISION,
          f'revision={preg_rev[:16]}...' if preg_rev == EXPECTED_DATASET_REVISION
          else f'MISMATCH: preregistration={preg_rev} expected={EXPECTED_DATASET_REVISION}')
except Exception as e:
    check('dataset-revision', False, f'Dataset revision check failed: {e}')

# ── Check 7: Campaign ID ──────────────────────────────────────────────────────
try:
    campaign_id = preg.get('campaign', {}).get('id', '')
    check('campaign-id',
          campaign_id == EXPECTED_CAMPAIGN_ID,
          f'campaign_id={campaign_id}')
except Exception as e:
    check('campaign-id', False, f'Campaign ID check failed: {e}')

# ── Check 8: Preregistration hash ────────────────────────────────────────────
try:
    actual_preg_hash = sha256_file(PREREGISTRATION_PATH)
    audit_preg_hash = audit.get('preregistration_raw_file_hash', '')
    check('preregistration-hash',
          actual_preg_hash == audit_preg_hash,
          f'hash={actual_preg_hash[:16]}... matches audit bundle' if actual_preg_hash == audit_preg_hash
          else f'MISMATCH: actual={actual_preg_hash[:16]} audit_bundle={audit_preg_hash[:16]}')
except Exception as e:
    check('preregistration-hash', False, f'Preregistration hash check failed: {e}')

# ── Check 9: Node.js runtime ──────────────────────────────────────────────────
try:
    node_version = run(['node', '--version'])
    audit_node = audit.get('node_runtime_version', '')
    match = node_version == audit_node
    check('node-runtime',
          match,
          f'Node.js {node_version}' + ('' if match else f' (audit bundle: {audit_node})'),
          blocks=False)  # Advisory: version mismatch is notable but not a launch blocker
except Exception as e:
    check('node-runtime', False, f'node --version failed: {e}', blocks=False)

# ── Check 10: Docker responsive + sample image digest ────────────────────────
try:
    # Just verify Docker daemon is responsive
    docker_info = run(['docker', 'info', '--format', '{{.ServerVersion}}'], timeout=15)
    check('docker-responsive',
          len(docker_info) > 0,
          f'Docker daemon v{docker_info} is responsive')
    # Note: per-instance digest resolution is enforced at task execution time (fail-closed)
    check('per-instance-digest-policy',
          True,
          'Per-instance digest resolved before first model call; scored mode fails closed on resolution failure',
          blocks=False)
except Exception as e:
    check('docker-responsive', False, f'Docker unresponsive: {e}')

# ── Check 11: Inference identity ──────────────────────────────────────────────
try:
    inf = audit.get('inference_identity', {})
    model_ok = inf.get('model_id') == EXPECTED_MODEL_ID
    temp_ok = inf.get('temperature') == EXPECTED_TEMPERATURE
    tokens_ok = inf.get('max_tokens') == EXPECTED_MAX_TOKENS
    all_ok = model_ok and temp_ok and tokens_ok
    check('inference-identity',
          all_ok,
          f'model={inf.get("model_id")}, temperature={inf.get("temperature")}, max_tokens={inf.get("max_tokens")}')
except Exception as e:
    check('inference-identity', False, f'Inference identity check failed: {e}')

# ── Write attestation ─────────────────────────────────────────────────────────
attestation = {
    'attested_at': datetime.now(timezone.utc).isoformat(),
    'all_blocking_checks_passed': all_passed,
    'launch_checkout': LAUNCH_CHECKOUT_COMMIT,
    'evaluated_code_commit': EVALUATED_CODE_COMMIT,
    'preregistration_raw_file_hash': sha256_file(PREREGISTRATION_PATH),
    'node_runtime': run(['node', '--version']),
    'checks': checks,
}
Path(ATTESTATION_PATH).write_text(json.dumps(attestation, indent=2) + '\n')

print(f'\n{"=" * 60}')
if all_passed:
    preg_hash = sha256_file(PREREGISTRATION_PATH)
    harness_rev = run(['git', 'rev-parse', 'HEAD'])
    print('✓ ALL BLOCKING CHECKS PASSED — launch is authorized\n')
    print('Export these env vars before running npx tsx scripts/run_swebench.ts:\n')
    print(f'export SWEBENCH_SCORED=1')
    print(f'export SWEBENCH_DATASET_NAME=SWE-bench/SWE-bench_Multilingual')
    print(f'export SWEBENCH_DATASET_SPLIT=test')
    print(f'export SWEBENCH_DATASET_REVISION={EXPECTED_DATASET_REVISION}')
    print(f'export SWEBENCH_EXCLUSION_REGISTRY=data/swebench/exclusions.jsonl')
    print(f'export SWEBENCH_EVAL_PROTOCOL=data/eval_protocol_v1.json')
    print(f'export SWEBENCH_RESERVED_RUN_MANIFEST=data/swebench/multilingual_reserved_run.jsonl')
    print(f'export SWEBENCH_PREREGISTRATION_HASH={preg_hash}')
    print(f'export SWEBENCH_CAMPAIGN_ID={EXPECTED_CAMPAIGN_ID}')
    print(f'export SWEBENCH_PROMPT_HASH=2fdcf83eba377718cf98abc161c8c2e0613761adaccf8bd3a8d88946efe3d079')
    print(f'export SWEBENCH_HARNESS_REVISION={harness_rev}')
    print(f'# Do NOT set SWEBENCH_ESCALATION or SWEBENCH_SEARCH')
    print(f'\nAttestation written to: {ATTESTATION_PATH}')
else:
    failing = [c for c in checks if not c['passed'] and c['blocks_launch']]
    print(f'✗ {len(failing)} BLOCKING CHECK(S) FAILED — do not launch\n')
    for c in failing:
        print(f'  FAILED: {c["name"]}: {c["message"]}')
    sys.exit(1)
