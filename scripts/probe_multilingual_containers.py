#!/usr/bin/env python3
"""
probe_multilingual_containers.py — Real container-backed zero-model probe.

For each language group in the dev set, picks one representative task,
and verifies ALL FIVE mandatory checks:
  1. Image resolves to an immutable sha256 digest
  2. /testbed (repository root) exists and is non-empty
  3. Language-policy-filtered source listing returns > 0 files
  4. A sample source file can be successfully extracted (cat'd)
  5. Required toolchain binary is available

Plus two evidence-gathering checks:
  6. Command discovery: infer the test command template for this language
  7. Harmless validation smoke: run a no-op command (e.g. 'true') to confirm
     the container can execute commands without network or privilege escalation

All five mandatory checks must pass for a language group to be marked PASS.
Results are written to data/swebench/multilingual_container_probe.json.

Accesses only: instance_id, repo (no issue text, patches, or tests).
"""

import json
import subprocess
import sys
import hashlib
from pathlib import Path
from datetime import datetime, timezone

ARCHIVE = Path("data/swebench")
DEV_FILE = ARCHIVE / "multilingual_dev.jsonl"
PROBE_OUTPUT = ARCHIVE / "multilingual_container_probe.json"

# Language → extension patterns, toolchain check, and test command template
LANGUAGE_CONFIG = {
    "go":         {
        "exts": ["*.go"],
        "toolchain_cmd": "go version",
        "test_cmd_template": "go test ./... -run {tests} -v 2>&1 | tail -30",
        "smoke_cmd": "go version && echo 'smoke-ok'",
    },
    "java":       {
        "exts": ["*.java"],
        "toolchain_cmd": "java -version",
        "test_cmd_template": "mvn test -pl . -Dtest={tests} -q 2>&1 | tail -20",
        "smoke_cmd": "java -version && echo 'smoke-ok'",
    },
    "rust":       {
        "exts": ["*.rs"],
        "toolchain_cmd": "cargo --version",
        "test_cmd_template": "cargo test {tests} 2>&1 | tail -30",
        "smoke_cmd": "cargo --version && echo 'smoke-ok'",
    },
    "ruby":       {
        "exts": ["*.rb"],
        "toolchain_cmd": "ruby --version",
        "test_cmd_template": "bundle exec ruby -Itest {tests} 2>&1 | tail -30",
        "smoke_cmd": "ruby --version && echo 'smoke-ok'",
    },
    "php":        {
        "exts": ["*.php"],
        "toolchain_cmd": "php --version",
        "test_cmd_template": "vendor/bin/phpunit {tests} 2>&1 | tail -30",
        "smoke_cmd": "php --version && echo 'smoke-ok'",
    },
    "javascript": {
        "exts": ["*.js", "*.mjs"],
        "toolchain_cmd": "node --version",
        "test_cmd_template": "npm test -- --testPathPattern='{tests}' 2>&1 | tail -30",
        "smoke_cmd": "node --version && echo 'smoke-ok'",
    },
    "typescript": {
        "exts": ["*.ts", "*.tsx"],
        "toolchain_cmd": "node --version",
        "test_cmd_template": "npm test -- --testPathPattern='{tests}' 2>&1 | tail -30",
        "smoke_cmd": "node --version && echo 'smoke-ok'",
    },
    "c":          {
        "exts": ["*.c", "*.h"],
        "toolchain_cmd": "gcc --version",
        "test_cmd_template": "make test 2>&1 | tail -30",
        "smoke_cmd": "gcc --version && echo 'smoke-ok'",
    },
    "cpp":        {
        "exts": ["*.cpp", "*.cc", "*.cxx", "*.h", "*.hpp"],
        "toolchain_cmd": "g++ --version",
        "test_cmd_template": "cmake --build . --target test 2>&1 | tail -30",
        "smoke_cmd": "g++ --version && echo 'smoke-ok'",
    },
    "c_python":   {
        "exts": ["*.c", "*.h", "*.py"],
        "toolchain_cmd": "python3 --version",
        "test_cmd_template": "python -m pytest {tests} -x --no-header -rN -q",
        "smoke_cmd": "python3 --version && echo 'smoke-ok'",
    },
}

