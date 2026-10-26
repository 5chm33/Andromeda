# Portfolio-package validation

Prepared 25 October 2026. This record concerns the **additive portfolio package**, not a benchmark result or certification of Andromeda's runtime safety.

## Checks performed locally

The preservation utility's standard-library suite passed **9 tests** using disposable miniature Git repositories. It checks an allowed addition, original-file mutation, artifact deletion, a new path outside the permitted directory, dirty/staged changes, untracked additions outside the directory, a new symlink, an executable addition and an unrelated baseline. Repeat it with:

```bash
python3 -B -m unittest discover -s docs/portfolio -p test_verify_preservation.py -v
```

Separately, all **72 existing tracked `data/swebench/` files** matched the manifest's byte counts and SHA-256 digests at the preserved baseline. All **1,688 original tracked files** in the private downloadable source archive were checked against their Git blob IDs and file modes. The archive is a source snapshot, not a full Git-history backup, a copy of ignored local data, or recovery of an earlier lost evaluation.

Pinned source links in the portfolio documents were checked against the existing checkout. No existing source, prompt, test, dependency, workflow, root documentation or benchmark-artifact file was changed.

## Verify the committed portfolio tree

After the portfolio files are committed, verify baseline-to-HEAD preservation with:

```bash
python3 -B docs/portfolio/verify_preservation.py
```

Use the default fixed baseline. The test-only `--baseline` override is expressly **not** evidence of preserving this audited revision. A PASS establishes the comparison performed by this utility; it is not independent evaluation or evidence that the application safely repairs software.

## Work deliberately not performed

No Andromeda test suite, application/agent loop, provider inference, model training, Docker benchmark/evaluator, workflow dispatch or deployment was run. No new repair result or score was synthesized. No existing safety PR was merged. The portfolio branch was pushed without opening a PR so the current base-branch PR workflows would not start.
