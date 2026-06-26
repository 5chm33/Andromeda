#!/usr/bin/env python3
"""
Andromeda v15 Comprehensive Audit Script
Checks: wiring, test coverage, dead code, integration paths, import health
"""
import os, re, json
from pathlib import Path

SERVER = Path("server")
PROD_FILES = sorted([f for f in SERVER.glob("*.ts") if not f.name.endswith(".test.ts") and not f.name.endswith(".spec.ts")])
TEST_FILES = sorted([f for f in SERVER.glob("*.test.ts")])
CORE_FILES = sorted([f for f in (SERVER / "_core").glob("*.ts")])

print(f"=== ANDROMEDA v15 COMPREHENSIVE AUDIT ===\n")
print(f"Production modules:  {len(PROD_FILES)}")
print(f"Test files:          {len(TEST_FILES)}")
print(f"Core files:          {len(len(CORE_FILES) and CORE_FILES or [])}")

# ─── 1. WIRING AUDIT ─────────────────────────────────────────────────────────
print("\n\n=== 1. WIRING AUDIT ===")

# Critical v12-v15 modules that MUST be wired somewhere
CRITICAL_MODULES = {
    # v12.12 core
    "circuitBreaker":         "llmProvider.ts",
    "gracefulDegradation":    "llmProvider.ts",
    "streamIntegrityMonitor": "aiStreaming.ts",
    "watchdog":               "initDaemons.ts",
    "observability":          "index.ts",
    "rsiScheduler":           "initDaemons.ts",
    "costOptimizer":          "selfImprove.ts",
    "transactionLog":         "selfImprove.ts",
    # v13
    "semanticCodebaseGraph":  "selfImprove.ts",
    "multiAgentDebate":       "selfImprove.ts",
    "chaosEngineer":          "initDaemons.ts",
    # v14
    "rsiWorkerPool":          "initDaemons.ts",
    "selfHealingChaos":       "initDaemons.ts",
    "epistemicBeliefModel":   "selfImprove.ts",
    "ciRegressionGuard":      "selfImprove.ts",
    # v15
    "rsiTaskQueue":           "initDaemons.ts",
    "continuousFineTuner":    "initDaemons.ts",
    "semanticDiffValidator":  "selfImprove.ts",
    "proposalRanker":         "rsiEngine.ts",
}

wiring_results = {}
all_ts_content = {}

# Read all server files
for f in list(PROD_FILES) + list(CORE_FILES) + list((SERVER / "_core").glob("*.ts")):
    try:
        all_ts_content[f.name] = f.read_text()
    except:
        pass

for module, expected_wired_in in CRITICAL_MODULES.items():
    # Check if the module file exists
    module_exists = (SERVER / f"{module}.ts").exists()
    
    # Check if it's imported anywhere (static or dynamic)
    wired_locations = []
    for fname, content in all_ts_content.items():
        if module in content and fname != f"{module}.ts" and fname != f"{module}.test.ts":
            wired_locations.append(fname)
    
    is_wired_in_expected = expected_wired_in in wired_locations
    
    wiring_results[module] = {
        "exists": module_exists,
        "wired_in": wired_locations,
        "expected_in": expected_wired_in,
        "wired_correctly": is_wired_in_expected,
    }

wired_ok = [m for m, r in wiring_results.items() if r["wired_correctly"]]
wired_missing = [m for m, r in wiring_results.items() if not r["wired_correctly"] and r["exists"]]
missing_files = [m for m, r in wiring_results.items() if not r["exists"]]

print(f"\n✅ Correctly wired ({len(wired_ok)}/{len(CRITICAL_MODULES)}):")
for m in wired_ok:
    print(f"   {m} → {wiring_results[m]['expected_in']}")

if wired_missing:
    print(f"\n⚠️  Wiring gaps ({len(wired_missing)}):")
    for m in wired_missing:
        r = wiring_results[m]
        print(f"   {m}: expected in {r['expected_in']}, found in: {r['wired_in'] or 'NOWHERE'}")

if missing_files:
    print(f"\n❌ Missing module files ({len(missing_files)}):")
    for m in missing_files:
        print(f"   {m}.ts — FILE DOES NOT EXIST")

# ─── 2. TEST COVERAGE AUDIT ──────────────────────────────────────────────────
print("\n\n=== 2. TEST COVERAGE AUDIT ===")

prod_stems = {f.stem for f in PROD_FILES}
test_stems = {f.stem.replace(".test", "") for f in TEST_FILES}

covered = prod_stems & test_stems
uncovered = prod_stems - test_stems

# Categorize uncovered modules
critical_uncovered = []
low_priority_uncovered = []
LOW_PRIORITY_PATTERNS = ["Route", "route", "Config", "config", "Type", "type", "Interface", "index", "helper", "util"]

for m in sorted(uncovered):
    is_low = any(p in m for p in LOW_PRIORITY_PATTERNS)
    if is_low:
        low_priority_uncovered.append(m)
    else:
        critical_uncovered.append(m)