# Repo → language map (same as sweBenchMultilingualSupport.ts)
REPO_LANG_MAP = {
    "apache/druid": "java", "apache/lucene": "java",
    "google/gson": "java", "google/guava": "java",
    "projectlombok/lombok": "java", "javaparser/javaparser": "java",
    "reactivex/rxjava": "java",
    "tokio-rs/tokio": "rust", "tokio-rs/axum": "rust",
    "astral-sh/ruff": "rust", "sharkdp/bat": "rust",
    "burntsushi/ripgrep": "rust", "rust-lang/rust": "rust",
    "serde-rs/serde": "rust", "launchbadge/sqlx": "rust",
    "nickel-lang/nickel": "rust", "nushell/nushell": "rust",
    "uutils/coreutils": "rust",
    "laravel/framework": "php", "briannesbitt/carbon": "php",
    "php-cs-fixer/php-cs-fixer": "php", "phpoffice/phpspreadsheet": "php",
    "sebastianbergmann/phpunit": "php", "symfony/symfony": "php",
    "rubocop/rubocop": "ruby", "fastlane/fastlane": "ruby",
    "fluent/fluentd": "ruby", "rails/rails": "ruby",
    "rubygems/rubygems": "ruby", "ruby/ruby": "ruby",
    "jekyll/jekyll": "ruby", "faker-ruby/faker": "ruby",
    "jordansissel/fpm": "ruby",
    "caddyserver/caddy": "go", "gin-gonic/gin": "go",
    "prometheus/prometheus": "go", "golang/go": "go",
    "kubernetes/kubernetes": "go", "moby/moby": "go",
    "gohugoio/hugo": "go", "hashicorp/terraform": "go",
    "preactjs/preact": "javascript", "expressjs/express": "javascript",
    "facebook/jest": "javascript", "lodash/lodash": "javascript",
    "moment/moment": "javascript", "nodejs/node": "javascript",
    "axios/axios": "javascript", "babel/babel": "javascript",
    "facebook/docusaurus": "javascript", "vuejs/core": "javascript",
    "mrdoob/three.js": "javascript", "immutable-js/immutable-js": "javascript",
    "redis/redis": "c", "jqlang/jq": "c",
    "ffmpeg/ffmpeg": "c", "git/git": "c",
    "libgit2/libgit2": "c", "openssl/openssl": "c",
    "valkey-io/valkey": "c",
    "fmtlib/fmt": "cpp", "llvm/llvm-project": "cpp",
    "nlohmann/json": "cpp",
    "microsoft/typescript": "typescript", "denoland/deno": "typescript",
    "micropython/micropython": "c_python",
}

def get_image_name(instance_id: str) -> str:
    normalized = instance_id.replace("__", "_1776_").lower()
    return f"swebench/sweb.eval.x86_64.{normalized}:latest"

def run_in_container(image: str, cmd: str, timeout: int = 30) -> tuple[int, str]:
    try:
        r = subprocess.run(
            ["docker", "run", "--rm", "--network", "none",
             "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
             image, "bash", "-c", cmd],
            capture_output=True, text=True, timeout=timeout
        )
        return r.returncode, (r.stdout + r.stderr).strip()
    except subprocess.TimeoutExpired:
        return -1, "TIMEOUT"
    except Exception as e:
        return -2, str(e)

def probe_instance(instance_id: str, repo: str, lang: str) -> dict:
    image = get_image_name(instance_id)
    config = LANGUAGE_CONFIG.get(lang, {})
    exts = config.get("exts", [])
    toolchain_cmd = config.get("toolchain_cmd", "echo no-toolchain")
    smoke_cmd = config.get("smoke_cmd", "echo smoke-ok")
    test_cmd_template = config.get("test_cmd_template", "")

    result = {
        "instance_id": instance_id,
        "repo": repo,
        "language": lang,
        "image": image,
        "probed_at": datetime.now(timezone.utc).isoformat(),
        "checks": {},
        "mandatory_checks": ["digest_resolved", "testbed_exists", "source_files_found",
                              "source_file_extracted", "toolchain_available"],
    }

    # Check 1 (MANDATORY): Image resolves to immutable sha256 digest
    try:
        r = subprocess.run(
            ["docker", "inspect", "--format",
             "{{index .RepoDigests 0}}", image],
            capture_output=True, text=True, timeout=15
        )
        digest = r.stdout.strip()
        if digest and "@sha256:" in digest:
            result["checks"]["digest_resolved"] = True
            result["image_digest"] = digest
        else:
            # Fall back to image ID as digest
            r2 = subprocess.run(
                ["docker", "inspect", "--format", "{{.Id}}", image],
                capture_output=True, text=True, timeout=15
            )
            img_id = r2.stdout.strip()
            if img_id and img_id.startswith("sha256:"):
                result["checks"]["digest_resolved"] = True
                result["image_digest"] = img_id
            else:
                result["checks"]["digest_resolved"] = False
                result["image_digest"] = "unresolved"
    except Exception as e:
        result["checks"]["digest_resolved"] = False
        result["image_digest"] = f"error: {e}"

    # Check 2 (MANDATORY): /testbed exists and is non-empty
    rc, out = run_in_container(image, "ls /testbed 2>/dev/null | wc -l")
    file_count_in_root = int(out.strip()) if rc == 0 and out.strip().isdigit() else 0
    result["checks"]["testbed_exists"] = rc == 0 and file_count_in_root > 0
    result["checks"]["testbed_root_entry_count"] = file_count_in_root

    # Check 3 (MANDATORY): Language-policy-filtered source listing returns > 0 files
    if exts:
        patterns = " ".join(f"'{e}'" for e in exts)
        rc, out = run_in_container(image, f"cd /testbed && git ls-files {patterns} 2>/dev/null | wc -l")
        source_count = int(out.strip()) if rc == 0 and out.strip().isdigit() else 0
        result["checks"]["source_files_found"] = source_count > 0
        result["checks"]["source_file_count"] = source_count

        # Get first file name for reference
        rc2, first_file = run_in_container(image, f"cd /testbed && git ls-files {patterns} 2>/dev/null | head -1")
        result["checks"]["first_source_file"] = first_file.strip()[:100] if rc2 == 0 else ""
    else:
        result["checks"]["source_files_found"] = False
        result["checks"]["source_file_count"] = 0
        result["checks"]["first_source_file"] = ""

    # Check 4 (MANDATORY): A sample source file can be successfully extracted (cat'd)
    first_file = result["checks"].get("first_source_file", "")
    if first_file:
        rc, content = run_in_container(
            image,
            f"cd /testbed && cat '{first_file}' 2>/dev/null | head -20",
            timeout=15
        )
        extracted_ok = rc == 0 and len(content.strip()) > 0
        result["checks"]["source_file_extracted"] = extracted_ok
        result["checks"]["source_file_excerpt"] = content.strip()[:200] if extracted_ok else f"exit={rc}: {content[:80]}"
    else:
        result["checks"]["source_file_extracted"] = False
        result["checks"]["source_file_excerpt"] = "no source file to extract"

    # Check 5 (MANDATORY): Required toolchain binary is available
    rc, out = run_in_container(image, toolchain_cmd)
    result["checks"]["toolchain_available"] = rc == 0
    result["checks"]["toolchain_version"] = out[:120] if rc == 0 else f"exit={rc}: {out[:80]}"

    # Check 6 (evidence): Command discovery — infer test command template
    result["checks"]["test_cmd_template"] = test_cmd_template
    result["checks"]["command_discovery_ok"] = bool(test_cmd_template)

    # Check 7 (evidence): Harmless validation smoke
    rc, out = run_in_container(image, smoke_cmd, timeout=20)
    result["checks"]["smoke_ok"] = rc == 0 and "smoke-ok" in out
    result["checks"]["smoke_output"] = out[:100] if rc == 0 else f"exit={rc}: {out[:80]}"

    # Overall pass/fail: ALL FIVE mandatory checks must pass
    mandatory = result["mandatory_checks"]
    result["passed"] = all(result["checks"].get(c, False) for c in mandatory)
    result["failed_mandatory"] = [c for c in mandatory if not result["checks"].get(c, False)]

    return result

