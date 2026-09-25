# Andromeda

**TypeScript code-repair and evaluation research platform.** Andromeda explores repository issue repair, candidate patch generation, model routing, Docker-oriented test execution, and controls for self-modification. It is an experimental system, **not a demonstrated production-safe autonomous repair service** or a verified SWE-bench leaderboard result.

This repository contains three distinct paths; evidence for one path does not validate the others:

| Path | Main entry points | Purpose and boundary |
| --- | --- | --- |
| SWE-bench pipeline | `scripts/run_swebench.ts`, `server/sweBench*.ts` | Assemble context and generate candidate patches for benchmark instances. In `scored_strict` mode, evaluator artifacts are withheld from the model; a `prediction_ready` patch is **not** an evaluator-resolved instance. |
| User-facing agent | `server/reactEngine.ts`, `server/externalRepoFixer.ts` | ReAct-style chat and external-repository repair experiments. Functionality and test evidence vary by task and environment. |
| RSI / self-modification | `server/rsiEngine.ts`, `server/selfImprove.ts`, `server/promotionService.ts` | Candidate proposals, shadow checks, local application, CI records, and a separately designed evidence/approval promotion service. Controls have not been shown to govern every local mutation end to end; keep autonomous operation disabled on important workspaces. |

## Evaluation evidence: what is and is not established

| Historical item | Checked-in evidence | Defensible interpretation |
| --- | --- | --- |
| Reported v3 baseline, **96/500 (19.2%)** on SWE-bench Verified | [`andromeda_sota_v3_final_results.json`](data/swebench/andromeda_sota_v3_final_results.json) reports 96 resolved, 239 unresolved, and 165 errors; a 500-row prediction artifact is also present. | A **repository-reported historical summary**, not independently reproduced here. An official raw evaluator report tying the submitted predictions to the 96 resolved IDs was not established by the repository audit. Another earlier run records 0/500 and must not be conflated with this one. |
| Previously advertised v4 **33/50 (66%)** | A 50-case summary documents 49 patches and one error; a matching official evaluator-resolved report for 33/50 was not found in the reviewed artifacts. | **Unverified development-set claim.** Patch generation/application is not the same as official evaluator resolution; do not use 66% as a general performance result. |
| **113 multilingual reserved instances** | [`multilingual_preregistration.json`](data/swebench/multilingual_preregistration.json) and the associated frozen ID manifests. | A preregistered holdout design, **not 113 scored outcomes**. Resolution must be measured with the official evaluator on the fixed IDs. |
| Test counts and cost claims | CI workflows and many tracked tests exist, but a fixed passing-test badge and claims about cheap-tier resolution or 10% of frontier cost lack a linked, reproducible run-level ledger here. | Run the current suite and report its exact command, revision, environment, and result; do not infer coverage, fix rate, or cost from static counts and design goals. |

For any future scored claim, publish a run bundle with dataset revision and selected-ID manifest, prediction JSONL/hash and unique-ID count, runner commit/config, container digest, evaluator command/version, raw evaluator output, and per-ID outcome taxonomy (`resolved`, `unresolved`, `prediction_ready`, apply failure, timeout, infrastructure failure, unsupported). Preserve failed and partial runs rather than silently changing the denominator.

## Engineering design

The benchmark path uses file discovery and context assembly (`server/sweBenchContextBuilder.ts`), model-routing presets (`server/sweBenchModelConfig.ts`), and a patch/traceback loop (`server/sweBenchTracebackLoop.ts`). Candidate generation and validation are **path- and mode-dependent**: Docker tests used in development are not automatically equivalent to hidden evaluator tests in scored mode. The core can route among multiple language families, but successful repair beyond Python benchmark instances has not been established by a comparable scored evaluation.

The promotion service contains exact-apply, passing-test, sandbox-evidence, bundle-persistence and human-approval checks when that service is used. The RSI path has had separate local apply behavior, which is why this project should be described as **evidence-oriented with continuing boundary hardening**, not as uniformly safety-proven. The [current safety-gate PR](https://github.com/5chm33/Andromeda/pulls) makes skipped required CI stages explicit, rejects unverifiable shadow runs, and removes bypassing Git commits; it does not turn local application into an immutable pre-apply promotion transaction or verify any benchmark outcome.

## Local setup and bounded verification

Requires Node.js 22 and pnpm 11; the agent's model/Docker integrations are optional for the following checks. Inspect scripts and configuration before running the application or granting credentials.

```bash
git clone https://github.com/5chm33/Andromeda.git
cd Andromeda
pnpm install --frozen-lockfile --ignore-scripts
AUTONOMY=false CONTINUOUS_IMPROVEMENT=false pnpm exec tsc --noEmit --skipLibCheck
pnpm exec tsc --project tsconfig.scripts.json --noEmit
AUTONOMY=false CONTINUOUS_IMPROVEMENT=false pnpm exec vitest run server/ciPipeline.test.ts server/shadowInstance.test.ts --pool=forks
PYTHONDONTWRITEBYTECODE=1 python3 -B scripts/check_no_direct_git_push.py
```

These commands check source types, selected offline regressions and the static Git policy. They do **not** reproduce SWE-bench scores, validate a live LLM provider, prove Docker sandbox behavior, or authorize a self-modifying deployment. GitHub workflows additionally run a broader suite, build, smoke test, and adversarial checks; inspect each run's conclusion and logs rather than treating a badge or test count as a reliability measure.

To explore the local app or scored runner, see [`docs/LOCAL_LAUNCHER.md`](docs/LOCAL_LAUNCHER.md) and the `scripts/` implementation. Model-provider calls and benchmark evaluations may incur external costs and require appropriately isolated workspaces; they were **not** run to prepare this documentation.

## Contributing and license

See [CONTRIBUTING.md](CONTRIBUTING.md). New performance claims should include reproducible evaluator artifacts and the exact denominator; new autonomy controls need adversarial failure-path tests. Do not weaken tests to make a run pass. Licensed under [MIT](LICENSE).