print(f"\nTotal production modules:  {len(prod_stems)}")
print(f"Modules with tests:        {len(covered)} ({100*len(covered)//len(prod_stems)}%)")
print(f"Modules without tests:     {len(uncovered)}")
print(f"  Critical (need tests):   {len(critical_uncovered)}")
print(f"  Low priority (routes/config): {len(low_priority_uncovered)}")

if critical_uncovered:
    print(f"\n⚠️  Critical modules missing tests:")
    for m in critical_uncovered[:20]:
        print(f"   {m}.ts")
    if len(critical_uncovered) > 20:
        print(f"   ... and {len(critical_uncovered)-20} more")

# ─── 3. IMPORT HEALTH ────────────────────────────────────────────────────────
print("\n\n=== 3. IMPORT HEALTH ===")

broken_imports = []
for f in PROD_FILES:
    content = f.read_text()
    imports = re.findall(r"from ['\"]\.\/([^'\"]+)['\"]", content)
    for imp in imports:
        imp_clean = imp.replace(".js", "")
        imp_path = SERVER / f"{imp_clean}.ts"
        if not imp_path.exists():
            broken_imports.append((f.name, imp_clean))

if broken_imports:
    print(f"\n❌ Broken imports ({len(broken_imports)}):")
    for src, imp in broken_imports[:20]:
        print(f"   {src} → {imp}.ts (FILE NOT FOUND)")
else:
    print(f"\n✅ All imports resolve correctly — 0 broken imports")

# ─── 4. DEAD CODE DETECTION ──────────────────────────────────────────────────
print("\n\n=== 4. DEAD CODE / ORPHAN DETECTION ===")

# Find modules that are never imported anywhere (excluding test files and entry points)
ENTRY_POINTS = {"index.ts", "initDaemons.ts", "rsiEngine.ts", "selfImprove.ts", "aiStreaming.ts", "llmProvider.ts"}
all_imports_set = set()
for fname, content in all_ts_content.items():
    if fname in ENTRY_POINTS:
        continue
    found = re.findall(r"from ['\"]\.\/([^'\"]+)['\"]", content)
    for imp in found:
        all_imports_set.add(imp.replace(".js", ""))

# Also check dynamic imports
for fname, content in all_ts_content.items():
    found = re.findall(r"import\(['\"]\.\/([^'\"]+)['\"]", content)
    for imp in found:
        all_imports_set.add(imp.replace(".js", ""))

# Check string references (for dynamic module loading)
for fname, content in all_ts_content.items():
    found = re.findall(r"['\"]\.\/server\/([^'\"]+)['\"]", content)
    for imp in found:
        all_imports_set.add(imp.replace(".ts", "").replace(".js", ""))

orphans = []
for f in PROD_FILES:
    stem = f.stem
    if stem not in all_imports_set and stem not in {e.replace(".ts","") for e in ENTRY_POINTS}:
        orphans.append(stem)

# Filter out known dynamically loaded modules
DYNAMIC_MODULES = {
    "rsiScheduler", "chaosEngineer", "selfHealingChaos", "rsiWorkerPool",
    "continuousFineTuner", "rsiTaskQueue", "multiAgentDebate", "semanticCodebaseGraph",
    "proposalRanker", "semanticDiffValidator", "costOptimizer", "transactionLog",
    "streamIntegrityMonitor", "watchdog", "observability", "epistemicBeliefModel",
    "ciRegressionGuard", "circuitBreaker", "gracefulDegradation",
}
true_orphans = [o for o in orphans if o not in DYNAMIC_MODULES]

print(f"\nModules with no static imports: {len(orphans)}")
print(f"  Known dynamic modules:        {len(orphans) - len(true_orphans)}")
print(f"  Potential true orphans:       {len(true_orphans)}")

if true_orphans:
    print(f"\n⚠️  Potential orphan modules (investigate):")
    for o in true_orphans[:15]:
        print(f"   {o}.ts")

# ─── 5. SUMMARY SCORECARD ────────────────────────────────────────────────────
print("\n\n=== 5. AUDIT SCORECARD ===")

wiring_score = 100 * len(wired_ok) // len(CRITICAL_MODULES)
coverage_score = 100 * len(covered) // len(prod_stems)
import_score = 100 if not broken_imports else max(0, 100 - len(broken_imports) * 5)
orphan_score = 100 if not true_orphans else max(0, 100 - len(true_orphans) * 3)
overall = (wiring_score + coverage_score + import_score + orphan_score) // 4

print(f"\n  Wiring completeness:    {wiring_score:3d}/100")
print(f"  Test coverage:          {coverage_score:3d}/100")
print(f"  Import health:          {import_score:3d}/100")
print(f"  Orphan cleanliness:     {orphan_score:3d}/100")
print(f"  ─────────────────────────────")
print(f"  OVERALL GRADE:          {overall:3d}/100  ", end="")
if overall >= 95: print("S-TIER ★★★★★")
elif overall >= 85: print("A+ ★★★★")
elif overall >= 75: print("A ★★★")
elif overall >= 65: print("B+ ★★")
else: print("B ★")

print("\n=== AUDIT COMPLETE ===\n")
