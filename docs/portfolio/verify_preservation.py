#!/usr/bin/env python3
"""Read-only Git preservation checker for the audited docs/portfolio baseline.

This utility proves Git-tree preservation only.  It does not evaluate model
quality or evaluator results, import or run project code (including
Andromeda), access a network/API, fetch Git objects, or write project files.
The default baseline is the fixed audited evidence baseline.  ``--baseline``
exists solely so this module can be tested against disposable repositories;
an override is visibly labelled as non-evidence for the audited check.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Sequence


AUDITED_BASELINE = "3e0e1fe685b5109014f3d1327b5620e1d8ee2062"
ALLOWED_PREFIX = b"docs/portfolio/"


@dataclass(frozen=True)
class TreeEntry:
    """One recursively tracked Git tree entry."""

    mode: bytes
    object_type: bytes
    object_id: bytes
    path: bytes


def _display(value: bytes) -> str:
    """Render Git's raw path bytes without losing unusual filenames."""

    return value.decode("utf-8", "backslashreplace")


def _git(repo: str, arguments: Sequence[str]) -> subprocess.CompletedProcess[bytes]:
    """Run a read-only Git query without creating optional lock files."""

    environment = os.environ.copy()
    environment["GIT_OPTIONAL_LOCKS"] = "0"
    return subprocess.run(
        ["git", "-C", repo, "--no-optional-locks", *arguments],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
        env=environment,
    )


def _git_text(repo: str, arguments: Sequence[str]) -> tuple[int, str, str]:
    """Run Git and decode command output strictly enough for diagnostics."""

    completed = _git(repo, arguments)
    return (
        completed.returncode,
        completed.stdout.decode("utf-8", "backslashreplace").strip(),
        completed.stderr.decode("utf-8", "backslashreplace").strip(),
    )


def _resolve_commit(repo: str, revision: str) -> tuple[str | None, str | None]:
    """Resolve a revision only if it names a commit already present locally."""

    code, output, error = _git_text(repo, ["rev-parse", "--verify", f"{revision}^{{commit}}"])
    if code:
        return None, error or f"could not resolve commit {revision!r}"
    return output, None


def _read_tree(repo: str, commit: str) -> tuple[dict[bytes, TreeEntry] | None, str | None]:
    """Read a complete recursive tree using NUL-separated Git output."""

    completed = _git(repo, ["ls-tree", "-r", "-z", "--full-tree", commit])
    if completed.returncode:
        error = completed.stderr.decode("utf-8", "backslashreplace").strip()
        return None, error or f"could not read tree {commit}"

    entries: dict[bytes, TreeEntry] = {}
    for record in completed.stdout.split(b"\0"):
        if not record:
            continue
        try:
            header, path = record.split(b"\t", 1)
            mode, object_type, object_id = header.split(b" ", 2)
        except ValueError:
            return None, f"malformed git ls-tree record for {commit}"
        entries[path] = TreeEntry(mode, object_type, object_id, path)
    return entries, None


def _parse_status_z(data: bytes) -> tuple[list[bytes], list[bytes], list[bytes]]:
    """Parse porcelain v1 -z records, including rename/copy source records.

    Returns tracked-change records, untracked paths, and ignored paths.  Git
    emits an additional NUL-separated source path after a rename/copy record;
    it has no status prefix and must be consumed rather than treated as a new
    record.
    """

    tracked_changes: list[bytes] = []
    untracked: list[bytes] = []
    ignored: list[bytes] = []
    records = data.split(b"\0")
    index = 0
    while index < len(records):
        record = records[index]
        index += 1
        if not record:
            continue
        if len(record) < 3 or record[2:3] != b" ":
            # A source pathname can only follow R/C, and is consumed below.
            # If Git ever changes this format, conservatively make it visible
            # as a tracked-state anomaly instead of silently overlooking it.
            tracked_changes.append(record)
            continue

        status = record[:2]
        path = record[3:]
        if status == b"??":
            untracked.append(path)
        elif status == b"!!":
            ignored.append(path)
        else:
            tracked_changes.append(record)
            if status[:1] in (b"R", b"C") or status[1:2] in (b"R", b"C"):
                if index < len(records):
                    index += 1
    return tracked_changes, untracked, ignored


def _status(repo: str) -> tuple[list[bytes] | None, list[bytes] | None, list[bytes] | None, str | None]:
    """Obtain tracked, untracked, and ignored state without line parsing."""

    completed = _git(
        repo,
        [
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
            "--ignored=matching",
        ],
    )
    if completed.returncode:
        error = completed.stderr.decode("utf-8", "backslashreplace").strip()
        return None, None, None, error or "git status failed"
    tracked, untracked, ignored = _parse_status_z(completed.stdout)
    return tracked, untracked, ignored, None


