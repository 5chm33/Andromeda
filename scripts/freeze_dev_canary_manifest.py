#!/usr/bin/env python3
"""
freeze_dev_canary_manifest.py — Freeze the 5-task development canary manifest.

Asserts:
  - All 5 IDs are in the exclusion registry (dev set)
  - All 5 IDs are absent from the holdout manifest
  - All 5 IDs are present in the dev manifest
  - Binds to current commit and evaluated-file hashes
"""
import json, hashlib, subprocess, sys
from pathlib import Path
from datetime import datetime, timezone

CANARY_IDS = [
    'astral-sh__ruff-15309',
    'babel__babel-13928',
    'caddyserver__caddy-4774',
    'faker-ruby__faker-2705',
    'google__gson-1014',
]

REPO_LANG = {
    'astral-sh__ruff-15309': ('astral-sh/ruff', 'rust'),
    'babel__babel-13928': ('babel/babel', 'javascript'),
    'caddyserver__caddy-4774': ('caddyserver/caddy', 'go'),
    'faker-ruby__faker-2705': ('faker-ruby/faker', 'ruby'),
    'google__gson-1014': ('google/gson', 'java'),
}

def main():
    base = Path('/home/ubuntu/andromeda')

    exclusions = {json.loads(l)['instance_id']
                  for l in (base / 'data/swebench/exclusions.jsonl').read_text().splitlines() if l.strip()}
    holdout = {json.loads(l)['instance_id']
               for l in (base / 'data/swebench/multilingual_holdout_reserved.jsonl').read_text().splitlines() if l.strip()}
    dev = {json.loads(l)['instance_id']
           for l in (base / 'data/swebench/multilingual_dev.jsonl').read_text().splitlines() if l.strip()}

    errors = []
    for iid in CANARY_IDS:
        if iid not in exclusions:
            errors.append(f"FAIL: {iid} NOT in exclusion registry")
        if iid in holdout:
            errors.append(f"FAIL: {iid} IS in holdout manifest (contamination!)")
        if iid not in dev:
            errors.append(f"FAIL: {iid} NOT in dev manifest")

    if errors:
        for e in errors: print(e)
        return 1

    print(f"All 5 IDs: in exclusion registry, absent from holdout, present in dev set")

    commit = subprocess.run(['git', 'rev-parse', 'HEAD'], capture_output=True, text=True, cwd=base).stdout.strip()
    print(f"Commit: {commit}")

    canary_hash = hashlib.sha256(json.dumps(sorted(CANARY_IDS), separators=(',', ':')).encode()).hexdigest()
    print(f"Canary ID list hash: {canary_hash}")

    EVALUATED_FILES = [
        'server/benchmarkLauncher.ts',
        'server/sweBenchTracebackLoop.ts',
        'server/sweBenchPipeline.ts',
        'server/sweBenchContextBuilder.ts',
        'server/sweBenchConsensus.ts',
        'server/sweBenchEvalMode.ts',
        'server/sweBenchModelConfig.ts',
        'server/canonicalPatch.ts',
        'server/hardenedSandbox.ts',
        'scripts/run_swebench.ts',
    ]
    file_hashes = {}
    for f in EVALUATED_FILES:
        content = (base / f).read_bytes()
        file_hashes[f] = hashlib.sha256(content).hexdigest()
        print(f"  {f}: {file_hashes[f][:16]}...")

    manifest = {
        'canary_type': 'development_canary',
        'purpose': (
            'Validate multilingual pipeline end-to-end: '
            'issue -> multilingual context -> patch generation -> exact apply -> durable recording. '
            'Does NOT validate patch correctness or task-specific test execution (scored_strict blind-apply).'
        ),
        'commit': commit,
        'canary_ids': CANARY_IDS,
        'canary_id_list_hash': canary_hash,
        'languages': [REPO_LANG[i][1] for i in CANARY_IDS],
        'repos': [REPO_LANG[i][0] for i in CANARY_IDS],
        'all_ids_in_exclusion_registry': True,
        'all_ids_absent_from_holdout': True,
        'all_ids_in_dev_manifest': True,
        'spend_cap_usd': 20,
        'per_task_cap_usd': 5,
        'escalation': False,
        'mode': 'scored_strict',
        'model': 'claude-sonnet-5',
        'dataset': 'SWE-bench/SWE-bench_Multilingual',
        'evaluated_file_sha256': file_hashes,
        'frozen_at': datetime.now(timezone.utc).isoformat(),
        'note': (
            'Option B preregistration still binds 426cf4d3; '
            'this canary is development evidence only. '
            'Preregistration will be repinned after dev work is complete.'
        ),
    }

    manifest_for_hash = {k: v for k, v in manifest.items()
                         if k not in ('canary_manifest_hash', 'canary_manifest_hash_note')}
    manifest_hash = hashlib.sha256(
        json.dumps(manifest_for_hash, sort_keys=True, ensure_ascii=False, indent=2).encode()
    ).hexdigest()
    manifest['canary_manifest_hash'] = manifest_hash
    manifest['canary_manifest_hash_note'] = (
        'SHA-256 of JSON content without this field and canary_manifest_hash_note, '
        'sorted keys, 2-space indent, UTF-8'
    )

    out = base / 'data/swebench/multilingual_dev_canary_manifest.json'
    out.write_text(json.dumps(manifest, indent=2) + '\n')
    print(f"\nCanary manifest written to {out}")
    print(f"Canary manifest hash: {manifest_hash}")
    print(f"\nReady to launch 5-task dev canary")
    return 0

if __name__ == '__main__':
    sys.exit(main())
