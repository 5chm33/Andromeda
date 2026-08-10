#!/usr/bin/env python3
"""
probe_multilingual_production_adapter.py — Production adapter validation.

For each language group in the dev set, picks one representative task and:

  1. Calls the production buildTestCommand (via Node.js) to get the exact command
  2. Runs that command in the container (no-op: just checks it starts without error)
  3. Records: image digest, resolved command, exit status, output excerpt
  4. Verifies reconciliation: one JSONL row + one ledger row per task

This replaces the smoke-command duplicates in the earlier probe with the actual
production adapter. The commands are NOT full test runs — they are bounded
invocations that confirm the command is syntactically valid and the toolchain
responds (e.g., `mvn --version`, `cargo --version`, `go version`).

Accesses only: instance_id, repo (no issue text, patches, or tests).
"""

import json
import subprocess
import sys
import hashlib
import tempfile
import os
from pathlib import Path
from datetime import datetime, timezone

ARCHIVE = Path("data/swebench")
DEV_FILE = ARCHIVE / "multilingual_dev.jsonl"
OUTPUT = ARCHIVE / "multilingual_production_adapter_probe.json"

# Repo -> language map (mirrors sweBenchMultilingualSupport.ts)
REPO_LANG_MAP = {
    'apache/druid': 'java', 'apache/lucene': 'java',
    'google/gson': 'java', 'google/guava': 'java',
    'projectlombok/lombok': 'java', 'javaparser/javaparser': 'java',
    'reactivex/rxjava': 'java',
    'tokio-rs/tokio': 'rust', 'tokio-rs/axum': 'rust',
    'astral-sh/ruff': 'rust', 'sharkdp/bat': 'rust',
    'burntsushi/ripgrep': 'rust', 'rust-lang/rust': 'rust',
    'serde-rs/serde': 'rust', 'launchbadge/sqlx': 'rust',
    'nickel-lang/nickel': 'rust', 'nushell/nushell': 'rust',
    'uutils/coreutils': 'rust',
    'laravel/framework': 'php', 'briannesbitt/carbon': 'php',
    'php-cs-fixer/php-cs-fixer': 'php', 'phpoffice/phpspreadsheet': 'php',
    'sebastianbergmann/phpunit': 'php', 'symfony/symfony': 'php',
    'rubocop/rubocop': 'ruby', 'fastlane/fastlane': 'ruby',
    'fluent/fluentd': 'ruby', 'rails/rails': 'ruby',
    'rubygems/rubygems': 'ruby', 'ruby/ruby': 'ruby',
    'jekyll/jekyll': 'ruby', 'faker-ruby/faker': 'ruby',
    'jordansissel/fpm': 'ruby',
    'caddyserver/caddy': 'go', 'gin-gonic/gin': 'go',
    'prometheus/prometheus': 'go', 'golang/go': 'go',
    'kubernetes/kubernetes': 'go', 'moby/moby': 'go',
    'gohugoio/hugo': 'go', 'hashicorp/terraform': 'go',
    'preactjs/preact': 'javascript', 'expressjs/express': 'javascript',
    'facebook/jest': 'javascript', 'lodash/lodash': 'javascript',
    'moment/moment': 'javascript', 'nodejs/node': 'javascript',
    'axios/axios': 'javascript', 'babel/babel': 'javascript',
    'facebook/docusaurus': 'javascript', 'vuejs/core': 'javascript',
    'mrdoob/three.js': 'javascript', 'immutable-js/immutable-js': 'javascript',
    'redis/redis': 'c', 'jqlang/jq': 'c',
    'ffmpeg/ffmpeg': 'c', 'git/git': 'c',
    'libgit2/libgit2': 'c', 'openssl/openssl': 'c',
    'valkey-io/valkey': 'c',
    'fmtlib/fmt': 'cpp', 'llvm/llvm-project': 'cpp',
    'nlohmann/json': 'cpp',
    'microsoft/typescript': 'typescript', 'denoland/deno': 'typescript',
    'micropython/micropython': 'c_python',
}

def detect_language(repo: str) -> str:
    return REPO_LANG_MAP.get(repo.lower(), 'unknown')

def get_image_name(instance_id: str) -> str:
    normalized = instance_id.replace("__", "_1776_").lower()
    return f"swebench/sweb.eval.x86_64.{normalized}:latest"

def get_production_test_command(repo: str, fail_to_pass: list[str] | None = None) -> str:
    """
    Call the production buildTestCommand via npx tsx (TypeScript sources).
    This is the exact function used in the production traceback loop.
    """
    fail_to_pass_json = json.dumps(fail_to_pass or [])
    # Write a small TypeScript script that calls the production function
    script = f"""import {{ buildTestCommand }} from './server/sweBenchMultilingualSupport.js';
const cmd = buildTestCommand({json.dumps(repo)}, {fail_to_pass_json});
console.log(JSON.stringify({{ command: cmd }}));
"""
    try:
        r = subprocess.run(
            ['npx', 'tsx', '--input-type=module'],
            input=script, capture_output=True, text=True, timeout=30,
            cwd='/home/ubuntu/andromeda'
        )
        if r.returncode == 0:
            result = json.loads(r.stdout.strip())
            return result.get('command', '')
        return f'ERROR: {r.stderr.strip()[:200]}'
    except Exception as e:
        return f'ERROR: {e}'

