# Andromeda: Designing a Code-Repair Workflow That Keeps Evaluation Evidence Honest

Source-level case study prepared with Manus on 25 October 2026. [Portfolio overview](README.md) · [Evidence and preservation](EVIDENCE_AND_PRESERVATION.md).

## The problem

A coding agent that can produce a patch is not automatically a credible repair system. The difficult engineering problem is preserving the boundary between **candidate generation** and **evidence that a candidate solved the task**. If hidden tests, reference artifacts, or exploratory recovery behavior leak into a benchmark run, the resulting output may be useful for development but cannot fairly stand in for an independently evaluated repair.

Andromeda’s TypeScript benchmark path addresses that distinction directly. At the pinned main revision [`3e0e1fe`](https://github.com/5chm33/Andromeda/tree/3e0e1fe685b5109014f3d1327b5620e1d8ee2062), the system is better understood as an orchestration layer around repair generation, isolated patch application, and durable run evidence—not as a single model or a chat interface.

## The code flow

```text
Issue + repository state -> relevant context -> candidate patch
                                                    |
                                                    v
                                             exact apply check
                                                    |
                             failure: revise <------+------> clean application
                                                                  |
                                                                  v
                                                 scored_strict: prediction_ready
                                                                  |
                                                                  v
                                                separate external evaluator
                                                                  |
                                                                  v
                                                resolved / unresolved / error

(test_aware development: test artifacts may inform iteration; label separately)
```

The runner selects its behavior through an explicit evaluation mode: [`scored_strict` or `test_aware`](https://github.com/5chm33/Andromeda/blob/3e0e1fe685b5109014f3d1327b5620e1d8ee2062/server/sweBenchEvalMode.ts#L1-L39). In strict mode, test patches and `FAIL_TO_PASS` identifiers are removed from model-visible context and targeted-test context is disabled. The traceback loop then permits a clean candidate application but deliberately does not apply hidden test patches or run hidden tests; it returns a blind-apply sentinel instead ([implementation](https://github.com/5chm33/Andromeda/blob/3e0e1fe685b5109014f3d1327b5620e1d8ee2062/server/sweBenchTracebackLoop.ts#L422-L630)).

That choice creates an important, recruiter-relevant data-model distinction. A strict-mode patch that applies cleanly is recorded as **`prediction_ready`**, while **`resolved`** is reserved for the outcome determined by the external evaluator ([outcome types](https://github.com/5chm33/Andromeda/blob/3e0e1fe685b5109014f3d1327b5620e1d8ee2062/server/benchmarkLauncher.ts#L219-L336)). In other words, the system does not relabel “the patch was produced and applied” as “the task was solved.”

The alternate `test_aware` path exists for development and debugging. There, evaluation artifacts can be made available to the pipeline and tests can inform iterative repair. That is a useful engineering loop, but it is intentionally a different kind of evidence. The runner’s comments make the distinction explicit: strict mode is issue-and-repository based; test-aware results are development-only and should not be presented as comparable scored evidence ([mode selection](https://github.com/5chm33/Andromeda/blob/3e0e1fe685b5109014f3d1327b5620e1d8ee2062/scripts/run_swebench.ts#L1190-L1203)).

## Engineering choices that support a future reproducible run

The benchmark launcher is designed to make a future strict run inspectable. Its pre-launch contract checks for a smoke bundle, credential isolation, exact rather than recovery-based patch application, a frozen and hashed task list, non-pushing evaluation behavior, structured failure categories, and a canary before a wider batch ([launcher contract](https://github.com/5chm33/Andromeda/blob/3e0e1fe685b5109014f3d1327b5620e1d8ee2062/server/benchmarkLauncher.ts#L1-L18)). The run metadata also carries dataset provenance, image and harness identifiers, configuration hashes, and reconciliation fields. These are practical design choices for answering later questions such as: *Which tasks were selected? Which image was used? Did every selected item receive one recorded outcome?*

The code also treats fuzzy patch recovery as exploratory rather than promotion-grade evidence. Exact `git apply` is the default; recovery strategies require an explicit opt-in and are documented as unsuitable for automatic promotion evidence until revalidated ([patch-application boundary](https://github.com/5chm33/Andromeda/blob/3e0e1fe685b5109014f3d1327b5620e1d8ee2062/server/sweBenchTracebackLoop.ts#L481-L590)).

Model access is similarly separated behind an adapter. The provider layer can construct an OpenAI-compatible local Ollama endpoint from `OLLAMA_BASE_URL` and `OLLAMA_MODEL`, but marks the effective local configuration `supportsTools: false` ([local configuration](https://github.com/5chm33/Andromeda/blob/3e0e1fe685b5109014f3d1327b5620e1d8ee2062/server/llmProvider.ts#L283-L317)). At completion time, tool definitions are only sent to providers that advertise support ([request construction](https://github.com/5chm33/Andromeda/blob/3e0e1fe685b5109014f3d1327b5620e1d8ee2062/server/llmProvider.ts#L714-L774)). This is a realistic integration boundary: substituting a local backend requires validating its prompt, response, and tool behavior; it is not a drop-in assertion of feature parity. Likewise, the router’s `preferLocal` branch only wins if Ollama is already among a task’s candidates, and the present default candidate lists omit it ([router](https://github.com/5chm33/Andromeda/blob/3e0e1fe685b5109014f3d1327b5620e1d8ee2062/server/llmRouter.ts#L181-L231)). Manual/local-only provider selection remains the more direct configuration path.

## Scope, limitations, and the promotion gap

The repository contains an intent to validate self-improvement proposals through snapshots, a shadow test, and a CI call. Current main, however, proceeds when shadow-test infrastructure is unavailable and invokes that CI call with build, typecheck, and tests skipped ([promotion path](https://github.com/5chm33/Andromeda/blob/3e0e1fe685b5109014f3d1327b5620e1d8ee2062/server/rsiEngine.ts#L642-L727)). Its safety document also describes a fail-open philosophy for unavailable validation ([SAFETY.md](https://github.com/5chm33/Andromeda/blob/3e0e1fe685b5109014f3d1327b5620e1d8ee2062/SAFETY.md#L1-L37)). Therefore, “has a promotion pipeline” should not be conflated with “has a universal fail-closed pre-apply gate.”

The separate safety [PR #1](https://github.com/5chm33/Andromeda/pull/1) is open and unmerged; it is not behavior present in the pinned main revision and should not be represented as such. A next engineering step is a reviewed, fail-closed promotion transaction that independently validates a candidate before it can affect a target branch or environment.

This case study is a source-level review, not a benchmark execution or a claim about repair performance. The implementation provides a credible foundation for a future, independently evaluated run; the actual run artifacts and evaluator results would be the evidence required to make performance claims.
