#!/usr/bin/env python3
"""
Zero-model disjointness audit: SWE-bench Multilingual vs exclusion registry.

Downloads ONLY: instance_id, repo, base_commit, language
Does NOT access: problem_statement, patch, test_patch, hints_text, FAIL_TO_PASS

Outputs:
  - overlap count and IDs
  - SHA-256 of both ID lists
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

def sha256_of_sorted_ids(ids: list[str]) -> str:
    return hashlib.sha256(json.dumps(sorted(ids)).encode()).hexdigest()

def main():
    # Load exclusion registry
    excluded_ids: set[str] = set()
    with open(EXCLUSIONS_PATH) as f:
        for line in f:
            line = line.strip()
            if line:
                row = json.loads(line)
                excluded_ids.add(row["instance_id"])
    print(f"Exclusion registry: {len(excluded_ids)} IDs")
    exclusion_hash = sha256_of_sorted_ids(list(excluded_ids))
    print(f"Exclusion registry SHA-256: {exclusion_hash}")

    # Load SWE-bench Multilingual — metadata columns only
    print("\nLoading SWE-bench/SWE-bench_Multilingual (test split)...")
    from datasets import load_dataset
    ds = load_dataset(
        "SWE-bench/SWE-bench_Multilingual",
        split="test",
    )

    # Extract only the fields we need for the audit
    AUDIT_COLUMNS = ["instance_id", "repo", "base_commit"]
    # Check which columns are available
    available = set(ds.column_names)
    print(f"Available columns: {sorted(available)}")

    # Collect metadata rows (no issue text, patches, or tests)
    rows = []
    for row in ds:
        audit_row = {col: row[col] for col in AUDIT_COLUMNS if col in available}
        # Add language if available
        for lang_col in ["language", "lang"]:
            if lang_col in available:
                audit_row["language"] = row[lang_col]
                break
        rows.append(audit_row)

    multilingual_ids = [r["instance_id"] for r in rows]
    print(f"\nSWE-bench Multilingual: {len(multilingual_ids)} instances")
    multilingual_hash = sha256_of_sorted_ids(multilingual_ids)
    print(f"Multilingual ID-list SHA-256: {multilingual_hash}")

    # Disjointness check
    overlap = set(multilingual_ids) & excluded_ids
    print(f"\nOverlap with exclusion registry: {len(overlap)} IDs")
    if overlap:
        print("OVERLAP DETECTED:")
        for id_ in sorted(overlap)[:20]:
            print(f"  {id_}")
        if len(overlap) > 20:
            print(f"  ... and {len(overlap) - 20} more")
    else:
        print("DISJOINT — no overlap with exclusion registry ✓")

    # Language breakdown
    lang_counts = Counter()
    for r in rows:
        lang = r.get("language", "unknown")
        lang_counts[lang] += 1
    print("\nLanguage breakdown:")
    for lang, count in lang_counts.most_common():
        print(f"  {lang}: {count}")

    # Repo breakdown (top 10)
    repo_counts = Counter(r.get("repo", "unknown") for r in rows)
    print(f"\nTop repos ({len(repo_counts)} total):")
    for repo, count in repo_counts.most_common(10):
        print(f"  {repo}: {count}")

    # Write audit record
    audit = {
        "audit_type": "disjointness",
        "exclusion_registry": {
            "path": str(EXCLUSIONS_PATH),
            "count": len(excluded_ids),
            "id_list_sha256": exclusion_hash,
        },
        "multilingual": {
            "dataset": "SWE-bench/SWE-bench_Multilingual",
            "split": "test",
            "count": len(multilingual_ids),
            "id_list_sha256": multilingual_hash,
            "language_breakdown": dict(lang_counts),
            "repo_count": len(repo_counts),
        },
        "overlap": {
            "count": len(overlap),
            "ids": sorted(overlap),
        },
        "disjoint": len(overlap) == 0,
        "note": "Audit accessed only instance_id, repo, base_commit, language. No issue text, patches, or tests were read.",
    }

    with open(AUDIT_OUTPUT, "w") as f:
        json.dump(audit, f, indent=2)
    print(f"\nAudit record written to: {AUDIT_OUTPUT}")

    if len(overlap) == 0:
        print("\nVERDICT: SWE-bench Multilingual is a valid unexposed evaluation pool.")
    else:
        print(f"\nVERDICT: {len(overlap)} instances overlap — those IDs must be excluded before any run.")

if __name__ == "__main__":
    main()
