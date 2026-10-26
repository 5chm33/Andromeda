#!/usr/bin/env python3
"""Temporary-repository tests for verify_preservation.py.

These tests never invoke the checker against an existing repository.  Every
Git command against a disposable repository supplies a known identity and
turns hooks off explicitly.
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


CHECKER = Path(__file__).with_name("verify_preservation.py")


class PreservationVerifierTests(unittest.TestCase):
    """Exercise the command-line verifier against fully isolated repositories."""

    def git(self, repo: Path, *arguments: str, check: bool = True) -> subprocess.CompletedProcess[str]:
        """Run Git in a temporary test repository with hooks disabled."""

        return subprocess.run(
            [
                "git",
                "-c",
                "core.hooksPath=/dev/null",
                "-c",
                "user.name=Preservation Test",
                "-c",
                "user.email=preservation-test@example.invalid",
                "-C",
                str(repo),
                *arguments,
            ],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=check,
        )

    def write(self, repo: Path, relative_path: str, content: str, mode: int | None = None) -> Path:
        """Write an ordinary test fixture file inside a temporary repository."""

        path = repo / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        if mode is not None:
            path.chmod(mode)
        return path

    def make_repo(self) -> tuple[tempfile.TemporaryDirectory[str], Path, str]:
        """Create a fixture repo and return its disposable baseline commit."""

        temporary = tempfile.TemporaryDirectory(prefix="verify-preservation-")
        repo = Path(temporary.name)
        self.git(repo, "init", "--initial-branch=main")
        self.write(repo, "src/original.py", "VALUE = 'original'\n")
        self.write(repo, "docs/portfolio/reference-artifact.txt", "audited artifact\n")
        self.git(repo, "add", "--", ".")
        self.git(repo, "commit", "--no-verify", "-m", "audited baseline")
        baseline = self.git(repo, "rev-parse", "HEAD").stdout.strip()
        return temporary, repo, baseline

    def commit_all(self, repo: Path, message: str) -> None:
        """Commit all tracked and untracked fixture changes with hooks disabled."""

        self.git(repo, "add", "--", ".")
        self.git(repo, "commit", "--no-verify", "-m", message)

    def run_checker(self, repo: Path, baseline: str) -> subprocess.CompletedProcess[str]:
        """Run the checker only against the supplied temporary repository."""

        return subprocess.run(
            [
                sys.executable,
                str(CHECKER),
                "--repo",
                str(repo),
                "--baseline",
                baseline,
            ],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=False,
        )

    def test_valid_additive_change_passes(self) -> None:
        temporary, repo, baseline = self.make_repo()
        with temporary:
            self.write(repo, "docs/portfolio/new-evidence.md", "new additive evidence\n")
            self.commit_all(repo, "add portfolio evidence")
            result = self.run_checker(repo, baseline)

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("PASS preservation audit:", result.stdout)
        self.assertIn(f"Baseline resolved: {baseline}", result.stdout)

    def test_original_source_mutation_fails(self) -> None:
        temporary, repo, baseline = self.make_repo()
        with temporary:
            self.write(repo, "src/original.py", "VALUE = 'mutated'\n")
            self.commit_all(repo, "mutate original source")
            result = self.run_checker(repo, baseline)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("baseline entries changed in HEAD", result.stdout)
        self.assertIn("src/original.py", result.stdout)

    def test_original_artifact_deletion_fails(self) -> None:
        temporary, repo, baseline = self.make_repo()
        with temporary:
            (repo / "docs/portfolio/reference-artifact.txt").unlink()
            self.commit_all(repo, "delete original artifact")
            result = self.run_checker(repo, baseline)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("baseline entries missing from HEAD", result.stdout)
        self.assertIn("docs/portfolio/reference-artifact.txt", result.stdout)

    def test_new_tracked_path_outside_allowlist_fails(self) -> None:
        temporary, repo, baseline = self.make_repo()
        with temporary:
            self.write(repo, "outside-portfolio.txt", "not allowed\n")
            self.commit_all(repo, "add disallowed path")
            result = self.run_checker(repo, baseline)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("new tracked HEAD paths outside docs/portfolio/", result.stdout)
        self.assertIn("outside-portfolio.txt", result.stdout)

    def test_dirty_and_staged_tracked_changes_fail(self) -> None:
        temporary, repo, baseline = self.make_repo()
        with temporary:
            self.write(repo, "src/original.py", "VALUE = 'dirty'\n")
            dirty_result = self.run_checker(repo, baseline)
            self.git(repo, "add", "--", "src/original.py")
            staged_result = self.run_checker(repo, baseline)

        self.assertNotEqual(dirty_result.returncode, 0)
        self.assertIn("staged or worktree changes to tracked paths", dirty_result.stdout)
        self.assertNotEqual(staged_result.returncode, 0)
        self.assertIn("staged or worktree changes to tracked paths", staged_result.stdout)

    def test_untracked_normal_file_outside_allowlist_fails(self) -> None:
        temporary, repo, baseline = self.make_repo()
        with temporary:
            self.write(repo, "normal-untracked-file.txt", "untracked\n")
            result = self.run_checker(repo, baseline)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("untracked additions outside docs/portfolio/", result.stdout)
        self.assertIn("normal-untracked-file.txt", result.stdout)

    @unittest.skipUnless(hasattr(os, "symlink"), "symlinks are not supported on this platform")
    def test_new_symlink_is_rejected(self) -> None:
        temporary, repo, baseline = self.make_repo()
        with temporary:
            link = repo / "docs/portfolio/new-link"
            os.symlink("reference-artifact.txt", link)
            self.commit_all(repo, "add symlink")
            result = self.run_checker(repo, baseline)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unsafe new tracked HEAD entries", result.stdout)
        self.assertIn("docs/portfolio/new-link", result.stdout)

    def test_new_executable_is_rejected(self) -> None:
        temporary, repo, baseline = self.make_repo()
        with temporary:
            self.write(repo, "docs/portfolio/new-script.sh", "#!/bin/sh\nexit 0\n", 0o755)
            self.commit_all(repo, "add executable")
            result = self.run_checker(repo, baseline)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unsafe new tracked HEAD entries", result.stdout)
        self.assertIn("docs/portfolio/new-script.sh", result.stdout)

    def test_nonancestor_baseline_fails(self) -> None:
        temporary, repo, baseline = self.make_repo()
        with temporary:
            self.git(repo, "checkout", "--orphan", "unrelated")
            self.git(repo, "rm", "-rf", "--", ".")
            self.write(repo, "docs/portfolio/unrelated.md", "unrelated root\n")
            self.commit_all(repo, "unrelated history")
            result = self.run_checker(repo, baseline)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("baseline ancestry", result.stdout)
        self.assertIn("is not an ancestor", result.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
