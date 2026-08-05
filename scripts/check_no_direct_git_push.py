#!/usr/bin/env python3
"""
Gate 3: No direct git push or commit mutations outside promotionService.ts.

Rules:
  - git push: NEVER allowed outside promotionService.ts (even via gitSandbox)
  - git commit: NEVER allowed outside promotionService.ts and the approved
    snapshot-only files (twoPhaseCommit, selfRunTestsTool, dependency_upgrader)
    when used for LOCAL-ONLY snapshots (no push follows).
  - gitSandbox("git push ...") is NOT an exemption — it still bypasses the
    promotion gate.

Allowed files for LOCAL snapshot commits (no push):
  - server/twoPhaseCommit.ts
  - server/tools/selfRunTestsTool.ts
  - server/self/dependency_upgrader.ts
  - server/selfImprove.ts (initial-commit-only path for new repos)
"""

import re
import sys
import os
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
SERVER_DIR = REPO_ROOT / "server"

# Files allowed to do LOCAL snapshot commits (no push)
SNAPSHOT_ALLOWLIST = {
    "server/twoPhaseCommit.ts",
    "server/tools/selfRunTestsTool.ts",
    "server/self/dependency_upgrader.ts",
    "server/selfImprove.ts",  # initial-commit path for new repos (no push)
}

# The one file allowed to do commit + push
PROMOTION_SERVICE = "server/promotionService.ts"

# Patterns that indicate a git mutation
PUSH_PATTERN = re.compile(r'git\s+push', re.IGNORECASE)
COMMIT_PATTERN = re.compile(r'git\s+commit', re.IGNORECASE)
# Patterns that are code (not comments or strings in log messages)
CODE_LINE_PATTERN = re.compile(r'^\s*(gitSandbox|execSync|spawnSync|gitRun|child_process)', re.IGNORECASE)
# Skip lines that are only comments
COMMENT_PATTERN = re.compile(r'^\s*//')

violations = []

ts_files = list(SERVER_DIR.rglob("*.ts"))

for fpath in ts_files:
    rel = str(fpath.relative_to(REPO_ROOT))
    
    # promotionService.ts is the canonical home — always allowed
    if rel == PROMOTION_SERVICE:
        continue
    
    # Test files are allowed to mock git calls
    if ".test." in fpath.name or fpath.name.endswith(".spec.ts"):
        continue
    
    try:
        lines = fpath.read_text(encoding="utf-8").splitlines()
    except Exception:
        continue
    
    for lineno, line in enumerate(lines, 1):
        # Skip pure comment lines
        if COMMENT_PATTERN.match(line):
            continue
        
        # Check for git push — never allowed outside promotionService
        if PUSH_PATTERN.search(line) and CODE_LINE_PATTERN.match(line):
            violations.append(f"{rel}:{lineno}: git push outside promotionService.ts: {line.strip()[:120]}")
            continue
        
        # Check for git commit — only allowed in snapshot-allowlist files
        if COMMIT_PATTERN.search(line) and CODE_LINE_PATTERN.match(line):
            if rel not in SNAPSHOT_ALLOWLIST:
                violations.append(f"{rel}:{lineno}: git commit outside promotionService.ts and snapshot allowlist: {line.strip()[:120]}")

if violations:
    print(f"FAILED: {len(violations)} git mutation violation(s) found:\n")
    for v in violations:
        print(f"  {v}")
    sys.exit(1)
else:
    print(f"PASSED: No direct git push/commit mutations outside promotionService.ts")
    sys.exit(0)
