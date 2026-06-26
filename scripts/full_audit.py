#!/usr/bin/env python3
"""
Andromeda Full Codebase Audit — v45.4.0
Covers all 402 server modules across 4 dimensions:
  1. any-types, missing return types, empty catch blocks
  2. Dead exports (exported but never imported)
  3. Shared-state test flakiness (file-based storage without isolation)
  4. TODO/FIXME/HACK, console.log in production, Math.random in deterministic paths
"""
import os
import re
import json
from collections import defaultdict

SERVER_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "server")

def get_all_ts_files(exclude_tests=False):
    files = []
    for f in sorted(os.listdir(SERVER_DIR)):
        if not f.endswith(".ts"):
            continue
        if exclude_tests and (f.endswith(".test.ts") or f.endswith(".spec.ts")):
            continue
        files.append(os.path.join(SERVER_DIR, f))
    return files

def read(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()

# ─── AUDIT 1: any-types, missing return types, empty catch blocks ─────────────
print("\n" + "="*70)
print("AUDIT 1: any-types, missing return types, empty catch blocks")
print("="*70)

prod_files = get_all_ts_files(exclude_tests=True)

any_type_hits = []
empty_catch_hits = []
missing_return_hits = []

for path in prod_files:
    content = read(path)
    fname = os.path.basename(path)
    lines = content.split("\n")
    
    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        # any-types: ": any" or "as any" or "<any>" — skip comments
        if not stripped.startswith("//") and not stripped.startswith("*"):
            if re.search(r':\s*any\b|as\s+any\b|<any>', line):
                # Skip type assertion in catch blocks (common pattern)
                if "catch" not in line and "// audit-ok" not in line:
                    any_type_hits.append((fname, i, line.strip()[:80]))
        
        # Empty catch blocks
        if re.search(r'catch\s*\([^)]*\)\s*\{?\s*\}', line):
            empty_catch_hits.append((fname, i, line.strip()[:80]))

    # Missing return types on exported functions (heuristic: export function foo( with no ): )
    for i, line in enumerate(lines, 1):
        if re.match(r'\s*export\s+(async\s+)?function\s+\w+\s*\(', line):
            # Check if the line or next line has a return type annotation
            combined = line + (lines[i] if i < len(lines) else "")
            if "):" not in combined and "): void" not in combined and "): Promise" not in combined:
                # Only flag if the function signature spans this line
                if "{" in line or (i < len(lines) and "{" in lines[i]):
                    missing_return_hits.append((fname, i, line.strip()[:80]))

print(f"\n  any-type usages in production code: {len(any_type_hits)}")
for fname, lineno, text in any_type_hits[:20]:
    print(f"    {fname}:{lineno}  {text}")
if len(any_type_hits) > 20:
    print(f"    ... and {len(any_type_hits)-20} more")

print(f"\n  Empty catch blocks: {len(empty_catch_hits)}")
for fname, lineno, text in empty_catch_hits[:10]:
    print(f"    {fname}:{lineno}  {text}")

print(f"\n  Exported functions missing explicit return type: {len(missing_return_hits)}")
for fname, lineno, text in missing_return_hits[:15]:
    print(f"    {fname}:{lineno}  {text}")

# ─── AUDIT 2: Dead exports ─────────────────────────────────────────────────────
print("\n" + "="*70)
print("AUDIT 2: Dead exports (exported but never imported anywhere)")
print("="*70)

all_files = get_all_ts_files(exclude_tests=False)

# Collect all exports from production files
exports_by_file = {}
for path in prod_files:
    content = read(path)
    fname = os.path.basename(path)
    exports = re.findall(r'export\s+(?:async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+(\w+)', content)
    exports_by_file[fname] = set(exports)

# Collect all imports across all files
all_imports = set()
for path in all_files:
    content = read(path)
    # Named imports: import { foo, bar } from ...
    for match in re.finditer(r'import\s*\{([^}]+)\}', content):
        names = re.findall(r'\b(\w+)\b', match.group(1))
        all_imports.update(names)
    # Also check usage (not just import) — some modules use dynamic imports
    # Check for direct function calls that match export names

# Find truly dead exports
dead_exports = []
for fname, exports in exports_by_file.items():
    for export_name in exports:
        if export_name not in all_imports:
            # Double-check: is it used as a value anywhere?
            used_anywhere = False
            for path in all_files:
                content = read(path)
                if os.path.basename(path) == fname:
                    continue
                if re.search(r'\b' + re.escape(export_name) + r'\b', content):
                    used_anywhere = True
                    break
            if not used_anywhere:
                dead_exports.append((fname, export_name))

print(f"\n  Truly dead exports (not imported or used anywhere): {len(dead_exports)}")
# Group by file
dead_by_file = defaultdict(list)
for fname, name in dead_exports:
    dead_by_file[fname].append(name)
for fname, names in sorted(dead_by_file.items())[:20]:
    print(f"    {fname}: {', '.join(names[:5])}")
if len(dead_by_file) > 20:
    print(f"    ... and {len(dead_by_file)-20} more files")

# ─── AUDIT 3: Shared-state test flakiness ─────────────────────────────────────
print("\n" + "="*70)
print("AUDIT 3: Shared-state test flakiness (file-based storage in tests)")
print("="*70)

test_files = [f for f in get_all_ts_files(exclude_tests=False) 
              if f.endswith(".test.ts") or f.endswith(".spec.ts")]

flaky_patterns = []
for path in test_files:
    content = read(path)
    fname = os.path.basename(path)
    
    # Pattern: test file imports a module that uses fs.writeFileSync to a data/ path
    # but doesn't mock fs or reset state
    has_fs_mock = "vi.mock" in content and ("fs" in content or "existsSync" in content)
    has_reset = "__reset" in content or "beforeEach" in content
    uses_file_storage = re.search(r'data/.*\.json|\.db|sqlite', content)
    
    if uses_file_storage and not has_fs_mock:
        flaky_patterns.append((fname, "Uses file storage without fs mock"))
    
    # Pattern: beforeEach missing for tests that use shared module state
    if "recordTemporalEvent" in content or "publishToFederatedGraph" in content:
        if "__resetMockStorage" not in content and "beforeEach" not in content:
            flaky_patterns.append((fname, "Uses stateful module without beforeEach reset"))

print(f"\n  Potentially flaky tests (shared state without isolation): {len(flaky_patterns)}")
for fname, reason in flaky_patterns[:15]:
    print(f"    {fname}: {reason}")

# ─── AUDIT 4: TODO/FIXME, console.log, Math.random ───────────────────────────
print("\n" + "="*70)
print("AUDIT 4: TODO/FIXME/HACK, console.log in production, Math.random in deterministic paths")
print("="*70)

todo_hits = []
console_hits = []
random_hits = []

for path in prod_files:
    content = read(path)
    fname = os.path.basename(path)
    lines = content.split("\n")
    
    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        if stripped.startswith("//") or stripped.startswith("*"):
            if re.search(r'\bTODO\b|\bFIXME\b|\bHACK\b|\bXXX\b', line, re.IGNORECASE):
                todo_hits.append((fname, i, line.strip()[:80]))
        
        # console.log/warn/error in non-init production code
        if re.search(r'\bconsole\.(log|warn|error|debug)\b', line):
            # Allow: lines with [INFO], [WARN], [ERROR] structured logging
            if "[INFO" not in line and "[WARN" not in line and "[ERROR" not in line:
                # Allow: init/startup messages
                if "Initialized" not in line and "Starting" not in line and "Ready" not in line:
                    console_hits.append((fname, i, line.strip()[:80]))
        
        # Math.random in functions that should be deterministic
        if "Math.random()" in line:
            # Flag if it's in a function that has "hash", "verify", "proof", "deterministic" in name
            random_hits.append((fname, i, line.strip()[:80]))

print(f"\n  TODO/FIXME/HACK comments: {len(todo_hits)}")
for fname, lineno, text in todo_hits:
    print(f"    {fname}:{lineno}  {text}")

print(f"\n  Unstructured console.log/warn/error in production code: {len(console_hits)}")
for fname, lineno, text in console_hits[:15]:
    print(f"    {fname}:{lineno}  {text}")
if len(console_hits) > 15:
    print(f"    ... and {len(console_hits)-15} more")

print(f"\n  Math.random() usages (review for determinism): {len(random_hits)}")
for fname, lineno, text in random_hits[:10]:
    print(f"    {fname}:{lineno}  {text}")

# ─── AUDIT 5: Duplicate/redundant modules ─────────────────────────────────────
print("\n" + "="*70)
print("AUDIT 5: Duplicate/redundant module detection")
print("="*70)

# Check for modules with very similar names that might be duplicates
module_names = [os.path.basename(f).replace(".ts", "") for f in prod_files]
# Look for pairs where one is a suffix/prefix of another
potential_dups = []
for i, name1 in enumerate(module_names):
    for name2 in module_names[i+1:]:
        # Check if names are very similar (one contains the other)
        if name1 in name2 or name2 in name1:
            if abs(len(name1) - len(name2)) < 10:
                potential_dups.append((name1, name2))

print(f"\n  Potentially duplicate/overlapping modules: {len(potential_dups)}")
for n1, n2 in potential_dups[:20]:
    print(f"    {n1}  ↔  {n2}")

# ─── SUMMARY ──────────────────────────────────────────────────────────────────
print("\n" + "="*70)
print("AUDIT SUMMARY")
print("="*70)
print(f"  Production modules scanned:        {len(prod_files)}")
print(f"  Test files scanned:                {len(test_files)}")
print(f"  any-type usages:                   {len(any_type_hits)}")
print(f"  Empty catch blocks:                {len(empty_catch_hits)}")
print(f"  Missing return types (exported):   {len(missing_return_hits)}")
print(f"  Dead exports:                      {len(dead_exports)}")
print(f"  Flaky test patterns:               {len(flaky_patterns)}")
print(f"  TODO/FIXME/HACK:                   {len(todo_hits)}")
print(f"  Unstructured console.log:          {len(console_hits)}")
print(f"  Math.random usages:                {len(random_hits)}")
print(f"  Potential duplicate modules:       {len(potential_dups)}")

# Save results to JSON for fix phase
results = {
    "any_type_hits": any_type_hits,
    "empty_catch_hits": empty_catch_hits,
    "missing_return_hits": missing_return_hits,
    "dead_exports": dead_exports,
    "flaky_patterns": flaky_patterns,
    "todo_hits": todo_hits,
    "console_hits": console_hits,
    "random_hits": random_hits,
    "potential_dups": potential_dups,
}
with open("/tmp/audit_results.json", "w") as f:
    json.dump(results, f, indent=2)
print("\n  Full results saved to /tmp/audit_results.json")