def _print_issues(title: str, paths: Iterable[bytes], limit: int = 20) -> None:
    """Print a bounded list of raw Git paths and its total count."""

    listed = list(paths)
    print(f"FAIL {title}: {len(listed)}")
    for path in listed[:limit]:
        print(f"  - {_display(path)}")
    if len(listed) > limit:
        print(f"  ... {len(listed) - limit} additional path(s) omitted")


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Read-only Git preservation check for the audited docs/portfolio baseline."
    )
    parser.add_argument(
        "--repo",
        metavar="PATH",
        default=".",
        help="repository worktree or a directory within it (default: current directory)",
    )
    parser.add_argument(
        "--baseline",
        metavar="COMMIT",
        default=None,
        help=(
            "TEST-ONLY override for a disposable repository. Omitting it uses "
            "the immutable audited baseline evidence."
        ),
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """Run the audit and return zero only when all preservation conditions pass."""

    args = _parser().parse_args(argv)
    requested_baseline = args.baseline or AUDITED_BASELINE
    repo_argument = str(Path(args.repo).expanduser())

    code, repo_root, error = _git_text(repo_argument, ["rev-parse", "--show-toplevel"])
    if code:
        print("FAIL repository: --repo must name a non-bare Git worktree or a directory inside one")
        if error:
            print(f"  {error}")
        print(f"Baseline requested: {requested_baseline}")
        print("HEAD: unavailable")
        return 1

    print(f"Repository: {repo_root}")
    if args.baseline is None:
        print(f"Baseline: {AUDITED_BASELINE} (fixed audited baseline evidence)")
    else:
        print(
            f"Baseline: {requested_baseline} "
            "(TEST-ONLY override; not evidence for the immutable audited baseline check)"
        )

    head, head_error = _resolve_commit(repo_root, "HEAD")
    baseline, baseline_error = _resolve_commit(repo_root, requested_baseline)
    print(f"Baseline resolved: {baseline or 'unavailable'}")
    print(f"HEAD: {head or 'unavailable'}")

    failures = 0
    if head_error:
        print(f"FAIL HEAD resolution: {head_error}")
        failures += 1
    if baseline_error:
        print(f"FAIL baseline resolution: {baseline_error}")
        failures += 1
    if failures:
        print(f"FAIL preservation audit: {failures} prerequisite failure(s)")
        return 1

    assert head is not None
    assert baseline is not None

    ancestor_code, _, ancestor_error = _git_text(
        repo_root, ["merge-base", "--is-ancestor", baseline, head]
    )
    if ancestor_code == 0:
        print("PASS baseline ancestry: baseline is an ancestor of HEAD")
    else:
        detail = f" ({ancestor_error})" if ancestor_error else ""
        print(f"FAIL baseline ancestry: {baseline} is not an ancestor of {head}{detail}")
        failures += 1

    baseline_tree, baseline_tree_error = _read_tree(repo_root, baseline)
    head_tree, head_tree_error = _read_tree(repo_root, head)
    if baseline_tree_error:
        print(f"FAIL baseline tree: {baseline_tree_error}")
        failures += 1
    if head_tree_error:
        print(f"FAIL HEAD tree: {head_tree_error}")
        failures += 1

    if baseline_tree is not None and head_tree is not None:
        missing = sorted(set(baseline_tree) - set(head_tree))
        changed = sorted(
            path
            for path in set(baseline_tree) & set(head_tree)
            if baseline_tree[path].mode != head_tree[path].mode
            or baseline_tree[path].object_type != head_tree[path].object_type
            or baseline_tree[path].object_id != head_tree[path].object_id
        )
        added = sorted(set(head_tree) - set(baseline_tree))
        added_outside = [path for path in added if not path.startswith(ALLOWED_PREFIX)]
        unsafe_added = [
            path
            for path in added
            if head_tree[path].mode != b"100644" or head_tree[path].object_type != b"blob"
        ]

        if missing:
            _print_issues("baseline entries missing from HEAD", missing)
            failures += 1
        else:
            print(f"PASS baseline entries retained: {len(baseline_tree)}")

        if changed:
            _print_issues("baseline entries changed in HEAD (mode/type/object ID)", changed)
            failures += 1
        else:
            print(f"PASS baseline entries unchanged: {len(baseline_tree)}")

        if added_outside:
            _print_issues("new tracked HEAD paths outside docs/portfolio/", added_outside)
            failures += 1
        else:
            print(f"PASS new tracked HEAD path allowlist: {len(added)} added path(s) within docs/portfolio/")

        if unsafe_added:
            _print_issues("unsafe new tracked HEAD entries (must be normal 100644 blobs)", unsafe_added)
            failures += 1
        else:
            print(f"PASS new tracked HEAD entry types: {len(added)} normal 100644 blob(s)")

    tracked_changes, untracked, ignored, status_error = _status(repo_root)
    if status_error:
        print(f"FAIL working state: {status_error}")
        failures += 1
    else:
        assert tracked_changes is not None
        assert untracked is not None
        assert ignored is not None
        if tracked_changes:
            _print_issues("staged or worktree changes to tracked paths", tracked_changes)
            failures += 1
        else:
            print("PASS tracked index/worktree state: clean")

        untracked_outside = [path for path in untracked if not path.startswith(ALLOWED_PREFIX)]
        if untracked_outside:
            _print_issues("untracked additions outside docs/portfolio/", untracked_outside)
            failures += 1
        else:
            print(f"PASS untracked path allowlist: {len(untracked)} untracked path(s) within docs/portfolio/")

        # Ignored files are deliberately not proof-bearing audit state: Git does
        # not track them, so they neither establish preservation nor cause a
        # failure.  Their count is stated explicitly to avoid implying audit.
        print(
            "INFO ignored untracked paths excluded from audited state: "
            f"{len(ignored)}"
        )

    if failures:
        print(f"FAIL preservation audit: {failures} check group(s) failed")
        return 1

    print(
        "PASS preservation audit: "
        f"baseline={baseline} head={head} baseline_entries="
        f"{len(baseline_tree) if baseline_tree is not None else 0}"
    )
    print("Scope note: this is Git-state preservation evidence only, not proof of model quality or evaluator results.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
