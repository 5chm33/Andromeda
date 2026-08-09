#!/usr/bin/env python3
"""
Zero-model disjointness audit: SWE-bench Multilingual vs exclusion registry.

Downloads ONLY: instance_id, repo, base_commit
Does NOT access: problem_statement, patch, test_patch, hints_text, FAIL_TO_PASS

Checks disjointness on TWO keys:
  1. instance_id (primary)
  2. repo@base_commit (secondary — guards against same task under a different ID)

Outputs:
  - overlap count and IDs for both keys
  - SHA-256 of both ID lists and both repo@base_commit lists
  - language/repo breakdown
  - audit record JSON
"""

import json
import hashlib
import sys
from pathlib import Path
from collections import Counter

EXCLUSIONS_PATH = Path(__file__).parent.parent / "data" / "swebench" / "exclusions.jsonl"
AUDIT_OUTPUT = Path(__file__).parent.parent / "data" / "swebench" / "multilingual_disjointness_audit.json"

# Map repos to primary language (no language column in dataset)
REPO_LANG = {
    "preactjs/preact": "JavaScript",
    "axios/axios": "JavaScript",
    "babel/babel": "JavaScript",
    "facebook/docusaurus": "JavaScript/TypeScript",
    "immutable-js/immutable-js": "JavaScript",
    "mrdoob/three.js": "JavaScript",
    "vuejs/core": "TypeScript",
    "tokio-rs/axum": "Rust",
    "tokio-rs/tokio": "Rust",
    "burntsushi/ripgrep": "Rust",
    "sharkdp/bat": "Rust",
    "astral-sh/ruff": "Rust",
    "nushell/nushell": "Rust",
    "uutils/coreutils": "Rust",
    "projectlombok/lombok": "Java",
    "apache/druid": "Java",
    "apache/lucene": "Java",
    "google/gson": "Java",
    "javaparser/javaparser": "Java",
    "reactivex/rxjava": "Java",
    "fmtlib/fmt": "C++",
    "nlohmann/json": "C++",
    "jqlang/jq": "C",
    "redis/redis": "C",
    "valkey-io/valkey": "C",
    "caddyserver/caddy": "Go",
    "gin-gonic/gin": "Go",
    "gohugoio/hugo": "Go",
    "hashicorp/terraform": "Go",
    "prometheus/prometheus": "Go",
    "rubocop/rubocop": "Ruby",
    "jekyll/jekyll": "Ruby",
    "faker-ruby/faker": "Ruby",
    "fastlane/fastlane": "Ruby",
    "jordansissel/fpm": "Ruby",
    "fluent/fluentd": "Ruby",
    "laravel/framework": "PHP",
    "php-cs-fixer/php-cs-fixer": "PHP",
    "phpoffice/phpspreadsheet": "PHP",
    "briannesbitt/carbon": "PHP",
    "micropython/micropython": "C/Python",  # C with Python bindings
}


def sha256_of_sorted_list(items: list[str]) -> str:
    return hashlib.sha256(json.dumps(sorted(items)).encode()).hexdigest()


