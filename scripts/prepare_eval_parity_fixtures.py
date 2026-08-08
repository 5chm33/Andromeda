#!/usr/bin/env python3
"""
prepare_eval_parity_fixtures.py — Build the evaluator-parity fixture JSONL.

Uses real patches from canary v6 (the resolved instances) as known-good
fixtures and a known-bad patch (exact-apply failure from canary v6) as the
negative control. Adds _patch_sha256 fields so the hash chain can be verified.

Usage:
    python3 scripts/prepare_eval_parity_fixtures.py [--output <path>]
"""
import json
import hashlib
import argparse
import sys
from pathlib import Path

REPO_DIR = Path(__file__).parent.parent

# Known-good instances from canary v6 evaluator report (resolved)
KNOWN_GOOD_IDS = [
    'astropy__astropy-12907',
    'astropy__astropy-13453',
    'astropy__astropy-13579',
]

# Known-bad instance from canary v6 (exact-apply failure, empty patch)
# We use a synthetic bad patch to test the negative control path.
KNOWN_BAD = {
    'instance_id': 'astropy__astropy-13033',
    'model_patch': '',  # empty — exact-apply failure
    'model_name_or_path': 'andromeda-eval-parity-fixture-bad',
    '_expected_outcome': 'empty_patch',
    '_fixture_note': 'Known exact-apply failure from canary v6; empty patch should produce no evaluator row',
}


def sha256(s: str) -> str:
    return hashlib.sha256(s.encode('utf-8')).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', default=str(REPO_DIR / 'data/swebench/eval_parity_fixtures.jsonl'))
    args = parser.parse_args()

    # Load canary v6 predictions
    v6_path = REPO_DIR / 'data/swebench/canary_v6_predictions.jsonl'
    if not v6_path.exists():
        print(f'ERROR: {v6_path} not found', file=sys.stderr)
        sys.exit(1)

    with open(v6_path) as f:
        v6_rows = {json.loads(l)['instance_id']: json.loads(l) for l in f if l.strip()}

    output_rows = []
    missing = []

    for iid in KNOWN_GOOD_IDS:
        if iid not in v6_rows:
            missing.append(iid)
            continue
        row = v6_rows[iid]
        patch = row['model_patch']
        if not patch:
            print(f'WARNING: {iid} has empty patch in canary v6 — skipping', file=sys.stderr)
            continue
        patch_hash = sha256(patch)
        output_rows.append({
            'instance_id': iid,
            'model_patch': patch,
            'model_name_or_path': 'andromeda-eval-parity-fixture-v5.24',
            '_patch_sha256': patch_hash,
            '_expected_outcome': 'resolved',
            '_source': 'canary_v6_predictions.jsonl',
            '_source_sha256': sha256(patch),  # same as _patch_sha256; explicit for audit
        })
        print(f'  [good] {iid}: {len(patch)} bytes, sha256={patch_hash}')

    if missing:
        print(f'WARNING: {len(missing)} known-good instances not found in canary v6: {missing}', file=sys.stderr)

    # Add the known-bad negative control (empty patch — should not appear in evaluator output)
    # We do NOT write it to the JSONL because the evaluator skips empty patches.
    # Instead we record it separately for documentation.
    print(f'  [bad]  {KNOWN_BAD["instance_id"]}: empty patch (not written to JSONL — evaluator skips empty patches)')

    # Write the fixture JSONL (known-good only)
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, 'w') as f:
        for row in output_rows:
            f.write(json.dumps(row) + '\n')

    # Write a manifest
    manifest = {
        'created_at': __import__('datetime').datetime.utcnow().isoformat() + 'Z',
        'source_file': str(v6_path),
        'source_file_sha256': sha256(v6_path.read_text()),
        'known_good_instances': KNOWN_GOOD_IDS,
        'known_bad_instance': KNOWN_BAD['instance_id'],
        'known_bad_note': KNOWN_BAD['_fixture_note'],
        'output_file': str(output_path),
        'output_rows': len(output_rows),
        'output_file_sha256': sha256(output_path.read_text()),
    }
    manifest_path = output_path.with_suffix('.manifest.json')
    with open(manifest_path, 'w') as f:
        json.dump(manifest, f, indent=2)
    print(f'\nFixture JSONL: {output_path} ({len(output_rows)} rows)')
    print(f'Manifest: {manifest_path}')
    print(f'Source SHA-256: {manifest["source_file_sha256"]}')
    print(f'Output SHA-256: {manifest["output_file_sha256"]}')


if __name__ == '__main__':
    main()
