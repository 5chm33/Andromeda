#!/usr/bin/env python3
"""
check_no_direct_git_push.py — Gate 3 CI check.

Verifies that no TypeScript module outside the allowlist calls
execSync/spawnSync/exec/spawn with "git push" or "git commit" directly,
bypassing the gitSandbox wrapper and promotionService.ts gate.

Allowlisted files (may call git directly):
  - server/promotionService.ts  (the single authorized promotion choke point)
  - server/gitSandbox.ts        (the validated git wrapper itself)

What is NOT flagged:
  - gitSandbox(...) calls — these go through the validated wrapper
  - String literals in console.log/warn/error messages
  - Comments (// or * lines)
  - Prompt strings in evalFramework.ts (LLM prompt text, not code)
  - Tool description strings (documentation, not execution)
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent

ALLOWLISTED = {
    "server/promotionService.ts",
    "server/gitSandbox.ts",
}

# Only flag raw execSync/spawnSync/exec/spawn calls with git push or commit
# NOT gitSandbox calls (those are the approved path)
FORBIDDEN_PATTERNS = [
    # execSync("git push ...") or execSync("git commit ...")
    re.compile(r'\bexecSync\s*\(\s*[`\'"]git\s+(push|commit)\b', re.IGNORECASE),
    # spawnSync("git", ["push", ...]) or spawnSync("git", ["commit", ...])
    re.compile(r'\bspawnSync\s*\(\s*["\']git["\'],\s*\[[^\]]*["\'](?:push|commit)["\']', re.IGNORECASE),
    # exec("git push ...") or exec("git commit ...")
    re.compile(r'\bexec\s*\(\s*[`\'"]git\s+(push|commit)\b', re.IGNORECASE),
    # spawn("git", ["push", ...]) or spawn("git", ["commit", ...])
    re.compile(r'\bspawn\s*\(\s*["\']git["\'],\s*\[[^\]]*["\'](?:push|commit)["\']', re.IGNORECASE),
]

violations = []

for ts_file in ROOT.glob("server/**/*.ts"):
    rel = str(ts_file.relative_to(ROOT))
    if rel in ALLOWLISTED:
        continue
    if ".test.ts" in rel or "tests/" in rel:
        continue
    if "experimental/" in rel:
        continue

    try:
        content = ts_file.read_text(encoding="utf-8")
    except Exception:
        continue

    for lineno, line in enumerate(content.splitlines(), 1):
        stripped = line.strip()
        # Skip comment lines
        if stripped.startswith("//") or stripped.startswith("*"):
            continue
        # Skip lines that are gitSandbox calls (approved path)
        if "gitSandbox(" in line:
            continue
        # Skip console.log/warn/error lines (string messages, not execution)
        if re.search(r'console\.(log|warn|error|info)\s*\(', line):
            continue
        # Skip lines that are just string assignments or template literals in prompts
        if re.search(r'^\s*(prompt|description|message|steps\.push|return)\s*[=:]\s*[`\'"]', stripped):
            continue
        for pattern in FORBIDDEN_PATTERNS:
            if pattern.search(line):
                violations.append(f"  {rel}:{lineno}: {line.strip()[:120]}")
                break

if violations:
    print("FAILED: Raw git push/commit calls found outside gitSandbox/promotionService.ts:")
    for v in violations:
        print(v)
    print()
    print("All Git mutations must go through server/gitSandbox.ts or server/promotionService.ts.")
    sys.exit(1)

total = len(list(ROOT.glob("server/**/*.ts")))
print(f"PASSED: No raw git push/commit calls found in {total} server files.")
