#!/usr/bin/env python3
"""
Gate 3: No direct git push/commit outside policy-owned exceptions.

Scans ALL non-comment lines in executable TypeScript, JavaScript, Python, and shell files for:
  - Any direct "git push" or "git commit" command
  - Except in files explicitly on the allowlist.

Catches patterns like:
  const result = gitSandbox(`git push origin ${branch}`)
  run(`git commit -m "${msg}"`, cwd)
  execSync("git push --force")
"""
import re, sys, os

# Files allowed to contain git push/commit calls
ALLOWLIST = {
    # The single choke point — only file allowed to push/commit externally
    "server/promotionService.ts",
    # The git wrapper itself (defines the allowed commands)
    "server/gitSandbox.ts",
    # Snapshot/rollback commits (local only, no push)
    "server/twoPhaseCommit.ts",       # stable-state snapshot before modification
    "server/tools/selfRunTestsTool.ts",  # snapshot before restart
    "server/self/dependency_upgrader.ts",  # snapshot before auto-upgrade
    # Test files (mock strings, not real calls)
    "server/tools/selfRunTestsTool.test.ts",
    # This file and its regression test
    "scripts/check_no_direct_git_push.py",
    "scripts/check_no_direct_git_push.test.py",
}

# Quoted command strings in TypeScript/Python plus direct shell commands. This
# intentionally does not match prose such as a prompt mentioning "git commit".
GIT_MUTATION_PATTERN = re.compile(r"""(?:["'`]\s*git\s+(?:push|commit)\b|^\s*git\s+(?:push|commit)\b)""")
# Also catch child-process argument vectors such as spawnSync("git", ["push", ...]).
GIT_SUBPROCESS_MUTATION_PATTERN = re.compile(
    r"""(?:spawn|execFile)(?:Sync)?\s*\(\s*["']git["']\s*,\s*\[\s*["'](?:push|commit)["']"""
)

SINGLE_LINE_COMMENT = re.compile(r'^\s*(?://|#)')
BLOCK_COMMENT_START = re.compile(r'/\*')
BLOCK_COMMENT_END = re.compile(r'\*/')
SOURCE_SUFFIXES = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".py", ".sh", ".bash", ".zsh")

def check_file(filepath: str, rel_path: str) -> list:
    violations = []
    in_block_comment = False
    with open(filepath, encoding="utf-8", errors="replace") as f:
        for lineno, line in enumerate(f, 1):
            if in_block_comment:
                if BLOCK_COMMENT_END.search(line):
                    in_block_comment = False
                continue
            if BLOCK_COMMENT_START.search(line):
                if not BLOCK_COMMENT_END.search(line):
                    in_block_comment = True
                continue
            if SINGLE_LINE_COMMENT.match(line):
                continue
            if GIT_MUTATION_PATTERN.search(line) or GIT_SUBPROCESS_MUTATION_PATTERN.search(line):
                violations.append(f"  {rel_path}:{lineno}: {line.rstrip()}")
    return violations

def main():
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    violations = []
    scanned = 0
    for dirpath, dirnames, filenames in os.walk(repo_root):
        dirnames[:] = [d for d in dirnames if d not in ("node_modules", "dist", ".git", "coverage")]
        for fname in filenames:
            if not fname.endswith(SOURCE_SUFFIXES):
                continue
            full = os.path.join(dirpath, fname)
            rel = os.path.relpath(full, repo_root).replace("\\", "/")
            if rel in ALLOWLIST:
                continue
            scanned += 1
            violations.extend(check_file(full, rel))

    if violations:
        print(f"FAIL: Found {len(violations)} direct git push/commit call(s) outside allowlisted files:")
        for v in violations:
            print(v)
        print("\nAll Git push/commit operations must use the promotion service or an explicitly reviewed local-snapshot exception")
        sys.exit(1)
    else:
        print(f"PASS: No direct git push/commit calls found outside allowlist ({scanned} files scanned)")
        sys.exit(0)

if __name__ == "__main__":
    main()