def main():
    dev_rows = [json.loads(l) for l in DEV_FILE.read_text().splitlines() if l.strip()]

    # Pick one representative per language (first occurrence)
    seen_langs: set[str] = set()
    probes: list[tuple[str, str, str]] = []
    for row in dev_rows:
        repo = row["repo"].lower()
        lang = REPO_LANG_MAP.get(repo, REPO_LANG_MAP.get(row["repo"], "unknown"))
        if lang not in seen_langs and lang != "unknown":
            seen_langs.add(lang)
            probes.append((row["instance_id"], row["repo"], lang))

    print(f"Probing {len(probes)} language groups: {[p[2] for p in probes]}")
    print()

    results = []
    for instance_id, repo, lang in probes:
        print(f"  [{lang}] {instance_id} ({repo})")
        r = probe_instance(instance_id, repo, lang)
        results.append(r)

        status = "✓ PASS" if r["passed"] else "✗ FAIL"
        print(f"    {status}")
        for check in r["mandatory_checks"]:
            val = r["checks"].get(check, False)
            icon = "✓" if val else "✗"
            detail = ""
            if check == "source_files_found":
                detail = f" ({r['checks'].get('source_file_count', 0)} files)"
            elif check == "toolchain_available":
                detail = f" ({r['checks'].get('toolchain_version', '')[:50]})"
            elif check == "source_file_extracted":
                detail = f" ({r['checks'].get('first_source_file', '')[:40]})"
            elif check == "digest_resolved":
                detail = f" ({r.get('image_digest', '')[:40]})"
            print(f"      {icon} {check}{detail}")

        if r["checks"].get("smoke_ok"):
            print(f"      ✓ smoke_ok")
        if r["failed_mandatory"]:
            print(f"      FAILED: {r['failed_mandatory']}")
        print()

    # Summary
    passed = sum(1 for r in results if r["passed"])
    total = len(results)
    print(f"Probe summary: {passed}/{total} language groups passed all 5 mandatory checks")

    # Write output
    output = {
        "probed_at": datetime.now(timezone.utc).isoformat(),
        "total_groups": total,
        "passed_groups": passed,
        "mandatory_checks": ["digest_resolved", "testbed_exists", "source_files_found",
                              "source_file_extracted", "toolchain_available"],
        "evidence_checks": ["command_discovery_ok", "smoke_ok"],
        "results": results,
    }
    PROBE_OUTPUT.write_text(json.dumps(output, indent=2) + "\n")
    print(f"Results written to {PROBE_OUTPUT}")

    return 0 if passed == total else 1

if __name__ == "__main__":
    sys.exit(main())
