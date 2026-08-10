#!/usr/bin/env python3
"""
probe_multilingual_containers.py — Real container-backed zero-model probe.

For each language group in the dev set, picks one representative task,
pulls its image (if not already available), and verifies:
  1. Image resolves to a sha256 digest
  2. /testbed exists in the container
  3. git ls-files with the language-specific extension returns > 0 files
  4. A sample file can be read from /testbed
  5. The expected toolchain binary exists (go/java/cargo/ruby/php/etc.)

Accesses only: instance_id, repo, base_commit (no issue text, patches, or tests).
All results are written to data/swebench/multilingual_container_probe.json.
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

# Language → extension patterns and toolchain check
LANGUAGE_CONFIG = {
    "go":         {"exts": ["*.go"],                  "toolchain": "go version"},
    "java":       {"exts": ["*.java"],                "toolchain": "java -version"},
    "rust":       {"exts": ["*.rs"],                  "toolchain": "cargo --version"},
    "ruby":       {"exts": ["*.rb"],                  "toolchain": "ruby --version"},
    "php":        {"exts": ["*.php"],                 "toolchain": "php --version"},
    "javascript": {"exts": ["*.js", "*.mjs"],         "toolchain": "node --version"},
    "c":          {"exts": ["*.c", "*.h"],            "toolchain": "gcc --version"},
    "cpp":        {"exts": ["*.cpp", "*.cc", "*.h"],  "toolchain": "g++ --version"},
    "c_python":   {"exts": ["*.c", "*.h", "*.py"],    "toolchain": "python3 --version"},
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

def resolve_digest(image: str) -> str | None:
    try:
        r = subprocess.run(
            ["docker", "inspect", "--format", "{{index .RepoDigests 0}}", image],
            capture_output=True, text=True, timeout=15
        )
        digest = r.stdout.strip()
        if digest and "@sha256:" in digest:
            return digest
        # Try ID-based digest
        r2 = subprocess.run(
            ["docker", "inspect", "--format", "{{.Id}}", image],
            capture_output=True, text=True, timeout=15
        )
        img_id = r2.stdout.strip()
        if img_id:
            return f"{image}@{img_id[:71]}"
    except Exception:
        pass
    return None

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
    toolchain_cmd = config.get("toolchain", "echo no-toolchain")

    result = {
        "instance_id": instance_id,
        "repo": repo,
        "language": lang,
        "image": image,
        "probed_at": datetime.now(timezone.utc).isoformat(),
        "checks": {},
    }

    # Check 1: Image available locally
    r = subprocess.run(
        ["docker", "images", "-q", image],
        capture_output=True, text=True, timeout=10
    )
    img_id = r.stdout.strip()
    result["checks"]["image_available"] = bool(img_id)
    if not img_id:
        result["checks"]["error"] = "Image not available locally"
        result["passed"] = False
        return result

    # Check 2: Resolve digest
    digest = resolve_digest(image)
    result["checks"]["digest_resolved"] = bool(digest)
    result["image_digest"] = digest or "unresolved"

    # Check 3: /testbed exists
    rc, out = run_in_container(image, "ls /testbed | head -5")
    result["checks"]["testbed_exists"] = rc == 0
    result["checks"]["testbed_ls"] = out[:200] if rc == 0 else f"exit={rc}: {out[:100]}"

    # Check 4: Source files discoverable
    if exts:
        patterns = " ".join(f"'{e}'" for e in exts)
        rc, out = run_in_container(image, f"cd /testbed && git ls-files {patterns} 2>/dev/null | wc -l")
        file_count = int(out.strip()) if rc == 0 and out.strip().isdigit() else 0
        result["checks"]["source_files_found"] = file_count > 0
        result["checks"]["source_file_count"] = file_count
        # Get first file name
        rc2, first_file = run_in_container(image, f"cd /testbed && git ls-files {patterns} 2>/dev/null | head -1")
        result["checks"]["first_source_file"] = first_file.strip()[:100] if rc2 == 0 else ""
    else:
        result["checks"]["source_files_found"] = False
        result["checks"]["source_file_count"] = 0

    # Check 5: Toolchain available
    rc, out = run_in_container(image, toolchain_cmd)
    result["checks"]["toolchain_available"] = rc == 0
    result["checks"]["toolchain_version"] = out[:100] if rc == 0 else f"exit={rc}: {out[:80]}"

    # Overall pass/fail
    critical = ["image_available", "testbed_exists", "source_files_found"]
    result["passed"] = all(result["checks"].get(c, False) for c in critical)
    return result

def main():
    dev_rows = [json.loads(l) for l in DEV_FILE.read_text().splitlines() if l.strip()]

    # Pick one representative per language (first occurrence)
    seen_langs = set()
    probes = []
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
        print(f"    {status} | testbed={r['checks'].get('testbed_exists')} | "
              f"files={r['checks'].get('source_file_count', 0)} | "
              f"toolchain={r['checks'].get('toolchain_available')}")
        if r["checks"].get("first_source_file"):
            print(f"    first file: {r['checks']['first_source_file']}")
        print()

    # Summary
    passed = sum(1 for r in results if r["passed"])
    total = len(results)
    print(f"Probe summary: {passed}/{total} language groups passed")

    # Write output
    output = {
        "probed_at": datetime.now(timezone.utc).isoformat(),
        "total_groups": total,
        "passed_groups": passed,
        "results": results,
    }
    PROBE_OUTPUT.write_text(json.dumps(output, indent=2) + "\n")
    print(f"Results written to {PROBE_OUTPUT}")

    return 0 if passed == total else 1

if __name__ == "__main__":
    sys.exit(main())
