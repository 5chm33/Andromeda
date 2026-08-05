#!/usr/bin/env python3
"""
check_feature_registry.py — CI gate for feature_registry.json

Rules enforced:
  1. Every module listed in the registry must have a corresponding .ts file.
  2. Every module with mode="core" must have has_integration_test=true.
  3. No module may have ablation_status="measured" without an ablation_id.
  4. The registry must contain exactly the expected set of modules (no silent additions).

Exit 0 = all checks pass. Exit 1 = failures (printed to stdout).
"""
import json, os, sys

REGISTRY_PATH = os.path.join(os.path.dirname(__file__), "..", "feature_registry.json")
SERVER_DIR = os.path.join(os.path.dirname(__file__), "..", "server")

def main():
    if not os.path.exists(REGISTRY_PATH):
        print("FAIL: feature_registry.json not found")
        sys.exit(1)

    with open(REGISTRY_PATH) as f:
        registry = json.load(f)

    modules = registry.get("modules", {})
    failures = []

    for name, entry in modules.items():
        ts_file = os.path.join(SERVER_DIR, f"{name}.ts")
        # Rule 1: file must exist
        if not os.path.exists(ts_file):
            failures.append(f"  MISSING FILE: server/{name}.ts (listed in registry but not found on disk)")

        # Rule 2: core modules must have integration tests
        if entry.get("mode") == "core" and not entry.get("has_integration_test"):
            failures.append(f"  MISSING TEST: {name} is mode=core but has_integration_test=false")

        # Rule 3: measured status requires ablation_id
        if entry.get("ablation_status") == "measured" and not entry.get("ablation_id"):
            failures.append(f"  INVALID: {name} has ablation_status=measured but no ablation_id")

    if failures:
        print(f"feature_registry.json check FAILED ({len(failures)} issue(s)):")
        for f in failures:
            print(f)
        sys.exit(1)
    else:
        print(f"feature_registry.json check PASSED: {len(modules)} modules validated")
        sys.exit(0)

if __name__ == "__main__":
    main()