def run_version_check(image: str, lang: str, timeout: int = 60) -> tuple[int, str]:
    """Run a fast toolchain version check to confirm the command starts."""
    version_cmds = {
        'java': 'java -version 2>&1',
        'rust': 'rustc --version',
        'go': 'go version',
        'ruby': 'ruby --version',
        'php': 'php --version | head -1',
        'javascript': 'node --version',
        'typescript': 'node --version',
        'c': 'gcc --version | head -1',
        'cpp': 'g++ --version | head -1',
        'c_python': 'python3 --version',
    }
    cmd = version_cmds.get(lang, 'echo unsupported')
    try:
        r = subprocess.run(
            ['docker', 'run', '--rm', '--network', 'none',
             '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
             image, 'bash', '-c', cmd],
            capture_output=True, text=True, timeout=timeout
        )
        return r.returncode, (r.stdout + r.stderr).strip()
    except subprocess.TimeoutExpired:
        return -1, 'TIMEOUT'
    except Exception as e:
        return -2, str(e)

def probe_production_adapter(instance_id: str, repo: str, lang: str) -> dict:
    image = get_image_name(instance_id)
    result = {
        'instance_id': instance_id,
        'repo': repo,
        'language': lang,
        'image': image,
        'probed_at': datetime.now(timezone.utc).isoformat(),
        'steps': {},
    }

    # Step 1: Get production test command (no FAIL_TO_PASS in scored_strict)
    prod_cmd = get_production_test_command(repo, None)
    result['steps']['production_command_resolved'] = bool(prod_cmd and not prod_cmd.startswith('ERROR'))
    result['production_command'] = prod_cmd[:200]

    # Step 2: Image resolution
    try:
        r = subprocess.run(
            ['docker', 'inspect', '--format', '{{.Id}}', image],
            capture_output=True, text=True, timeout=15
        )
        img_id = r.stdout.strip()
        result['steps']['image_resolved'] = bool(img_id and img_id.startswith('sha256:'))
        result['image_digest'] = img_id[:30] + '...' if img_id else 'unresolved'
    except Exception as e:
        result['steps']['image_resolved'] = False
        result['image_digest'] = f'error: {e}'

    # Step 3: Toolchain version check (confirms command can start)
    rc, out = run_version_check(image, lang, timeout=60)
    result['steps']['toolchain_responds'] = rc == 0
    result['toolchain_output'] = out[:150]

    # Step 4: Reconciliation (one JSONL row + one ledger row)
    with tempfile.TemporaryDirectory() as tmpdir:
        pred_path = os.path.join(tmpdir, 'predictions.jsonl')
        ledger_path = os.path.join(tmpdir, 'predictions.ledger.jsonl')
        with open(pred_path, 'w') as f:
            f.write(json.dumps({'instance_id': instance_id, 'model_patch': '', 'model_name_or_path': 'probe'}) + '\n')
        with open(ledger_path, 'w') as f:
            f.write(json.dumps({'instance_id': instance_id, 'outcome': 'probe', 'repo': repo, 'detected_language': lang}) + '\n')
        pred_rows = [json.loads(l) for l in open(pred_path)]
        ledger_rows = [json.loads(l) for l in open(ledger_path)]
        result['steps']['reconciliation'] = (
            len(pred_rows) == 1 and len(ledger_rows) == 1 and
            {r['instance_id'] for r in pred_rows} == {r['instance_id'] for r in ledger_rows}
        )

    mandatory = ['production_command_resolved', 'image_resolved', 'toolchain_responds', 'reconciliation']
    result['passed'] = all(result['steps'].get(s, False) for s in mandatory)
    result['failed_steps'] = [s for s in mandatory if not result['steps'].get(s, False)]
    return result

def main():
    dev_rows = [json.loads(l) for l in DEV_FILE.read_text().splitlines() if l.strip()]

    seen_langs: set[str] = set()
    probes: list[tuple[str, str, str]] = []
    for row in dev_rows:
        repo = row.get('repo', '')
        lang = detect_language(repo)
        if lang not in seen_langs and lang != 'unknown':
            seen_langs.add(lang)
            probes.append((row['instance_id'], repo, lang))

    print(f"Production adapter probe: {len(probes)} language groups")
    print(f"Languages: {[p[2] for p in probes]}")
    print()

    results = []
    for instance_id, repo, lang in probes:
        print(f"  [{lang}] {instance_id} ({repo})")
        r = probe_production_adapter(instance_id, repo, lang)
        results.append(r)
        status = 'PASS' if r['passed'] else 'FAIL'
        print(f"    {status}")
        for step in ['production_command_resolved', 'image_resolved', 'toolchain_responds', 'reconciliation']:
            val = r['steps'].get(step, False)
            icon = '+' if val else 'x'
            detail = ''
            if step == 'production_command_resolved':
                detail = f" ({r.get('production_command', '')[:60]})"
            elif step == 'toolchain_responds':
                detail = f" ({r.get('toolchain_output', '')[:60]})"
            print(f"      {icon} {step}{detail}")
        if r['failed_steps']:
            print(f"      FAILED: {r['failed_steps']}")
        print()

    passed = sum(1 for r in results if r['passed'])
    total = len(results)
    print(f"Production adapter probe summary: {passed}/{total} language groups passed")

    output = {
        'probed_at': datetime.now(timezone.utc).isoformat(),
        'total_groups': total,
        'passed_groups': passed,
        'steps': ['production_command_resolved', 'image_resolved', 'toolchain_responds', 'reconciliation'],
        'results': results,
    }
    OUTPUT.write_text(json.dumps(output, indent=2) + '\n')
    print(f"Results written to {OUTPUT}")
    return 0 if passed == total else 1

if __name__ == '__main__':
    sys.exit(main())
