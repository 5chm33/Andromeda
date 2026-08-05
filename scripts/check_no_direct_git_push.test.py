#!/usr/bin/env python3
"""
Regression test for check_no_direct_git_push.py.
Verifies that the gate correctly catches the exact pattern Elicit identified:
  const result = gitSandbox(`git push origin main`)
"""
import subprocess, sys, os, tempfile, textwrap

SCRIPT = os.path.join(os.path.dirname(__file__), "check_no_direct_git_push.py")

def run_gate(extra_file_content: str, extra_filename: str = "server/test_violation.ts") -> tuple:
    """Run the gate against a temp repo containing the given extra file."""
    with tempfile.TemporaryDirectory() as tmpdir:
        # Create minimal repo structure
        os.makedirs(os.path.join(tmpdir, "server"), exist_ok=True)
        os.makedirs(os.path.join(tmpdir, "scripts"), exist_ok=True)
        # Write the extra file
        with open(os.path.join(tmpdir, extra_filename), "w") as f:
            f.write(extra_file_content)
        # Copy the gate script itself
        import shutil
        shutil.copy(SCRIPT, os.path.join(tmpdir, "scripts", "check_no_direct_git_push.py"))
        result = subprocess.run(
            [sys.executable, os.path.join(tmpdir, "scripts", "check_no_direct_git_push.py")],
            capture_output=True, text=True
        )
        return result.returncode, result.stdout + result.stderr

def test_catches_const_result_pattern():
    """Elicit's exact pattern: const result = gitSandbox(`git push origin main`)"""
    code = textwrap.dedent("""
        import { gitSandbox } from "./gitSandbox.js";
        const result = gitSandbox(`git push origin main`);
    """)
    rc, output = run_gate(code)
    assert rc == 1, f"Expected FAIL (exit 1) but got {rc}. Output: {output}"
    assert "git push" in output, f"Expected 'git push' in output. Got: {output}"
    print("PASS: catches const result = gitSandbox(`git push origin main`)")

def test_catches_execsync_git_commit():
    """Direct execSync git commit call."""
    code = textwrap.dedent("""
        import { execSync } from "child_process";
        execSync("git commit -m 'bad'");
    """)
    rc, output = run_gate(code)
    assert rc == 1, f"Expected FAIL but got {rc}. Output: {output}"
    print("PASS: catches execSync('git commit ...')")

def test_allows_comment():
    """Comments should not trigger the gate."""
    code = textwrap.dedent("""
        // This is a comment: git push origin main
        /* git commit -m "also a comment" */
        const x = 1;
    """)
    rc, output = run_gate(code)
    assert rc == 0, f"Expected PASS but got {rc}. Output: {output}"
    print("PASS: allows comments containing git push/commit")

def test_allows_clean_file():
    """A file with no git push/commit should pass."""
    code = textwrap.dedent("""
        import { gitSandbox } from "./gitSandbox.js";
        const result = gitSandbox(`git status`);
        const diff = gitSandbox(`git diff HEAD`);
    """)
    rc, output = run_gate(code)
    assert rc == 0, f"Expected PASS but got {rc}. Output: {output}"
    print("PASS: allows git status and git diff")

if __name__ == "__main__":
    test_catches_const_result_pattern()
    test_catches_execsync_git_commit()
    test_allows_comment()
    test_allows_clean_file()
    print("\nAll 4 regression tests passed.")
