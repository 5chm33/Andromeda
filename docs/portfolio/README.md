# Andromeda — software-engineering portfolio

**A TypeScript research platform for code-repair workflows and inspectable evaluation evidence.** Maintained by [Thomas Nance](https://github.com/5chm33).

The central engineering question is not just whether a model can write a patch. It is how to distinguish a generated candidate from an evaluated repair, keep hidden evaluation artifacts out of model context, and make the execution trace inspectable. Andromeda explores those boundaries through repository-context assembly, configurable model access, patch handling and benchmark-run evidence.

## Start here

Read the [case study](CASE_STUDY.md) for the problem, code flow and implementation choices. The [reviewer walkthrough](REVIEWER_WALKTHROUGH.md) points directly to source; no application launch or model account is required. [Evidence and preservation](EVIDENCE_AND_PRESERVATION.md) explains what this portfolio proves, what it does not prove, and how the original files were kept intact. [Interview preparation](INTERVIEW_PREPARATION.md) provides a scoped project description and questions to prepare for.

The [validation record](VALIDATION.md) lists the preservation checks actually performed, without presenting them as application tests or benchmark results.

## What this package demonstrates

The case study identifies concrete boundaries in the existing code: strict scored evaluation versus test-aware development; clean patch application versus externally evaluated resolution; model-provider capabilities versus application tool authority; and promotion design versus its current enforcement gap. Those choices are relevant to developer tooling, backend systems and evaluation-infrastructure roles.

**No independently verified SWE-bench score is claimed here.** This is an engineering case study, not a new benchmark run, a live repair demo, a production release, or a guarantee of safe autonomous operation. The existing [safety PR #1](https://github.com/5chm33/Andromeda/pull/1) is a separate change proposal and was open/unmerged when this package was prepared on 25 October 2026.

## Original architecture remains available

This package was added on `portfolio/preserved-architecture-20261025`, separately from `main`. Its pinned source baseline is [`3e0e1fe685b5109014f3d1327b5620e1d8ee2062`](https://github.com/5chm33/Andromeda/tree/3e0e1fe685b5109014f3d1327b5620e1d8ee2062).

Only new files under `docs/portfolio/` are added. The existing runtime, prompts, tests, dependency lockfile, workflows, root documentation and committed benchmark artifacts are not modified. The portfolio creates a new Git commit/tree identity; it does **not** claim that identity is interchangeable with a historical evaluation revision. Future reproduction should select the exact source and evaluation configuration it intends to reproduce.

The optional preservation check needs only Python 3 and Git:

```bash
python3 docs/portfolio/verify_preservation.py
```

It reads Git metadata and checks file preservation. It does not run Andromeda, install dependencies, invoke a model, download a benchmark or start a container. A passing result establishes preservation—not repair quality or benchmark correctness.

## Authorship and review

This is an AI-assisted project. The portfolio documentation was prepared with Manus through source inspection; it is not an independent certification. The maintainer should distinguish their design/debugging decisions from AI-generated contributions and be able to explain the linked implementation.