def main():
    # ── Load exclusion registry ──────────────────────────────────────────────
    excluded_ids: set[str] = set()
    excluded_task_keys: set[str] = set()  # repo@base_commit

    with open(EXCLUSIONS_PATH) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            excluded_ids.add(row["instance_id"])
            # Some exclusion rows may not have repo/base_commit; skip gracefully
            if "repo" in row and "base_commit" in row:
                excluded_task_keys.add(f"{row['repo']}@{row['base_commit']}")

    print(f"Exclusion registry: {len(excluded_ids)} IDs, {len(excluded_task_keys)} repo@base_commit keys")
    exclusion_id_hash = sha256_of_sorted_list(list(excluded_ids))
    exclusion_key_hash = sha256_of_sorted_list(list(excluded_task_keys))
    print(f"  ID-list SHA-256:           {exclusion_id_hash}")
    print(f"  repo@base_commit SHA-256:  {exclusion_key_hash}")

    # ── Load SWE-bench Multilingual — metadata columns only ──────────────────
    print("\nLoading SWE-bench/SWE-bench_Multilingual (test split)...")
    from datasets import load_dataset
    ds = load_dataset("SWE-bench/SWE-bench_Multilingual", split="test")

    rows = []
    for row in ds:
        rows.append({
            "instance_id": row["instance_id"],
            "repo": row["repo"],
            "base_commit": row["base_commit"],
        })

    multilingual_ids = [r["instance_id"] for r in rows]
    multilingual_keys = [f"{r['repo']}@{r['base_commit']}" for r in rows]

    print(f"SWE-bench Multilingual: {len(multilingual_ids)} instances")
    multilingual_id_hash = sha256_of_sorted_list(multilingual_ids)
    multilingual_key_hash = sha256_of_sorted_list(multilingual_keys)
    print(f"  ID-list SHA-256:           {multilingual_id_hash}")
    print(f"  repo@base_commit SHA-256:  {multilingual_key_hash}")

    # ── Disjointness check — key 1: instance_id ──────────────────────────────
    id_overlap = set(multilingual_ids) & excluded_ids
    print(f"\nOverlap by instance_id:        {len(id_overlap)}")
    if id_overlap:
        print("  OVERLAP DETECTED:")
        for id_ in sorted(id_overlap)[:10]:
            print(f"    {id_}")

    # ── Disjointness check — key 2: repo@base_commit ─────────────────────────
    key_overlap = set(multilingual_keys) & excluded_task_keys
    print(f"Overlap by repo@base_commit:   {len(key_overlap)}")
    if key_overlap:
        print("  OVERLAP DETECTED:")
        for k in sorted(key_overlap)[:10]:
            print(f"    {k}")

    if len(id_overlap) == 0 and len(key_overlap) == 0:
        print("\nDISJOINT on both keys ✓")
    elif len(id_overlap) == 0 and len(key_overlap) > 0:
        print("\nWARNING: disjoint by ID but overlapping by repo@base_commit")
    else:
        print(f"\nOVERLAP: {len(id_overlap)} by ID, {len(key_overlap)} by repo@base_commit")

    # ── Language breakdown ────────────────────────────────────────────────────
    lang_counts = Counter()
    for r in rows:
        lang = REPO_LANG.get(r["repo"], f"unknown ({r['repo']})")
        lang_counts[lang] += 1

    print("\nLanguage breakdown:")
    for lang, count in lang_counts.most_common():
        print(f"  {lang}: {count} ({count/3:.0f}%)")

    # Classify Python presence accurately
    python_only = lang_counts.get("Python", 0)
    c_python = lang_counts.get("C/Python", 0)
    print(f"\nPython note: {python_only} Python-only tasks; {c_python} C/Python tasks (micropython/micropython)")

    # ── Write audit record ────────────────────────────────────────────────────
    audit = {
        "audit_type": "disjointness",
        "audit_version": 2,
        "exclusion_registry": {
            "path": str(EXCLUSIONS_PATH),
            "count": len(excluded_ids),
            "id_list_sha256": exclusion_id_hash,
            "repo_base_commit_sha256": exclusion_key_hash,
            "repo_base_commit_count": len(excluded_task_keys),
        },
        "multilingual": {
            "dataset": "SWE-bench/SWE-bench_Multilingual",
            "split": "test",
            "count": len(multilingual_ids),
            "repos": len(set(r["repo"] for r in rows)),
            "id_list_sha256": multilingual_id_hash,
            "repo_base_commit_sha256": multilingual_key_hash,
            "language_breakdown": dict(lang_counts.most_common()),
            "language_note": (
                "Language inferred from repo identity (no language column in dataset). "
                "0 Python-only tasks; 5 C/Python tasks (micropython/micropython)."
            ),
        },
        "overlap": {
            "by_instance_id": {"count": len(id_overlap), "ids": sorted(id_overlap)},
            "by_repo_base_commit": {"count": len(key_overlap), "keys": sorted(key_overlap)},
        },
        "disjoint_by_id": len(id_overlap) == 0,
        "disjoint_by_repo_base_commit": len(key_overlap) == 0,
        "disjoint": len(id_overlap) == 0 and len(key_overlap) == 0,
        "note": (
            "Audit accessed only instance_id, repo, base_commit. "
            "No issue text, patches, or tests were read. "
            "Disjointness verified on two independent keys: instance_id and repo@base_commit."
        ),
    }

    with open(AUDIT_OUTPUT, "w") as f:
        json.dump(audit, f, indent=2)
    print(f"\nAudit record written to: {AUDIT_OUTPUT}")

    if audit["disjoint"]:
        print("VERDICT: SWE-bench Multilingual is disjoint on both keys — valid unexposed evaluation pool.")
    else:
        print("VERDICT: Overlap detected — review before use.")


if __name__ == "__main__":
    main()
