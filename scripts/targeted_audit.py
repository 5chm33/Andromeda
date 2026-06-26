#!/usr/bin/env python3
"""
Andromeda Targeted Hardening Audit — v45.4.0
Fast scan for actionable issues only.
"""
import os, re, json

SERVER_DIR = os.path.expanduser("~/andromeda_full/server")

def get_prod_files():
    return sorted([
        os.path.join(SERVER_DIR, f)
        for f in os.listdir(SERVER_DIR)
        if f.endswith(".ts") and not f.endswith(".test.ts") and not f.endswith(".spec.ts")
    ])

def get_test_files():
    return sorted([
        os.path.join(SERVER_DIR, f)
        for f in os.listdir(SERVER_DIR)
        if f.endswith(".test.ts") or f.endswith(".spec.ts")
    ])

prod_files = get_prod_files()
test_files = get_test_files()

print(f"Scanning {len(prod_files)} production modules + {len(test_files)} test files...\n")

# ── 1. Empty catch blocks ──────────────────────────────────────────────────────
empty_catches = []
for path in prod_files:
    fname = os.path.basename(path)
    with open(path) as f:
        for i, line in enumerate(f, 1):
            if re.search(r'catch\s*\([^)]*\)\s*\{?\s*\}', line):
                empty_catches.append((fname, i, line.strip()[:80]))

print(f"Empty catch blocks: {len(empty_catches)}")
for fname, lineno, text in empty_catches:
    print(f"  {fname}:{lineno}  {text}")

# ── 2. TODO/FIXME/HACK in production code ─────────────────────────────────────
todos = []
for path in prod_files:
    fname = os.path.basename(path)
    with open(path) as f:
        for i, line in enumerate(f, 1):
            if re.search(r'\b(TODO|FIXME|HACK|XXX)\b', line, re.IGNORECASE):
                todos.append((fname, i, line.strip()[:80]))

print(f"\nTODO/FIXME/HACK comments: {len(todos)}")
for fname, lineno, text in todos:
    print(f"  {fname}:{lineno}  {text}")

# ── 3. Unstructured console.log (not structured logging) ──────────────────────
raw_console = []
for path in prod_files:
    fname = os.path.basename(path)
    with open(path) as f:
        for i, line in enumerate(f, 1):
            if re.search(r'\bconsole\.(log|warn|error|debug)\b', line):
                # Skip structured logging lines
                if not any(x in line for x in ["[INFO", "[WARN", "[ERROR", "[DEBUG",
                                                 "Initialized", "Starting", "Ready",
                                                 "Registered", "Loaded", "Daemon",
                                                 "// audit-ok"]):
                    raw_console.append((fname, i, line.strip()[:90]))

print(f"\nUnstructured console.log/warn/error: {len(raw_console)}")
for fname, lineno, text in raw_console[:20]:
    print(f"  {fname}:{lineno}  {text}")
if len(raw_console) > 20:
    print(f"  ... and {len(raw_console)-20} more")

# ── 4. Shared-state flakiness in tests ────────────────────────────────────────
flaky = []
for path in test_files:
    fname = os.path.basename(path)
    with open(path) as f:
        content = f.read()
    
    # Uses file-based storage modules without mocking fs
    uses_file_storage = bool(re.search(r'data/.*\.json|\.db|sqlite|writeFileSync', content))
    has_fs_mock = "vi.mock" in content and "fs" in content
    has_reset = "__reset" in content or "beforeEach" in content
    
    if uses_file_storage and not has_fs_mock and not has_reset:
        flaky.append((fname, "Uses file storage without fs mock or beforeEach reset"))

print(f"\nPotentially flaky tests (no isolation): {len(flaky)}")
for fname, reason in flaky:
    print(f"  {fname}: {reason}")

