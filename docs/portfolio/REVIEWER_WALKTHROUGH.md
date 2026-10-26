# Reviewer walkthrough — no application or model run required

This is a guided source review of Andromeda at [`3e0e1fe685b5109014f3d1327b5620e1d8ee2062`](https://github.com/5chm33/Andromeda/tree/3e0e1fe685b5109014f3d1327b5620e1d8ee2062). It is **not a recorded successful model repair** and does not manufacture test output or evaluation results. Read it in a browser; no credentials, dependency installation or service are needed.

## 1. Identify the evidence boundary

Open [sweBenchEvalMode.ts](https://github.com/5chm33/Andromeda/blob/3e0e1fe685b5109014f3d1327b5620e1d8ee2062/server/sweBenchEvalMode.ts) and the mode selection in [run_swebench.ts](https://github.com/5chm33/Andromeda/blob/3e0e1fe685b5109014f3d1327b5620e1d8ee2062/scripts/run_swebench.ts#L1190-L1203).

Notice the explicit `scored_strict` / `test_aware` distinction. Ask which inputs are permitted in a scored model prompt, and which development aids must remain outside it. This is a source-level contract; inspecting it is not the same as proving every runtime path obeys it.

## 2. Follow a candidate through patch application

Read the strict-mode branch in [sweBenchTracebackLoop.ts](https://github.com/5chm33/Andromeda/blob/3e0e1fe685b5109014f3d1327b5620e1d8ee2062/server/sweBenchTracebackLoop.ts#L481-L630). In strict mode, a clean application returns a `PREDICTION_READY` sentinel without injecting hidden tests. Examine how exact application differs from optional recovery behavior.

The important question is: **what has been proved at this point?** Patch applicability has a different evidentiary meaning from the required tests passing under an external evaluator.

## 3. Inspect the run contract

Read [benchmarkLauncher.ts](https://github.com/5chm33/Andromeda/blob/3e0e1fe685b5109014f3d1327b5620e1d8ee2062/server/benchmarkLauncher.ts). Look for task-list identity, run metadata, image/harness identification and outcome categorization. These are the fields a reviewer would need to trace a later evaluation, not a substitute for that evaluation.

The [artifact manifest](preserved-artifacts.json) lists the committed `data/swebench/` files at the preserved revision with Git blob IDs and SHA-256 hashes. A hash verifies identity; it does not certify an artifact's correctness or establish that it belongs to a complete evaluated run.

## 4. Check provider capabilities

Inspect the [effective Ollama configuration](https://github.com/5chm33/Andromeda/blob/3e0e1fe685b5109014f3d1327b5620e1d8ee2062/server/llmProvider.ts#L283-L301) and [request construction](https://github.com/5chm33/Andromeda/blob/3e0e1fe685b5109014f3d1327b5620e1d8ee2062/server/llmProvider.ts#L714-L774). The local endpoint is configurable, but native tools are disabled in the effective local configuration. Model replacement therefore needs protocol/capability validation; a new model name alone does not demonstrate feature parity.

## 5. Identify—not conceal—the unfinished safety work

Inspect the [RSI shadow and CI path](https://github.com/5chm33/Andromeda/blob/3e0e1fe685b5109014f3d1327b5620e1d8ee2062/server/rsiEngine.ts#L677-L727). At this baseline, some shadow infrastructure failures proceed to apply, and the subsequent CI call skips typecheck, tests and build. Compare the **separate** [proposed safety fix](https://github.com/5chm33/Andromeda/pull/1), without treating an unmerged branch as baseline behavior.

This portfolio does not repair or exercise that path. A safe live demo would need reviewed enforcement and isolated execution first. Do not run the application, an unattended agent, the training pipeline or benchmark commands merely to follow this walkthrough.

## Optional: verify that the portfolio did not rewrite the original files

From a checkout of the portfolio branch:

```bash
python3 docs/portfolio/verify_preservation.py
```

The checker uses the original baseline by default. If a shallow checkout lacks that commit, it fails rather than fetching it. Obtain the appropriate Git history separately if needed. See [the preservation scope](EVIDENCE_AND_PRESERVATION.md) before interpreting its result.
