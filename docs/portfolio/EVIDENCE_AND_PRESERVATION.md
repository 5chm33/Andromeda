# Evidence and architecture preservation

## What is preserved

The baseline is Andromeda commit `3e0e1fe685b5109014f3d1327b5620e1d8ee2062`. This portfolio branch adds files only under `docs/portfolio/`. It leaves every pre-existing tracked path's content and file mode unchanged, including application code, model prompts/configuration, tests, dependency files, workflow definitions, existing documentation and committed `data/swebench/` artifacts.

[preserved-artifacts.json](preserved-artifacts.json) records **72 existing benchmark-directory files** at that baseline. Each record has a path, byte count, Git blob ID and SHA-256 digest. The complete baseline has **1,688 tracked entries**. These are inventory counts, not successful tests, repairs or completed benchmark instances. The inventory was generated from Git objects without rewriting or cleaning the original files.

The original source revision remains available through its [pinned GitHub tree](https://github.com/5chm33/Andromeda/tree/3e0e1fe685b5109014f3d1327b5620e1d8ee2062). Adding portfolio documents necessarily creates a different full repository tree/commit. It does not establish that a future run at the new revision reproduces a historical run. Preserve and select exact revisions, prompts, model identifiers, dataset revisions, container/harness identities and run IDs for any future evaluation.

## What a preservation check proves

Run the standard-library, read-only checker from a Git checkout of the portfolio branch:

```bash
python3 docs/portfolio/verify_preservation.py
```

It compares every tracked entry at the fixed baseline with `HEAD`, rejects changes/deletions of original entries, permits new committed files only under `docs/portfolio/`, and rejects tracked working-tree/index changes or ordinary untracked files outside that prefix. It does not fetch anything or execute project modules. Its tests create their own tiny temporary Git repositories; they never apply a candidate to Andromeda.

Ignored files, secrets, data held outside Git, a user's separate computer and material lost from an earlier session are **outside this check's scope**. Preservation of committed files is not recovery of a lost evaluation run. The script is a small review aid, not cryptographic attestation by an independent evaluator; its baseline/configuration and source must remain open to inspection.

## What is not claimed

No new model inference, SWE-bench generation/evaluation, training, Docker run, application startup or production deployment was performed for this portfolio package. Historical summaries and predictions are preserved **as they were**, not relabeled as freshly verified results. This package does not reconstruct missing logs, synthesize evaluator outputs or infer a score from a generated-patch count.

The existing repository contains historical performance claims, but this portfolio makes **no independently verified solve-rate claim**. A generated/applicable prediction is not a resolved issue. A development-mode result is not a strict held-out benchmark result. Source inspection and preservation checks are not an application safety audit.

## What would support a later performance claim

The [official SWE-bench evaluation guide](https://www.swebench.com/SWE-bench/guides/evaluation/) describes evaluating prediction patches by applying them and running the repository's required tests. Credible evidence should connect the frozen task IDs and predictions to the actual evaluator reports and per-instance logs at the stated source, model, dataset and harness versions. Infrastructure errors must remain visible rather than being silently counted as solved or excluded from a headline rate.

This is documentation of evidence requirements, **not an instruction to incur evaluation costs now**. There is no need to claim a score to discuss Andromeda's existing engineering work.

## Publication boundary

The portfolio was published on its own branch rather than changing `main` or merging the existing safety PR. At preparation time, the default PR workflows could use provider secrets, and merging to `main` could trigger image publishing/deployment. No PR was opened for this additive package to avoid starting those workflows. Any later merge should be a separate deliberate decision after inspecting the current automation and runtime implications.