# ── 5. Duplicate/overlapping module names ─────────────────────────────────────
module_names = sorted([os.path.basename(f).replace(".ts","") for f in prod_files])
dups = []
for i, n1 in enumerate(module_names):
    for n2 in module_names[i+1:]:
        # Exact substring match with small length difference
        if (n1 in n2 or n2 in n1) and abs(len(n1)-len(n2)) <= 8 and len(n1) > 5:
            dups.append((n1, n2))

print(f"\nPotential duplicate/overlapping modules: {len(dups)}")
for n1, n2 in dups[:15]:
    print(f"  {n1}  ↔  {n2}")
if len(dups) > 15:
    print(f"  ... and {len(dups)-15} more")

# ── 6. v36-v45 specific: any-types in NEW modules only ────────────────────────
new_module_prefixes = [
    "perpetualState", "adaptiveExploration", "multiObjective", "knowledgeGraph",
    "anomalyDetection", "selfDocumentation", "hypothesis", "experimentDesigner",
    "resultAnalyzer", "peerReview", "scientificMemory", "breakthrough",
    "architectureEvolver", "moduleComposer", "interfaceNegotiator", "dependencyOptimizer",
    "codeQualityOracle", "refactoringEngine", "conceptMapper", "analogyEngine",
    "transferLearning", "domainBridger", "semanticCompressor", "knowledgeFusion",
    "constitutionalGuard", "alignmentMonitor", "valuePreservation", "corrigibility",
    "oversightProtocol", "safetyProof", "energyProfiler", "memoryOptimizer",
    "latencyPredictor", "throughputMaximizer", "costEstimator", "resourceAuctioneer",
    "collaborationEngine", "trustBuilder", "reputationTracker", "conflictResolver",
    "consensusNegotiator", "socialNorm", "eventSequencer", "causalChain",
    "futureState", "historicalPattern", "timeSeries", "temporalConsistency",
    "actionSpace", "sensorFusion", "motorSkill", "environmentModeler",
    "taskDecomposerV44", "executionMonitor", "systemIntegrator", "capabilityOrchestrator",
    "globalOptimizer", "emergenceDetector", "singularityPreparator", "omegaStateManager"
]

new_any_hits = []
for path in prod_files:
    fname = os.path.basename(path)
    base = fname.replace(".ts","")
    if any(base.startswith(p) or base == p for p in new_module_prefixes):
        with open(path) as f:
            for i, line in enumerate(f, 1):
                stripped = line.strip()
                if not stripped.startswith("//") and not stripped.startswith("*"):
                    if re.search(r':\s*any\b|as\s+any\b|<any>', line):
                        if "catch" not in line:
                            new_any_hits.append((fname, i, line.strip()[:80]))

print(f"\nany-types in v36-v45 NEW modules: {len(new_any_hits)}")
for fname, lineno, text in new_any_hits[:10]:
    print(f"  {fname}:{lineno}  {text}")

# ── SUMMARY ───────────────────────────────────────────────────────────────────
print("\n" + "="*60)
print("TARGETED AUDIT SUMMARY")
print("="*60)
print(f"  Production modules:           {len(prod_files)}")
print(f"  Test files:                   {len(test_files)}")
print(f"  Empty catch blocks:           {len(empty_catches)}")
print(f"  TODO/FIXME/HACK:              {len(todos)}")
print(f"  Unstructured console.log:     {len(raw_console)}")
print(f"  Flaky test patterns:          {len(flaky)}")
print(f"  Duplicate module names:       {len(dups)}")
print(f"  any-types in v36-v45 modules: {len(new_any_hits)}")

results = {
    "empty_catches": empty_catches,
    "todos": todos,
    "raw_console": raw_console,
    "flaky": flaky,
    "dups": [(n1,n2) for n1,n2 in dups],
    "new_any_hits": new_any_hits,
}
with open("/tmp/targeted_audit.json", "w") as f:
    json.dump(results, f, indent=2)
print("\nResults saved to /tmp/targeted_audit.json")
